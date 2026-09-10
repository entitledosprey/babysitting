import { db } from './db.js';
import { membershipOf } from './auth.js';
import { HttpError } from './http.js';

/**
 * Loads a session and the caller's role in its family, or throws 404.
 * Non-members get 404 rather than 403 so session ids cannot be probed.
 */
export function loadSession(sessionId, userId) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) throw new HttpError(404, 'Session not found');
  const m = membershipOf(userId, session.family_id);
  if (!m) throw new HttpError(404, 'Session not found');
  return { session, role: m.role };
}

/** Same, starting from an event id. */
export function loadEvent(eventId, userId) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) throw new HttpError(404, 'Event not found');
  const { session, role } = loadSession(event.session_id, userId);
  return { event, session, role };
}

export const childIdsOf = (sessionId) =>
  db.prepare('SELECT child_id FROM session_children WHERE session_id = ?')
    .all(sessionId).map((r) => r.child_id);

export const childrenOf = (sessionId) => db.prepare(`
  SELECT c.id, c.name, c.colour, c.birthdate
    FROM session_children sc JOIN children c ON c.id = sc.child_id
   WHERE sc.session_id = ?
   ORDER BY c.name
`).all(sessionId);

export const eventsOf = (sessionId) =>
  db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY start_at, created_at').all(sessionId);

export const mapEvent = (e) => ({
  id: e.id,
  sessionId: e.session_id,
  childId: e.child_id,
  type: e.type,
  startAt: e.start_at,
  endAt: e.end_at,
  note: e.note,
  detail: JSON.parse(e.detail || '{}'),
  createdAt: e.created_at,
  updatedAt: e.updated_at,
});

export const mapSession = (s) => ({
  id: s.id,
  familyId: s.family_id,
  sitterUserId: s.sitter_user_id,
  date: s.date,
  startedAt: s.started_at,
  endedAt: s.ended_at,
  notes: s.notes,
  createdAt: s.created_at,
});
