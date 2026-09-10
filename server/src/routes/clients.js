import { Router } from 'express';
import { db } from '../db.js';
import { newId, nowIso } from '../auth.js';
import { wrap, str, bad, isoDate, notFound } from '../http.js';
import {
  businessOf, loadClient, assertOwner, childrenOfClient, contactsOf,
  mapClient, mapChild, mapContact, mapShift,
} from '../access.js';
import { makeInviteCode } from './auth.js';

export const router = Router();

const INVITE_DAYS = 21;

const money = (value, field) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) bad(`${field} must be a positive amount`);
  return Math.round(n * 100);
};

/** Owners see their whole roster; parents see only what they were granted. */
router.get('/', (req, res) => {
  const business = businessOf(req.user.id);
  const includeArchived = req.query.includeArchived === 'true';

  const rows = business
    ? db.prepare(`
        SELECT * FROM clients
         WHERE business_id = ? ${includeArchived ? '' : 'AND archived = 0'}
         ORDER BY archived, name
      `).all(business.id)
    : db.prepare(`
        SELECT c.* FROM client_parents cp JOIN clients c ON c.id = cp.client_id
         WHERE cp.user_id = ? ORDER BY c.name
      `).all(req.user.id);

  res.json({
    clients: rows.map((c) => ({
      ...mapClient(c),
      access: business ? 'owner' : 'parent',
      children: childrenOfClient(c.id).map(mapChild),
      lastShift: db.prepare(`
        SELECT date FROM shifts WHERE client_id = ? AND started_at IS NOT NULL
         ORDER BY started_at DESC LIMIT 1
      `).get(c.id)?.date ?? null,
      upcomingShifts: db.prepare(`
        SELECT COUNT(*) n FROM shifts
         WHERE client_id = ? AND started_at IS NULL AND cancelled_at IS NULL
      `).get(c.id).n,
    })),
  });
});

