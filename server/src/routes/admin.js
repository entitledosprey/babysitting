import { Router } from 'express';
import { statSync } from 'node:fs';
import { db } from '../db.js';
import { hashPassword, nowIso, adminCount } from '../auth.js';
import { wrap, str, bad, notFound, HttpError } from '../http.js';
import { mailSettings, verifyTransport, sendMail } from '../mailer.js';
import { sendShiftReport, reportRecipients } from '../report-email.js';
import { shiftStatus, shiftMinutes } from '../access.js';

export const router = Router();

const DB_PATH = process.env.DB_PATH || './data/babysitting.db';

const count = (sql, ...args) => db.prepare(sql).get(...args).n;

const fileSize = (path) => {
  try { return statSync(path).size; } catch { return 0; }
};

// --- Overview ----------------------------------------------------------------

router.get('/overview', wrap(async (_req, res) => {
  res.json({
    counts: {
      users:      count('SELECT COUNT(*) n FROM users'),
      disabled:   count('SELECT COUNT(*) n FROM users WHERE disabled = 1'),
      businesses: count('SELECT COUNT(*) n FROM businesses'),
      clients:    count('SELECT COUNT(*) n FROM clients WHERE archived = 0'),
      children:   count('SELECT COUNT(*) n FROM children WHERE archived = 0'),
      shifts:     count('SELECT COUNT(*) n FROM shifts'),
      active:     count('SELECT COUNT(*) n FROM shifts WHERE started_at IS NOT NULL AND ended_at IS NULL AND cancelled_at IS NULL'),
      upcoming:   count('SELECT COUNT(*) n FROM shifts WHERE started_at IS NULL AND cancelled_at IS NULL'),
      events:     count('SELECT COUNT(*) n FROM events'),
      invoices:   count('SELECT COUNT(*) n FROM invoices'),
      parents:    count('SELECT COUNT(DISTINCT user_id) n FROM client_parents'),
      invites:    count('SELECT COUNT(*) n FROM invites WHERE used_by IS NULL AND expires_at > ?', nowIso()),
      logins:     count('SELECT COUNT(*) n FROM auth_sessions WHERE expires_at > ?', nowIso()),
    },
    storage: { dbBytes: fileSize(DB_PATH), walBytes: fileSize(`${DB_PATH}-wal`), path: DB_PATH },
    mail: {
      ...mailSettings(),
      adminCount: adminCount(),
      recentFailures: db.prepare(`
        SELECT to_email, subject, error, created_at FROM email_log
         WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10
      `).all(),
    },
    runtime: {
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      rssBytes: process.memoryUsage().rss,
      now: nowIso(),
    },
    activity: {
      last7Days: db.prepare(`
        SELECT date, COUNT(*) AS shifts FROM shifts
         WHERE date >= date('now', '-7 days') GROUP BY date ORDER BY date DESC
      `).all(),
    },
  });
}));

// --- Users -------------------------------------------------------------------

const userRow = (u) => {
  const business = db.prepare('SELECT id, name FROM businesses WHERE owner_user_id = ?').get(u.id);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    disabled: !!u.disabled,
    createdAt: u.created_at,
    lastSeenAt: u.last_seen_at,
    business: business ?? null,
    parentOf: db.prepare(`
      SELECT c.id, c.name FROM client_parents cp JOIN clients c ON c.id = cp.client_id
       WHERE cp.user_id = ?
    `).all(u.id),
  };
};

router.get('/users', wrap(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const rows = q
    ? db.prepare('SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 200')
        .all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 200').all();
  res.json({ users: rows.map(userRow) });
}));

const getUser = (id) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) notFound('User not found');
  return u;
};

