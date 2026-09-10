import { Router } from 'express';
import { db } from '../db.js';
import { newId, nowIso } from '../auth.js';
import { wrap, str, bad, isoTimestamp, isoDate, notFound, HttpError } from '../http.js';
import {
  businessOf, loadClient, loadShift, assertOwner, childrenOfShift, eventsOf,
  mapShift, mapEvent, mapChild, mapClient, effectiveRate, shiftStatus,
} from '../access.js';
import { sendShiftReport } from '../report-email.js';

export const router = Router();

const localDateOf = (iso) => {
  // Keep the calendar day as it was on the logging device: the offset in the
  // ISO string is authoritative, not the server's timezone.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : new Date(iso).toISOString().slice(0, 10);
};

const money = (value, field) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) bad(`${field} must be a positive amount`);
  return Math.round(n * 100);
};

const setShiftChildren = (shiftId, clientId, childIds) => {
  if (!Array.isArray(childIds) || childIds.length === 0) bad('Choose at least one child');
  const valid = db.prepare(
    `SELECT id FROM children WHERE client_id = ? AND id IN (${childIds.map(() => '?').join(',')})`
  ).all(clientId, ...childIds).map((r) => r.id);
  if (valid.length !== childIds.length) bad('One or more children are not with this client');

  db.prepare('DELETE FROM shift_children WHERE shift_id = ?').run(shiftId);
  const ins = db.prepare('INSERT INTO shift_children (shift_id, child_id) VALUES (?,?)');
  for (const cid of valid) ins.run(shiftId, cid);
};

const fullShift = (shift) => ({
  ...mapShift(shift),
  client: mapClient(db.prepare('SELECT * FROM clients WHERE id = ?').get(shift.client_id)),
  children: childrenOfShift(shift.id).map(mapChild),
  events: eventsOf(shift.id).map(mapEvent),
  sitterName: db.prepare('SELECT name FROM users WHERE id = ?').get(shift.sitter_user_id)?.name ?? '',
});

/**
 * The sitter's whole book of work, or — for a parent — only their own family's.
 * `scope=upcoming|active|past` drives the three views in the app.
 */
router.get('/', wrap(async (req, res) => {
  const business = businessOf(req.user.id);
  const scope = String(req.query.scope ?? 'all');
  const clientId = req.query.clientId ? String(req.query.clientId) : null;

  const where = [];
  const args = [];

  if (business) {
    where.push('s.business_id = ?');
    args.push(business.id);
  } else {
    const ids = db.prepare('SELECT client_id FROM client_parents WHERE user_id = ?')
      .all(req.user.id).map((r) => r.client_id);
    if (ids.length === 0) return res.json({ shifts: [] });
    where.push(`s.client_id IN (${ids.map(() => '?').join(',')})`);
    args.push(...ids);
  }

  if (clientId) {
    // Confirms the caller may see this client at all.
    loadClient(clientId, req.user);
    where.push('s.client_id = ?');
    args.push(clientId);
  }

  if (scope === 'upcoming') where.push('s.started_at IS NULL AND s.cancelled_at IS NULL');
  if (scope === 'active') where.push('s.started_at IS NOT NULL AND s.ended_at IS NULL AND s.cancelled_at IS NULL');
  if (scope === 'past') where.push('s.ended_at IS NOT NULL');

  const order = scope === 'upcoming'
    ? 'COALESCE(s.scheduled_start, s.date) ASC'
    : 'COALESCE(s.started_at, s.scheduled_start, s.date) DESC';

  const rows = db.prepare(`
    SELECT s.* FROM shifts s WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200
  `).all(...args);

  res.json({
    shifts: rows.map((s) => ({
      ...mapShift(s),
      clientName: db.prepare('SELECT name FROM clients WHERE id = ?').get(s.client_id)?.name ?? '',
      children: childrenOfShift(s.id).map((c) => ({ id: c.id, name: c.name, colour: c.colour })),
      eventCount: db.prepare('SELECT COUNT(*) n FROM events WHERE shift_id = ?').get(s.id).n,
    })),
  });
}));