router.post('/', wrap(async (req, res) => {
  const business = businessOf(req.user.id);
  if (!business) bad('Set up your babysitting business first');

  const id = newId();
  db.prepare(`
    INSERT INTO clients (id, business_id, name, address, rate_cents, notes, house_rules, wifi, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    id, business.id,
    str(req.body.name, 'Client name', { max: 100 }),
    str(req.body.address ?? '', 'Address', { max: 300, required: false }),
    money(req.body.rate, 'Hourly rate'),
    str(req.body.notes ?? '', 'Notes', { max: 4000, required: false }),
    str(req.body.houseRules ?? '', 'House rules', { max: 4000, required: false }),
    str(req.body.wifi ?? '', 'Wi-Fi', { max: 200, required: false }),
    nowIso(),
  );
  res.status(201).json({ client: mapClient(db.prepare('SELECT * FROM clients WHERE id = ?').get(id)) });
}));

router.get('/:clientId', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  const shifts = db.prepare(`
    SELECT * FROM shifts WHERE client_id = ? ORDER BY date DESC, COALESCE(started_at, scheduled_start) DESC LIMIT 50
  `).all(client.id);

  res.json({
    client: {
      ...mapClient(client),
      access,
      children: childrenOfClient(client.id, { includeArchived: access === 'owner' }).map(mapChild),
      // Parents see the full contact list: it is their own family's roster.
      contacts: contactsOf(client.id).map(mapContact),
      shifts: shifts.map((s) => ({
        ...mapShift(s),
        eventCount: db.prepare('SELECT COUNT(*) n FROM events WHERE shift_id = ?').get(s.id).n,
      })),
      parents: access === 'owner' ? db.prepare(`
        SELECT u.id, u.name, u.email, cp.created_at AS since
          FROM client_parents cp JOIN users u ON u.id = cp.user_id
         WHERE cp.client_id = ? ORDER BY u.name
      `).all(client.id) : [],
    },
  });
}));

router.patch('/:clientId', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);

  const pick = (key, field, max, current) =>
    req.body[key] !== undefined ? str(req.body[key], field, { max, required: false }) : current;

  db.prepare(`
    UPDATE clients SET name=?, address=?, rate_cents=?, notes=?, house_rules=?, wifi=?, archived=? WHERE id=?
  `).run(
    req.body.name !== undefined ? str(req.body.name, 'Client name', { max: 100 }) : client.name,
    pick('address', 'Address', 300, client.address),
    req.body.rate !== undefined ? money(req.body.rate, 'Hourly rate') : client.rate_cents,
    pick('notes', 'Notes', 4000, client.notes),
    pick('houseRules', 'House rules', 4000, client.house_rules),
    pick('wifi', 'Wi-Fi', 200, client.wifi),
    req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : client.archived,
    client.id,
  );

  res.json({ client: mapClient(db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id)) });
}));

router.delete('/:clientId', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);
  if (str(req.body?.confirmName ?? '', 'Confirmation', { required: false }) !== client.name) {
    bad('Type the client name exactly to confirm deletion');
  }
  db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);
  res.json({ ok: true });
}));

// --- Children ----------------------------------------------------------------

const childFields = (body, current = {}) => ({
  name: body.name !== undefined ? str(body.name, 'Name', { max: 80 }) : current.name,
  birthdate: body.birthdate !== undefined
    ? (body.birthdate ? isoDate(body.birthdate, 'Birthdate') : null) : current.birthdate ?? null,
  colour: body.colour !== undefined ? str(body.colour, 'Colour', { max: 9 }) : current.colour ?? '#4a7fe0',
  allergies: body.allergies !== undefined ? str(body.allergies, 'Allergies', { max: 2000, required: false }) : current.allergies ?? '',
  medical: body.medical !== undefined ? str(body.medical, 'Medical notes', { max: 2000, required: false }) : current.medical ?? '',
  routines: body.routines !== undefined ? str(body.routines, 'Routines', { max: 4000, required: false }) : current.routines ?? '',
  notes: body.notes !== undefined ? str(body.notes, 'Notes', { max: 4000, required: false }) : current.notes ?? '',
});

router.post('/:clientId/children', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);
  const f = childFields(req.body);
  if (!f.name) bad('Name is required');

  const id = newId();
  db.prepare(`
    INSERT INTO children (id, client_id, name, birthdate, colour, allergies, medical, routines, notes, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(id, client.id, f.name, f.birthdate, f.colour, f.allergies, f.medical, f.routines, f.notes, nowIso());

  res.status(201).json({ child: mapChild(db.prepare('SELECT * FROM children WHERE id = ?').get(id)) });
}));

router.patch('/:clientId/children/:childId', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);
  const existing = db.prepare('SELECT * FROM children WHERE id = ? AND client_id = ?')
    .get(req.params.childId, client.id);
  if (!existing) notFound('Child not found');

  const f = childFields(req.body, existing);
  db.prepare(`
    UPDATE children SET name=?, birthdate=?, colour=?, allergies=?, medical=?, routines=?, notes=?, archived=? WHERE id=?
  `).run(f.name, f.birthdate, f.colour, f.allergies, f.medical, f.routines, f.notes,
         req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : existing.archived, existing.id);

  res.json({ child: mapChild(db.prepare('SELECT * FROM children WHERE id = ?').get(existing.id)) });
}));

router.delete('/:clientId/children/:childId', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);
  const existing = db.prepare('SELECT id FROM children WHERE id = ? AND client_id = ?')
    .get(req.params.childId, client.id);
  if (!existing) notFound('Child not found');
  db.prepare('DELETE FROM children WHERE id = ?').run(existing.id);
  res.json({ ok: true });
}));

// --- Contacts ----------------------------------------------------------------

