import { Router } from 'express';
import { statSync } from 'node:fs';
import { db } from '../db.js';
import { hashPassword, nowIso, adminCount } from '../auth.js';
import { wrap, str, bad, notFound, HttpError } from '../http.js';
import { mailSettings, verifyTransport, sendMail } from '../mailer.js';
import { sendSessionReport, reportRecipients } from '../report-email.js';

export const router = Router();

const DB_PATH = process.env.DB_PATH || './data/babysitting.db';

const count = (sql, ...args) => db.prepare(sql).get(...args).n;

const fileSize = (path) => {
  try { return statSync(path).size; } catch { return 0; }
};

// --- Overview ----------------------------------------------------------------

router.get('/overview', wrap(async (_req, res) => {
  const recentFailures = db.prepare(`
    SELECT to_email, subject, error, created_at FROM email_log
     WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10
  `).all();

  res.json({
    counts: {
      users:     count('SELECT COUNT(*) n FROM users'),
      disabled:  count('SELECT COUNT(*) n FROM users WHERE disabled = 1'),
      families:  count('SELECT COUNT(*) n FROM families'),
      children:  count('SELECT COUNT(*) n FROM children WHERE archived = 0'),
      sessions:  count('SELECT COUNT(*) n FROM sessions'),
      open:      count('SELECT COUNT(*) n FROM sessions WHERE ended_at IS NULL'),
      events:    count('SELECT COUNT(*) n FROM events'),
      invites:   count('SELECT COUNT(*) n FROM invites WHERE used_by IS NULL AND expires_at > ?', nowIso()),
      logins:    count('SELECT COUNT(*) n FROM auth_sessions WHERE expires_at > ?', nowIso()),
    },
    storage: {
      dbBytes:  fileSize(DB_PATH),
      walBytes: fileSize(`${DB_PATH}-wal`),
      path: DB_PATH,
    },
    mail: { ...mailSettings(), adminCount: adminCount(), recentFailures },
    runtime: {
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      rssBytes: process.memoryUsage().rss,
      now: nowIso(),
    },
    activity: {
      last7Days: db.prepare(`
        SELECT date, COUNT(*) AS sessions FROM sessions
         WHERE date >= date('now', '-7 days') GROUP BY date ORDER BY date DESC
      `).all(),
    },
  });
}));

// --- Users -------------------------------------------------------------------

const userRow = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  disabled: !!u.disabled,
  createdAt: u.created_at,
  lastSeenAt: u.last_seen_at,
  families: db.prepare(`
    SELECT f.id, f.name, m.role FROM memberships m
      JOIN families f ON f.id = m.family_id WHERE m.user_id = ?
  `).all(u.id),
});

router.get('/users', wrap(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const rows = q
    ? db.prepare(`
        SELECT * FROM users WHERE email LIKE ? OR name LIKE ?
         ORDER BY created_at DESC LIMIT 200
      `).all(`%${q}%`, `%${q}%`)
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
  // Disabling should take effect immediately, not at token expiry.
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

  // Families the user is the last parent of would be left unmanageable, so
  // surface that rather than silently orphaning them.
  const orphaned = db.prepare(`
    SELECT f.id, f.name FROM memberships m JOIN families f ON f.id = m.family_id
     WHERE m.user_id = ? AND m.role = 'parent'
       AND (SELECT COUNT(*) FROM memberships m2
             WHERE m2.family_id = f.id AND m2.role = 'parent') = 1
  `).all(u.id);

  if (orphaned.length && req.query.force !== 'true') {
    throw new HttpError(409, `That user is the only parent of: ${orphaned.map((f) => f.name).join(', ')}. Retry with force=true to delete anyway.`);
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.json({ ok: true, orphanedFamilies: orphaned });
}));

// --- Families ----------------------------------------------------------------

