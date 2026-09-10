import { Router } from 'express';
import { db } from '../db.js';
import { newId, nowIso } from '../auth.js';
import { wrap, str, bad, isoTimestamp, isoDate, HttpError } from '../http.js';
import { loadSession, childrenOf, eventsOf, mapEvent, mapSession } from '../access.js';

/** Mounted at /api/families/:familyId/sessions — list and create. */
export const familyRouter = Router({ mergeParams: true });

/** Mounted at /api/sessions — operations on one existing session. */
export const router = Router();

const localDateOf = (iso) => {
  // Keep the calendar day as it was on the logging device: the offset in the
  // ISO string is authoritative, not the server's timezone.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : new Date(iso).toISOString().slice(0, 10);
};

const setSessionChildren = (sessionId, familyId, childIds) => {
  if (!Array.isArray(childIds) || childIds.length === 0) bad('Choose at least one child');
  const valid = db.prepare(
    `SELECT id FROM children WHERE family_id = ? AND id IN (${childIds.map(() => '?').join(',')})`
  ).all(familyId, ...childIds).map((r) => r.id);
  if (valid.length !== childIds.length) bad('One or more children are not in this family');

  db.prepare('DELETE FROM session_children WHERE session_id = ?').run(sessionId);
  const ins = db.prepare('INSERT INTO session_children (session_id, child_id) VALUES (?,?)');
  for (const cid of valid) ins.run(sessionId, cid);
};

familyRouter.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = req.query.date
    ? db.prepare('SELECT * FROM sessions WHERE family_id = ? AND date = ? ORDER BY started_at DESC')
        .all(req.familyId, isoDate(req.query.date, 'date'))
    : db.prepare('SELECT * FROM sessions WHERE family_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(req.familyId, limit);

  res.json({
    sessions: rows.map((s) => ({
      ...mapSession(s),
      children: childrenOf(s.id),
      sitterName: db.prepare('SELECT name FROM users WHERE id = ?').get(s.sitter_user_id)?.name ?? '',
      eventCount: db.prepare('SELECT COUNT(*) AS n FROM events WHERE session_id = ?').get(s.id).n,
    })),
  });
});

familyRouter.post('/', wrap(async (req, res) => {
  const startedAt = isoTimestamp(req.body.startedAt ?? nowIso(), 'startedAt');
  const notes = str(req.body.notes ?? '', 'Notes', { max: 4000, required: false });
  const id = newId();

  db.prepare('BEGIN').run();
  try {
    db.prepare(`
      INSERT INTO sessions (id, family_id, sitter_user_id, date, started_at, notes, created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(id, req.familyId, req.user.id, localDateOf(startedAt), startedAt, notes, nowIso());
    setSessionChildren(id, req.familyId, req.body.childIds);
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }

  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  res.status(201).json({ session: { ...mapSession(s), children: childrenOf(id), events: [] } });
}));

router.get('/:sessionId', wrap(async (req, res) => {
  const { session, role } = loadSession(req.params.sessionId, req.user.id);
  res.json({
    session: {
      ...mapSession(session),
      children: childrenOf(session.id),
      events: eventsOf(session.id).map(mapEvent),
      sitterName: db.prepare('SELECT name FROM users WHERE id = ?').get(session.sitter_user_id)?.name ?? '',
      role,
    },
  });
}));

router.patch('/:sessionId', wrap(async (req, res) => {
  const { session } = loadSession(req.params.sessionId, req.user.id);

  const notes = req.body.notes !== undefined
    ? str(req.body.notes, 'Notes', { max: 4000, required: false }) : session.notes;
  const startedAt = req.body.startedAt !== undefined
    ? isoTimestamp(req.body.startedAt, 'startedAt') : session.started_at;
  const endedAt = req.body.endedAt !== undefined
    ? isoTimestamp(req.body.endedAt, 'endedAt', { required: false }) : session.ended_at;

  if (endedAt && new Date(endedAt) < new Date(startedAt)) {
    bad('The session cannot end before it started');
  }

  db.prepare('BEGIN').run();
  try {
    db.prepare('UPDATE sessions SET notes=?, started_at=?, ended_at=?, date=? WHERE id=?')
      .run(notes, startedAt, endedAt, localDateOf(startedAt), session.id);
    if (req.body.childIds !== undefined) {
      setSessionChildren(session.id, session.family_id, req.body.childIds);
    }
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }

  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
  res.json({ session: { ...mapSession(s), children: childrenOf(s.id), events: eventsOf(s.id).map(mapEvent) } });
}));

/** Ends the session, closing any still-running events at the same instant. */
router.post('/:sessionId/end', wrap(async (req, res) => {
  const { session } = loadSession(req.params.sessionId, req.user.id);
  if (session.ended_at) throw new HttpError(409, 'That session has already ended');
  const endedAt = isoTimestamp(req.body.endedAt ?? nowIso(), 'endedAt');

  db.prepare('BEGIN').run();
  try {
    db.prepare('UPDATE events SET end_at = ?, updated_at = ? WHERE session_id = ? AND end_at IS NULL')
      .run(endedAt, nowIso(), session.id);
    db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(endedAt, session.id);
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }

  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
  res.json({ session: { ...mapSession(s), children: childrenOf(s.id), events: eventsOf(s.id).map(mapEvent) } });
}));

router.delete('/:sessionId', wrap(async (req, res) => {
  const { session, role } = loadSession(req.params.sessionId, req.user.id);
  // A sitter may delete only their own session; a parent may delete any in the family.
  if (role !== 'parent' && session.sitter_user_id !== req.user.id) {
    throw new HttpError(403, 'You can only delete your own sessions');
  }
  db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
  res.json({ ok: true });
}));
