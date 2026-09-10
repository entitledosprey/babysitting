import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import {
  hashPassword, verifyPassword, createAuthSession, destroyAuthSession,
  cookieOptions, COOKIE_NAME, requireAuth, newId, nowIso,
  checkRateLimit, clearRateLimit, isAdmin,
} from '../auth.js';
import { businessOf } from '../access.js';
import { wrap, str, bad, HttpError } from '../http.js';

export const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Ambiguity-free alphabet: no O/0 or I/1, so a code read aloud lands right. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeInviteCode = () =>
  Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

/**
 * What the client needs to decide which app to render: the sitter's business,
 * any clients they can view as a parent, and whether they administer the
 * platform. A user with none of the three has an account and nothing else.
 */
const publicUser = (user) => {
  const business = businessOf(user.id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: isAdmin(user),
    business: business ? { id: business.id, name: business.name } : null,
    parentOf: db.prepare(`
      SELECT c.id, c.name, b.name AS businessName
        FROM client_parents cp
        JOIN clients c   ON c.id = cp.client_id
        JOIN businesses b ON b.id = c.business_id
       WHERE cp.user_id = ?
       ORDER BY c.name
    `).all(user.id),
  };
};

const consumeInvite = (code) => {
  const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
  if (!invite || invite.used_by || invite.expires_at < nowIso()) {
    bad('That invite code is not valid or has expired');
  }
  return invite;
};

/**
 * Register. Three shapes:
 *   inviteCode   → a parent joining, read-only, linked to one client
 *   businessName → a sitter starting their business
 *   neither      → allowed only for platform admins, who need no business
 */
router.post('/register', wrap(async (req, res) => {
  const email = str(req.body.email, 'Email', { max: 320 }).toLowerCase();
  if (!EMAIL_RE.test(email)) bad('Enter a valid email address');
  const password = String(req.body.password ?? '');
  if (password.length < 8) bad('Password must be at least 8 characters');
  if (password.length > 200) bad('Password is too long');
  const name = str(req.body.name, 'Name', { max: 100 });

  const inviteCode = req.body.inviteCode
    ? str(req.body.inviteCode, 'Invite code', { max: 40 }).toUpperCase() : null;
  const businessName = req.body.businessName
    ? str(req.body.businessName, 'Business name', { max: 100 }) : null;

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    bad('An account with that email already exists');
  }

  const invite = inviteCode ? consumeInvite(inviteCode) : null;
  if (!invite && !businessName && !isAdmin({ email })) {
    bad('Enter a name for your babysitting business, or an invite code if a sitter invited you');
  }

  const hash = await hashPassword(password);
  const userId = newId();
  const now = nowIso();

  db.prepare('BEGIN').run();
  try {
    db.prepare('INSERT INTO users (id,email,password_hash,name,created_at) VALUES (?,?,?,?,?)')
      .run(userId, email, hash, name, now);

    if (invite) {
      db.prepare('INSERT INTO client_parents (user_id, client_id, created_at) VALUES (?,?,?)')
        .run(userId, invite.client_id, now);
      db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?')
        .run(userId, now, invite.code);
    } else if (businessName) {
      db.prepare(`
        INSERT INTO businesses (id, owner_user_id, name, created_at) VALUES (?,?,?,?)
      `).run(newId(), userId, businessName, now);
    }
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }

  const { token, expires } = createAuthSession(userId);
  res.cookie(COOKIE_NAME, token, cookieOptions(expires));
  res.status(201).json({ user: publicUser({ id: userId, email, name }) });
}));

router.post('/login', wrap(async (req, res) => {
  const email = str(req.body.email, 'Email', { max: 320 }).toLowerCase();
  const password = String(req.body.password ?? '');

  const key = `${req.ip}:${email}`;
  if (!checkRateLimit(key)) {
    throw new HttpError(429, 'Too many sign-in attempts. Try again in a few minutes.');
  }

  const row = db.prepare('SELECT id,email,name,password_hash,disabled FROM users WHERE email = ?').get(email);
  // Hash even when the user is missing, so a wrong email and a wrong password
  // take the same amount of time.
  const ok = await verifyPassword(password, row?.password_hash ?? (await hashPassword('placeholder')));
  if (!row || !ok) throw new HttpError(401, 'Email or password is incorrect');
  if (row.disabled) throw new HttpError(403, 'That account has been disabled');

  clearRateLimit(key);
  const { token, expires } = createAuthSession(row.id);
  res.cookie(COOKIE_NAME, token, cookieOptions(expires));
  res.json({ user: publicUser(row) });
}));

router.post('/logout', (req, res) => {
  destroyAuthSession(req.authToken);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), req.user.id);
  res.json({ user: publicUser(req.user) });
});

/** Accept a parent invite from inside an existing account. */
router.post('/join', requireAuth, wrap(async (req, res) => {
  const code = str(req.body.inviteCode, 'Invite code', { max: 40 }).toUpperCase();
  const invite = consumeInvite(code);

  const existing = db.prepare('SELECT 1 FROM client_parents WHERE user_id = ? AND client_id = ?')
    .get(req.user.id, invite.client_id);
  if (existing) bad('You already have access to that family');

  const now = nowIso();
  db.prepare('INSERT INTO client_parents (user_id, client_id, created_at) VALUES (?,?,?)')
    .run(req.user.id, invite.client_id, now);
  db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?')
    .run(req.user.id, now, code);

  res.json({ user: publicUser(req.user) });
}));

router.post('/password', requireAuth, wrap(async (req, res) => {
  const current = String(req.body.currentPassword ?? '');
  const next = String(req.body.newPassword ?? '');
  if (next.length < 8) bad('New password must be at least 8 characters');

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!await verifyPassword(current, row.password_hash)) {
    throw new HttpError(401, 'Current password is incorrect');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(await hashPassword(next), req.user.id);
  // Sign every other device out.
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(req.user.id);
  const { token, expires } = createAuthSession(req.user.id);
  res.cookie(COOKIE_NAME, token, cookieOptions(expires));
  res.json({ ok: true });
}));