router.get('/families', wrap(async (_req, res) => {
  res.json({
    families: db.prepare(`
      SELECT f.id, f.name, f.created_at AS createdAt,
             (SELECT COUNT(*) FROM memberships m WHERE m.family_id = f.id) AS members,
             (SELECT COUNT(*) FROM children c  WHERE c.family_id = f.id AND c.archived = 0) AS children,
             (SELECT COUNT(*) FROM sessions s  WHERE s.family_id = f.id) AS sessions
        FROM families f ORDER BY f.created_at DESC LIMIT 200
    `).all(),
  });
}));

router.get('/families/:familyId', wrap(async (req, res) => {
  const family = db.prepare('SELECT * FROM families WHERE id = ?').get(req.params.familyId);
  if (!family) notFound('Family not found');

  res.json({
    family: {
      id: family.id, name: family.name, createdAt: family.created_at,
      members: db.prepare(`
        SELECT u.id, u.name, u.email, m.role, u.disabled FROM memberships m
          JOIN users u ON u.id = m.user_id WHERE m.family_id = ? ORDER BY m.role, u.name
      `).all(family.id),
      children: db.prepare('SELECT id, name, colour, archived FROM children WHERE family_id = ? ORDER BY name').all(family.id),
      sessions: db.prepare(`
        SELECT s.id, s.date, s.started_at AS startedAt, s.ended_at AS endedAt,
               s.report_sent_at AS reportSentAt,
               (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS events
          FROM sessions s WHERE s.family_id = ? ORDER BY s.started_at DESC LIMIT 100
      `).all(family.id),
      recipients: reportRecipients(family.id),
    },
  });
}));

router.delete('/families/:familyId', wrap(async (req, res) => {
  const family = db.prepare('SELECT * FROM families WHERE id = ?').get(req.params.familyId);
  if (!family) notFound('Family not found');
  if (str(req.body?.confirmName ?? '', 'Confirmation', { required: false }) !== family.name) {
    bad('Type the family name exactly to confirm deletion');
  }
  db.prepare('DELETE FROM families WHERE id = ?').run(family.id);
  res.json({ ok: true });
}));

// --- Sessions ----------------------------------------------------------------

router.get('/sessions', wrap(async (req, res) => {
  const familyId = req.query.familyId ? String(req.query.familyId) : null;
  const rows = familyId
    ? db.prepare('SELECT * FROM sessions WHERE family_id = ? ORDER BY started_at DESC LIMIT 100').all(familyId)
    : db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 100').all();

  res.json({
    sessions: rows.map((s) => ({
      id: s.id,
      familyId: s.family_id,
      familyName: db.prepare('SELECT name FROM families WHERE id = ?').get(s.family_id)?.name ?? '(deleted)',
      sitterName: db.prepare('SELECT name FROM users WHERE id = ?').get(s.sitter_user_id)?.name ?? '(deleted)',
      date: s.date,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      reportSentAt: s.report_sent_at,
      events: count('SELECT COUNT(*) n FROM events WHERE session_id = ?', s.id),
    })),
  });
}));

router.post('/sessions/:sessionId/resend-report', wrap(async (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.sessionId);
  if (!session) notFound('Session not found');
  res.json({ result: await sendSessionReport(session) });
}));

// --- Mail --------------------------------------------------------------------

router.get('/email-log', wrap(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const rows = status
    ? db.prepare('SELECT * FROM email_log WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status)
    : db.prepare('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 200').all();
  res.json({
    entries: rows.map((e) => ({
      id: e.id, sessionId: e.session_id, to: e.to_email, subject: e.subject,
      status: e.status, error: e.error, createdAt: e.created_at,
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
  const sessions = db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(now).changes;
  const invites = db.prepare('DELETE FROM invites WHERE used_by IS NULL AND expires_at < ?').run(now).changes;
  const emails = db.prepare("DELETE FROM email_log WHERE created_at < date('now','-90 days')").run().changes;
  res.json({ ok: true, expiredLogins: sessions, expiredInvites: invites, oldEmailLogs: emails });
}));

// Used by the UI to label the current operator.
router.get('/whoami', (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name });
});