/**
 * Creates a shift. Omit `startNow` to book it for later; pass it to begin
 * working immediately. Booking ahead and starting are the same record, so a
 * scheduled shift can simply be started when the sitter arrives.
 */
router.post('/', wrap(async (req, res) => {
  const business = businessOf(req.user.id);
  if (!business) bad('Set up your babysitting business first');

  const { client, access } = loadClient(str(req.body.clientId, 'Client', { max: 64 }), req.user);
  assertOwner(access);

  const startNow = req.body.startNow === true;
  const scheduledStart = req.body.scheduledStart
    ? isoTimestamp(req.body.scheduledStart, 'scheduledStart') : null;
  const scheduledEnd = req.body.scheduledEnd
    ? isoTimestamp(req.body.scheduledEnd, 'scheduledEnd') : null;

  if (!startNow && !scheduledStart) bad('Give a start time, or start the shift now');
  if (scheduledStart && scheduledEnd && new Date(scheduledEnd) < new Date(scheduledStart)) {
    bad('The shift cannot end before it starts');
  }

  const startedAt = startNow ? isoTimestamp(req.body.startedAt ?? nowIso(), 'startedAt') : null;
  const date = localDateOf(startedAt ?? scheduledStart);
  const id = newId();

  db.prepare('BEGIN').run();
  try {
    db.prepare(`
      INSERT INTO shifts (id, business_id, client_id, sitter_user_id, date,
                          scheduled_start, scheduled_end, started_at, rate_cents,
                          notes, parent_notes, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, business.id, client.id, req.user.id, date,
      scheduledStart, scheduledEnd, startedAt,
      money(req.body.rate, 'Rate'),
      str(req.body.notes ?? '', 'Notes', { max: 4000, required: false }),
      str(req.body.parentNotes ?? '', 'Notes from the parents', { max: 4000, required: false }),
      nowIso(),
    );
    // Default to every child on the client's roster — the common case.
    const childIds = Array.isArray(req.body.childIds) && req.body.childIds.length
      ? req.body.childIds
      : db.prepare('SELECT id FROM children WHERE client_id = ? AND archived = 0').all(client.id).map((c) => c.id);
    setShiftChildren(id, client.id, childIds);
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }

  res.status(201).json({ shift: fullShift(db.prepare('SELECT * FROM shifts WHERE id = ?').get(id)) });
}));

router.get('/:shiftId', wrap(async (req, res) => {
  const { shift, access } = loadShift(req.params.shiftId, req.user);
  res.json({ shift: { ...fullShift(shift), access } });
}));

router.patch('/:shiftId', wrap(async (req, res) => {
  const { shift, client, access } = loadShift(req.params.shiftId, req.user);
  assertOwner(access);

  const scheduledStart = req.body.scheduledStart !== undefined
    ? (req.body.scheduledStart ? isoTimestamp(req.body.scheduledStart, 'scheduledStart') : null)
    : shift.scheduled_start;
  const scheduledEnd = req.body.scheduledEnd !== undefined
    ? (req.body.scheduledEnd ? isoTimestamp(req.body.scheduledEnd, 'scheduledEnd') : null)
    : shift.scheduled_end;
  const startedAt = req.body.startedAt !== undefined
    ? (req.body.startedAt ? isoTimestamp(req.body.startedAt, 'startedAt') : null) : shift.started_at;
  const endedAt = req.body.endedAt !== undefined
    ? (req.body.endedAt ? isoTimestamp(req.body.endedAt, 'endedAt') : null) : shift.ended_at;

  if (endedAt && !startedAt) bad('A shift cannot end before it has started');
  if (endedAt && new Date(endedAt) < new Date(startedAt)) bad('The shift cannot end before it started');

  db.prepare(`
    UPDATE shifts SET scheduled_start=?, scheduled_end=?, started_at=?, ended_at=?,
           rate_cents=?, notes=?, parent_notes=?, date=? WHERE id=?
  `).run(
    scheduledStart, scheduledEnd, startedAt, endedAt,
    req.body.rate !== undefined ? money(req.body.rate, 'Rate') : shift.rate_cents,
    req.body.notes !== undefined ? str(req.body.notes, 'Notes', { max: 4000, required: false }) : shift.notes,
    req.body.parentNotes !== undefined
      ? str(req.body.parentNotes, 'Notes from the parents', { max: 4000, required: false }) : shift.parent_notes,
    localDateOf(startedAt ?? scheduledStart ?? `${shift.date}T12:00:00`),
    shift.id,
  );

  if (req.body.childIds !== undefined) setShiftChildren(shift.id, client.id, req.body.childIds);

  res.json({ shift: fullShift(db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id)) });
}));

/** Begin a booked shift. */
router.post('/:shiftId/start', wrap(async (req, res) => {
  const { shift, access } = loadShift(req.params.shiftId, req.user);
  assertOwner(access);
  if (shift.cancelled_at) throw new HttpError(409, 'That shift was cancelled');
  if (shift.started_at) throw new HttpError(409, 'That shift has already started');

  const startedAt = isoTimestamp(req.body.startedAt ?? nowIso(), 'startedAt');
  db.prepare('UPDATE shifts SET started_at = ?, date = ? WHERE id = ?')
    .run(startedAt, localDateOf(startedAt), shift.id);

  res.json({ shift: fullShift(db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id)) });
}));

/** Close out a shift: stop anything running, then mail the report. */
router.post('/:shiftId/end', wrap(async (req, res) => {
  const { shift, access } = loadShift(req.params.shiftId, req.user);
  assertOwner(access);
  if (!shift.started_at) throw new HttpError(409, 'That shift has not started yet');
  if (shift.ended_at) throw new HttpError(409, 'That shift has already ended');

  const endedAt = isoTimestamp(req.body.endedAt ?? nowIso(), 'endedAt');
  if (new Date(endedAt) < new Date(shift.started_at)) bad('The shift cannot end before it started');

  db.prepare('BEGIN').run();
  try {
    db.prepare('UPDATE events SET end_at = ?, updated_at = ? WHERE shift_id = ? AND end_at IS NULL')
      .run(endedAt, nowIso(), shift.id);
    if (req.body.notes !== undefined) {
      db.prepare('UPDATE shifts SET notes = ? WHERE id = ?')
        .run(str(req.body.notes, 'Notes', { max: 4000, required: false }), shift.id);
    }
    db.prepare('UPDATE shifts SET ended_at = ? WHERE id = ?').run(endedAt, shift.id);
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }

  const updated = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id);

  // Deliberately not awaited: SMTP can be slow or down, and closing out a shift
  // must not depend on it. Failures land in email_log and can be resent.
  if (req.body.sendReport !== false) {
    sendShiftReport(updated).catch((err) => console.error('[mail] report send failed', err));
  }

  res.json({ shift: fullShift(updated) });
}));

router.post('/:shiftId/cancel', wrap(async (req, res) => {
  const { shift, access } = loadShift(req.params.shiftId, req.user);
  assertOwner(access);
  if (shift.started_at) throw new HttpError(409, 'A shift that has started cannot be cancelled');
  db.prepare('UPDATE shifts SET cancelled_at = ? WHERE id = ?').run(nowIso(), shift.id);
  res.json({ shift: fullShift(db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id)) });
}));

router.delete('/:shiftId', wrap(async (req, res) => {
  const { shift, access } = loadShift(req.params.shiftId, req.user);
  assertOwner(access);
  if (shift.invoice_id) bad('That shift is on an invoice. Void the invoice first.');
  db.prepare('DELETE FROM shifts WHERE id = ?').run(shift.id);
  res.json({ ok: true });
}));

/** What this shift is worth, for the shift screen and invoicing preview. */
router.get('/:shiftId/earnings', wrap(async (req, res) => {
  const { shift, client, business, access } = loadShift(req.params.shiftId, req.user);
  assertOwner(access);
  const rate = effectiveRate(shift, client, business);
  const minutes = mapShift(shift).minutes ?? 0;
  res.json({
    earnings: {
      status: shiftStatus(shift),
      minutes,
      rateCents: rate,
      currency: business.currency,
      totalCents: Math.round((minutes / 60) * rate),
      invoiced: Boolean(shift.invoice_id),
    },
  });
}));
