import { Router } from 'express';
import { db } from '../db.js';
import { newId, nowIso } from '../auth.js';
import { wrap, str, bad } from '../http.js';
import { businessOf } from '../access.js';

export const router = Router();

const money = (value, field) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) bad(`${field} must be a positive amount`);
  // Stored in cents so hourly-rate arithmetic never accumulates float error.
  return Math.round(n * 100);
};

const mapBusiness = (b) => ({
  id: b.id,
  name: b.name,
  defaultRateCents: b.default_rate_cents,
  currency: b.currency,
  createdAt: b.created_at,
  stats: {
    clients:  db.prepare('SELECT COUNT(*) n FROM clients WHERE business_id = ? AND archived = 0').get(b.id).n,
    shifts:   db.prepare('SELECT COUNT(*) n FROM shifts WHERE business_id = ?').get(b.id).n,
    upcoming: db.prepare(`
      SELECT COUNT(*) n FROM shifts
       WHERE business_id = ? AND started_at IS NULL AND cancelled_at IS NULL
    `).get(b.id).n,
  },
});

router.get('/', (req, res) => {
  const business = businessOf(req.user.id);
  res.json({ business: business ? mapBusiness(business) : null });
});

router.post('/', wrap(async (req, res) => {
  if (businessOf(req.user.id)) bad('You already have a business');
  const name = str(req.body.name, 'Business name', { max: 100 });
  const id = newId();
  db.prepare(`
    INSERT INTO businesses (id, owner_user_id, name, default_rate_cents, currency, created_at)
    VALUES (?,?,?,?,?,?)
  `).run(
    id, req.user.id, name,
    money(req.body.defaultRate, 'Default rate') ?? 0,
    str(req.body.currency ?? 'USD', 'Currency', { max: 3 }).toUpperCase(),
    nowIso(),
  );
  res.status(201).json({ business: mapBusiness(db.prepare('SELECT * FROM businesses WHERE id = ?').get(id)) });
}));

router.patch('/', wrap(async (req, res) => {
  const business = businessOf(req.user.id);
  if (!business) bad('You do not have a business yet');

  const name = req.body.name !== undefined
    ? str(req.body.name, 'Business name', { max: 100 }) : business.name;
  const rate = req.body.defaultRate !== undefined
    ? (money(req.body.defaultRate, 'Default rate') ?? 0) : business.default_rate_cents;
  const currency = req.body.currency !== undefined
    ? str(req.body.currency, 'Currency', { max: 3 }).toUpperCase() : business.currency;

  db.prepare('UPDATE businesses SET name = ?, default_rate_cents = ?, currency = ? WHERE id = ?')
    .run(name, rate, currency, business.id);

  res.json({ business: mapBusiness(db.prepare('SELECT * FROM businesses WHERE id = ?').get(business.id)) });
}));