router.patch('/users/:userId', wrap(async (req, res) => {
  const u = getUser(req.params.userId);
  const name = req.body.name !== undefined ? str(req.body.name, 'Name', { max: 100 }) : u.name;
  const disabled = req.body.disabled !== undefined ? (req.body.disabled ? 1 : 0) : u.disabled;

  db.prepare('UPDATE users SET name = ?, disabled = ? WHERE id = ?').run(name, disabled, u.id);
  // Disabling takes effect immediately rather than at token expiry.
  if (disabled) db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(u.id);

  res.json({ user: userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
}));

router.post('/users/:userId/password', wrap(async (req, res) => {
  const u = getUser(req.params.userId);
  const newPassword = String(req.body.newPassword ?? '');
  if (newPassword.length < 8) bad('Password must be at least 8 characters');

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(await hashPassword(newPassword), u.id);
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(u.id);
  res.json({ ok: true });
}));

router.delete('/users/:userId', wrap(async (req, res) => {
  const u = getUser(req.params.userId);
  if (u.id === req.user.id) bad('You cannot delete the account you are signed in with');

  // Deleting a sitter cascades to their whole business: clients, shifts, the
  // lot. Say so plainly rather than discovering it afterwards.
  const business = db.prepare('SELECT id, name FROM businesses WHERE owner_user_id = ?').get(u.id);
  if (business && req.query.force !== 'true') {
    const clients = count('SELECT COUNT(*) n FROM clients WHERE business_id = ?', business.id);
    const shifts = count('SELECT COUNT(*) n FROM shifts WHERE business_id = ?', business.id);
    throw new HttpError(409,
      `That user owns "${business.name}" (${clients} client(s), ${shifts} shift(s)), which will be deleted too. Retry with force=true.`);
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.json({ ok: true, deletedBusiness: business ?? null });
}));

// --- Businesses --------------------------------------------------------------

router.get('/businesses', wrap(async (_req, res) => {
  res.json({
    businesses: db.prepare(`
      SELECT b.id, b.name, b.currency, b.default_rate_cents AS defaultRateCents,
             b.created_at AS createdAt, u.name AS ownerName, u.email AS ownerEmail,
             (SELECT COUNT(*) FROM clients c WHERE c.business_id = b.id AND c.archived = 0) AS clients,
             (SELECT COUNT(*) FROM shifts s WHERE s.business_id = b.id) AS shifts
        FROM businesses b JOIN users u ON u.id = b.owner_user_id
       ORDER BY b.created_at DESC LIMIT 200
    `).all(),
  });
}));

router.get('/businesses/:businessId', wrap(async (req, res) => {
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.businessId);
  if (!business) notFound('Business not found');
  const owner = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(business.owner_user_id);

  res.json({
    business: {
      id: business.id,
      name: business.name,
      currency: business.currency,
      defaultRateCents: business.default_rate_cents,
      createdAt: business.created_at,
      owner,
      clients: db.prepare(`
        SELECT c.id, c.name, c.archived,
               (SELECT COUNT(*) FROM children ch WHERE ch.client_id = c.id AND ch.archived = 0) AS children,
               (SELECT COUNT(*) FROM shifts s WHERE s.client_id = c.id) AS shifts,
               (SELECT COUNT(*) FROM client_parents cp WHERE cp.client_id = c.id) AS parents
          FROM clients c WHERE c.business_id = ? ORDER BY c.archived, c.name
      `).all(business.id),
    },
  });
}));

router.delete('/businesses/:businessId', wrap(async (req, res) => {
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.businessId);
  if (!business) notFound('Business not found');
  if (str(req.body?.confirmName ?? '', 'Confirmation', { required: false }) !== business.name) {
    bad('Type the business name exactly to confirm deletion');
  }
  db.prepare('DELETE FROM businesses WHERE id = ?').run(business.id);
  res.json({ ok: true });
}));

// --- Clients -----------------------------------------------------------------

router.get('/clients/:clientId', wrap(async (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.clientId);
  if (!client) notFound('Client not found');

  res.json({
    client: {
      id: client.id,
      name: client.name,
      archived: !!client.archived,
      createdAt: client.created_at,
      businessName: db.prepare('SELECT name FROM businesses WHERE id = ?').get(client.business_id)?.name ?? '',
      children: db.prepare('SELECT id, name, colour, archived FROM children WHERE client_id = ?').all(client.id),
      contacts: db.prepare('SELECT id, name, email, receives_reports AS receivesReports FROM client_contacts WHERE client_id = ?').all(client.id),
      parents: db.prepare(`
        SELECT u.id, u.name, u.email FROM client_parents cp JOIN users u ON u.id = cp.user_id
         WHERE cp.client_id = ?
      `).all(client.id),
      recipients: reportRecipients(client.id),
    },
  });
}));

