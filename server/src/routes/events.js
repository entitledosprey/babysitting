import { Router } from 'express';
import { db } from '../db.js';
import { newId, nowIso } from '../auth.js';
import { wrap, str, bad, isoTimestamp, HttpError } from '../http.js';
import { loadShift, loadEvent, assertOwner, mapEvent } from '../access.js';
import { EVENT_TYPES, isValidType } from '../types.js';

/** Mounted at /api/shifts/:shiftId/events */
export const shiftRouter = Router({ mergeParams: true });

/** Mounted at /api/events */
export const router = Router();

const MAX_DETAIL_BYTES = 4000;

const parseDetail = (value) => {
  if (value == null) return '{}';
  if (typeof value !== 'object' || Array.isArray(value)) bad('detail must be an object');
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > MAX_DETAIL_BYTES) bad('There is too much detail on that entry');
  return json;
};

const assertChildOnShift = (shiftId, childId) => {
  const ok = db.prepare('SELECT 1 FROM shift_children WHERE shift_id = ? AND child_id = ?')
    .get(shiftId, childId);
  if (!ok) bad('That child is not on this shift');
};

shiftRouter.get('/', wrap(async (req, res) => {
  const { shift } = loadShift(req.params.shiftId, req.user);
  res.json({
    events: db.prepare('SELECT * FROM events WHERE shift_id = ? ORDER BY start_at, created_at')
      .all(shift.id).map(mapEvent),
  });
}));

shiftRouter.post('/', wrap(async (req, res) => {
  const { shift, access } = loadShift(req.params.shiftId, req.user);
  assertOwner(access);
  if (!shift.started_at) throw new HttpError(409, 'Start the shift before logging entries');

  const type = str(req.body.type, 'Type', { max: 30 });
  if (!isValidType(type)) bad(`Unknown entry type "${type}"`);

  const childId = str(req.body.childId, 'Child', { max: 64 });
  assertChildOnShift(shift.id, childId);

  const startAt = isoTimestamp(req.body.startAt ?? nowIso(), 'startAt');
  const supportsDuration = EVENT_TYPES[type].duration;

  let endAt = null;
  if (req.body.endAt != null && req.body.endAt !== '') {
    if (!supportsDuration) bad(`A ${EVENT_TYPES[type].label.toLowerCase()} entry is a single moment, not a range`);
    endAt = isoTimestamp(req.body.endAt, 'endAt');
    if (new Date(endAt) < new Date(startAt)) bad('The end time cannot be before the start time');
  }

  // Two simultaneous naps for one child is always a mistake; refuse rather than
  // silently produce overlapping blocks the report cannot add up.
  if (supportsDuration && endAt === null && req.body.running !== false) {
    const running = db.prepare(
      'SELECT id FROM events WHERE shift_id = ? AND child_id = ? AND type = ? AND end_at IS NULL'
    ).get(shift.id, childId, type);
    if (running) {
      throw new HttpError(409, `A ${EVENT_TYPES[type].label.toLowerCase()} is already running for this child`);
    }
  }

  const id = newId();
  const now = nowIso();
  db.prepare(`
    INSERT INTO events (id, shift_id, child_id, type, start_at, end_at, note, detail, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, shift.id, childId, type, startAt, endAt,
    str(req.body.note ?? '', 'Note', { max: 2000, required: false }),
    parseDetail(req.body.detail), now, now,
  );

  res.status(201).json({ event: mapEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(id)) });
}));

router.patch('/:eventId', wrap(async (req, res) => {
  const { event, shift, access } = loadEvent(req.params.eventId, req.user);
  assertOwner(access);

  const startAt = req.body.startAt !== undefined
    ? isoTimestamp(req.body.startAt, 'startAt') : event.start_at;

  let endAt = event.end_at;
  if (req.body.endAt !== undefined) {
    endAt = req.body.endAt == null || req.body.endAt === ''
      ? null : isoTimestamp(req.body.endAt, 'endAt');
    if (endAt && !EVENT_TYPES[event.type]?.duration) {
      bad(`A ${EVENT_TYPES[event.type].label.toLowerCase()} entry is a single moment, not a range`);
    }
  }
  if (endAt && new Date(endAt) < new Date(startAt)) bad('The end time cannot be before the start time');

  let childId = event.child_id;
  if (req.body.childId !== undefined) {
    childId = str(req.body.childId, 'Child', { max: 64 });
    assertChildOnShift(shift.id, childId);
  }

  db.prepare(`
    UPDATE events SET child_id=?, start_at=?, end_at=?, note=?, detail=?, updated_at=? WHERE id=?
  `).run(
    childId, startAt, endAt,
    req.body.note !== undefined ? str(req.body.note, 'Note', { max: 2000, required: false }) : event.note,
    req.body.detail !== undefined ? parseDetail(req.body.detail) : event.detail,
    nowIso(), event.id,
  );

  res.json({ event: mapEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(event.id)) });
}));

/** "Wake up" / stop — closes a running duration entry. */
router.post('/:eventId/stop', wrap(async (req, res) => {
  const { event, access } = loadEvent(req.params.eventId, req.user);
  assertOwner(access);
  if (event.end_at) throw new HttpError(409, 'That entry has already been stopped');

  const endAt = isoTimestamp(req.body.endAt ?? nowIso(), 'endAt');
  if (new Date(endAt) < new Date(event.start_at)) bad('The end time cannot be before the start time');

  db.prepare('UPDATE events SET end_at=?, detail=?, note=?, updated_at=? WHERE id=?').run(
    endAt,
    req.body.detail !== undefined ? parseDetail(req.body.detail) : event.detail,
    req.body.note !== undefined ? str(req.body.note, 'Note', { max: 2000, required: false }) : event.note,
    nowIso(), event.id,
  );

  res.json({ event: mapEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(event.id)) });
}));

router.delete('/:eventId', wrap(async (req, res) => {
  const { event, access } = loadEvent(req.params.eventId, req.user);
  assertOwner(access);
  db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
  res.json({ ok: true });
}));
