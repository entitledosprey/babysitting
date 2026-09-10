import { db } from './db.js';
import { HttpError } from './http.js';

/**
 * Access model
 * ------------
 * Everything hangs off a business, which exactly one sitter owns. A user is
 * therefore one of:
 *
 *   owner   — signed in as the sitter who owns the business the record belongs
 *             to. Full read and write.
 *   parent  — granted read-only access to one specific client. Sees that
 *             client's children, shifts, timelines and reports; writes nothing.
 *   neither — gets 404, never 403, so record ids cannot be probed.
 *
 * Every route resolves access through one of the loaders below rather than
 * checking ownership inline, so there is a single place to get this right.
 */

export const businessOf = (userId) =>
  db.prepare('SELECT * FROM businesses WHERE owner_user_id = ?').get(userId);

export const parentClientIds = (userId) =>
  db.prepare('SELECT client_id FROM client_parents WHERE user_id = ?')
    .all(userId).map((r) => r.client_id);

/** The sitter's own business, or 409 telling the client to run onboarding. */
export function requireBusiness(req, _res, next) {
  const business = businessOf(req.user.id);
  if (!business) {
    return next(new HttpError(409, 'Set up your babysitting business first'));
  }
  req.business = business;
  next();
}

/** Resolves a client and how the caller may act on it. */
export function loadClient(clientId, user) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) throw new HttpError(404, 'Client not found');

  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(client.business_id);
  if (business && business.owner_user_id === user.id) {
    return { client, business, access: 'owner' };
  }

  const linked = db.prepare('SELECT 1 FROM client_parents WHERE user_id = ? AND client_id = ?')
    .get(user.id, client.id);
  if (linked) return { client, business, access: 'parent' };

  throw new HttpError(404, 'Client not found');
}

export function loadShift(shiftId, user) {
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) throw new HttpError(404, 'Shift not found');
  const { client, business, access } = loadClient(shift.client_id, user);
  return { shift, client, business, access };
}

export function loadEvent(eventId, user) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) throw new HttpError(404, 'Entry not found');
  const { shift, client, business, access } = loadShift(event.shift_id, user);
  return { event, shift, client, business, access };
}

export function loadInvoice(invoiceId, user) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  const { client, business, access } = loadClient(invoice.client_id, user);
  return { invoice, client, business, access };
}

/** Guards every mutating path: a parent may look, never touch. */
export function assertOwner(access) {
  if (access !== 'owner') throw new HttpError(403, 'Read-only access');
}

// --- Shared shapes -----------------------------------------------------------

export const childrenOfClient = (clientId, { includeArchived = false } = {}) =>
  db.prepare(`
    SELECT * FROM children
     WHERE client_id = ? ${includeArchived ? '' : 'AND archived = 0'}
     ORDER BY archived, name
  `).all(clientId);

export const childrenOfShift = (shiftId) => db.prepare(`
  SELECT c.* FROM shift_children sc JOIN children c ON c.id = sc.child_id
   WHERE sc.shift_id = ? ORDER BY c.name
`).all(shiftId);

export const contactsOf = (clientId) =>
  db.prepare('SELECT * FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC, name').all(clientId);

export const eventsOf = (shiftId) =>
  db.prepare('SELECT * FROM events WHERE shift_id = ? ORDER BY start_at, created_at').all(shiftId);

/** scheduled → in_progress → completed, derived so it cannot drift. */
export function shiftStatus(shift) {
  if (shift.cancelled_at) return 'cancelled';
  if (!shift.started_at) return 'scheduled';
  return shift.ended_at ? 'completed' : 'in_progress';
}

export function shiftMinutes(shift) {
  if (!shift.started_at || !shift.ended_at) return null;
  return Math.max(0, Math.round(
    (new Date(shift.ended_at).getTime() - new Date(shift.started_at).getTime()) / 60000,
  ));
}

/** The rate that applies: pinned on the shift, else the client's, else the business default. */
export function effectiveRate(shift, client, business) {
  if (shift?.rate_cents != null) return shift.rate_cents;
  if (client?.rate_cents != null) return client.rate_cents;
  return business?.default_rate_cents ?? 0;
}

export const mapChild = (c) => ({
  id: c.id, clientId: c.client_id, name: c.name, birthdate: c.birthdate,
  colour: c.colour, allergies: c.allergies, medical: c.medical,
  routines: c.routines, notes: c.notes, archived: !!c.archived,
});

export const mapContact = (c) => ({
  id: c.id, clientId: c.client_id, name: c.name, email: c.email, phone: c.phone,
  relationship: c.relationship, isPrimary: !!c.is_primary,
  receivesReports: !!c.receives_reports, isEmergency: !!c.is_emergency,
  canCollect: !!c.can_collect,
});

export const mapClient = (c) => ({
  id: c.id, businessId: c.business_id, name: c.name, address: c.address,
  rateCents: c.rate_cents, notes: c.notes, houseRules: c.house_rules,
  wifi: c.wifi, archived: !!c.archived, createdAt: c.created_at,
});

export const mapShift = (s) => ({
  id: s.id, businessId: s.business_id, clientId: s.client_id,
  sitterUserId: s.sitter_user_id, date: s.date,
  scheduledStart: s.scheduled_start, scheduledEnd: s.scheduled_end,
  startedAt: s.started_at, endedAt: s.ended_at, cancelledAt: s.cancelled_at,
  rateCents: s.rate_cents, notes: s.notes, parentNotes: s.parent_notes,
  reportSentAt: s.report_sent_at, invoiceId: s.invoice_id,
  status: shiftStatus(s), minutes: shiftMinutes(s),
});

export const mapEvent = (e) => ({
  id: e.id, shiftId: e.shift_id, childId: e.child_id, type: e.type,
  startAt: e.start_at, endAt: e.end_at, note: e.note,
  detail: JSON.parse(e.detail || '{}'),
  createdAt: e.created_at, updatedAt: e.updated_at,
});

export const mapInvoice = (i) => ({
  id: i.id, businessId: i.business_id, clientId: i.client_id, number: i.number,
  periodStart: i.period_start, periodEnd: i.period_end, minutes: i.minutes,
  totalCents: i.total_cents, currency: i.currency, status: i.status,
  notes: i.notes, sentAt: i.sent_at, paidAt: i.paid_at, createdAt: i.created_at,
});