// --- Shifts ------------------------------------------------------------------

router.get('/shifts', wrap(async (req, res) => {
  const clientId = req.query.clientId ? String(req.query.clientId) : null;
  const rows = clientId
    ? db.prepare('SELECT * FROM shifts WHERE client_id = ? ORDER BY date DESC LIMIT 100').all(clientId)
    : db.prepare('SELECT * FROM shifts ORDER BY date DESC, created_at DESC LIMIT 100').all();

  res.json({
    shifts: rows.map((s) => ({
      id: s.id,
      clientId: s.client_id,
      clientName: db.prepare('SELECT name FROM clients WHERE id = ?').get(s.client_id)?.name ?? '(deleted)',
      businessName: db.prepare('SELECT name FROM businesses WHERE id = ?').get(s.business_id)?.name ?? '(deleted)',
      sitterName: db.prepare('SELECT name FROM users WHERE id = ?').get(s.sitter_user_id)?.name ?? '(deleted)',
      date: s.date,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      status: shiftStatus(s),
      minutes: shiftMinutes(s),
      reportSentAt: s.report_sent_at,
      events: count('SELECT COUNT(*) n FROM events WHERE shift_id = ?', s.id),
    })),
  });
}));

router.post('/shifts/:shiftId/resend-report', wrap(async (req, res) => {
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.shiftId);
  if (!shift) notFound('Shift not found');
  if (!shift.started_at) bad('That shift has not been worked yet');
  res.json({ result: await sendShiftReport(shift) });
}));

// --- Mail --------------------------------------------------------------------

router.get('/email-log', wrap(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const rows = status
    ? db.prepare('SELECT * FROM email_log WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status)
    : db.prepare('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 200').all();
  res.json({
    entries: rows.map((e) => ({
      id: e.id, shiftId: e.shift_id, invoiceId: e.invoice_id, to: e.to_email,
      subject: e.subject, status: e.status, error: e.error, createdAt: e.created_at,
    })),
  });
}));

router.post('/mail/verify', wrap(async (_req, res) => {
  res.json({ result: await verifyTransport() });
}));

router.post('/mail/test', wrap(async (req, res) => {
  const to = str(req.body.to, 'Recipient', { max: 320 });
  res.json({
    result: await sendMail({
      to,
      subject: 'Sitter Log test message',
      text: 'SMTP is configured correctly. This is a test message from the admin console.',
      html: '<p>SMTP is configured correctly.</p><p>This is a test message from the Sitter Log admin console.</p>',
    }),
  });
}));

// --- Maintenance -------------------------------------------------------------

router.post('/maintenance/vacuum', wrap(async (_req, res) => {
  const before = fileSize(DB_PATH);
  db.exec('VACUUM');
  res.json({ ok: true, beforeBytes: before, afterBytes: fileSize(DB_PATH) });
}));

router.post('/maintenance/backup', wrap(async (_req, res) => {
  const target = `${DB_PATH}.backup-${new Date().toISOString().slice(0, 10)}`;
  // VACUUM INTO writes a consistent snapshot without stopping writers.
  db.prepare('VACUUM INTO ?').run(target);
  res.json({ ok: true, path: target, bytes: fileSize(target) });
}));

router.post('/maintenance/prune', wrap(async (_req, res) => {
  const now = nowIso();
  const logins = db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(now).changes;
  const invites = db.prepare('DELETE FROM invites WHERE used_by IS NULL AND expires_at < ?').run(now).changes;
  const emails = db.prepare("DELETE FROM email_log WHERE created_at < date('now','-90 days')").run().changes;
  res.json({ ok: true, expiredLogins: logins, expiredInvites: invites, oldEmailLogs: emails });
}));

router.get('/whoami', (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name });
});