const contactFields = (body, current = {}) => ({
  name: body.name !== undefined ? str(body.name, 'Name', { max: 100 }) : current.name,
  email: body.email !== undefined ? str(body.email, 'Email', { max: 320, required: false }).toLowerCase() : current.email ?? '',
  phone: body.phone !== undefined ? str(body.phone, 'Phone', { max: 40, required: false }) : current.phone ?? '',
  relationship: body.relationship !== undefined ? str(body.relationship, 'Relationship', { max: 60, required: false }) : current.relationship ?? '',
  isPrimary: body.isPrimary !== undefined ? (body.isPrimary ? 1 : 0) : current.is_primary ?? 0,
  receivesReports: body.receivesReports !== undefined ? (body.receivesReports ? 1 : 0) : current.receives_reports ?? 1,
  isEmergency: body.isEmergency !== undefined ? (body.isEmergency ? 1 : 0) : current.is_emergency ?? 0,
  canCollect: body.canCollect !== undefined ? (body.canCollect ? 1 : 0) : current.can_collect ?? 0,
});

router.post('/:clientId/contacts', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);
  const f = contactFields(req.body);
  if (!f.name) bad('Name is required');
  if (f.receivesReports && !f.email) bad('A contact who receives reports needs an email address');

  const id = newId();
  db.prepare(`
    INSERT INTO client_contacts
      (id, client_id, name, email, phone, relationship, is_primary, receives_reports, is_emergency, can_collect, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, client.id, f.name, f.email, f.phone, f.relationship,
         f.isPrimary, f.receivesReports, f.isEmergency, f.canCollect, nowIso());

  res.status(201).json({ contact: mapContact(db.prepare('SELECT * FROM client_contacts WHERE id = ?').get(id)) });
}));

router.patch('/:clientId/contacts/:contactId', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);
  const existing = db.prepare('SELECT * FROM client_contacts WHERE id = ? AND client_id = ?')
    .get(req.params.contactId, client.id);
  if (!existing) notFound('Contact not found');

  const f = contactFields(req.body, existing);
  if (f.receivesReports && !f.email) bad('A contact who receives reports needs an email address');

  db.prepare(`
    UPDATE client_contacts SET name=?, email=?, phone=?, relationship=?,
           is_primary=?, receives_reports=?, is_emergency=?, can_collect=? WHERE id=?
  `).run(f.name, f.email, f.phone, f.relationship,
         f.isPrimary, f.receivesReports, f.isEmergency, f.canCollect, existing.id);

  res.json({ contact: mapContact(db.prepare('SELECT * FROM client_contacts WHERE id = ?').get(existing.id)) });
}));

router.delete('/:clientId/contacts/:contactId', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);
  db.prepare('DELETE FROM client_contacts WHERE id = ? AND client_id = ?')
    .run(req.params.contactId, client.id);
  res.json({ ok: true });
}));

// --- Parent portal access ----------------------------------------------------

router.get('/:clientId/invites', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);
  res.json({
    invites: db.prepare(`
      SELECT code, email, expires_at AS expiresAt, created_at AS createdAt
        FROM invites WHERE client_id = ? AND used_by IS NULL AND expires_at > ?
        ORDER BY created_at DESC
    `).all(client.id, nowIso()),
  });
}));

router.post('/:clientId/invites', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);

  const code = makeInviteCode();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString();
  db.prepare(`
    INSERT INTO invites (code, client_id, email, created_by, expires_at, created_at)
    VALUES (?,?,?,?,?,?)
  `).run(code, client.id,
         str(req.body.email ?? '', 'Email', { max: 320, required: false }).toLowerCase(),
         req.user.id, expiresAt, now);

  res.status(201).json({ invite: { code, expiresAt, createdAt: now } });
}));

router.delete('/:clientId/invites/:code', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);
  db.prepare('DELETE FROM invites WHERE code = ? AND client_id = ? AND used_by IS NULL')
    .run(req.params.code.toUpperCase(), client.id);
  res.json({ ok: true });
}));

router.delete('/:clientId/parents/:userId', wrap(async (req, res) => {
  const { client, access } = loadClient(req.params.clientId, req.user);
  assertOwner(access);
  db.prepare('DELETE FROM client_parents WHERE client_id = ? AND user_id = ?')
    .run(client.id, req.params.userId);
  res.json({ ok: true });
}));
