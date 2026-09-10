import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import {
  hashPassword, verifyPassword, createAuthSession, destroyAuthSession,
  cookieOptions, COOKIE_NAME, requireAuth, newId, nowIso,
  checkRateLimit, clearRateLimit,
} from '../auth.js';
import { wrap, str, bad, HttpError } from '../http.js';

export const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const familiesFor = (userId) => db.prepare(`
  SELECT f.id, f.name, m.role
    FROM memberships m JOIN families f ON f.id = m.family_id
   WHERE m.user_id = ?
   ORDER BY f.name
`).all(userId);

const publicUser = (user) => ({ ...user, families: familiesFor(user.id) });

/**
 * Register. Either creates a brand-new family (caller becomes its parent) or
 * consumes an invite code to join an existing one with the invited role.
 */
router.post('/register', wrap(async (req, res) => {
  const email = str(req.body.email, 'Email', { max: 320 }).toLowerCase();
  if (!EMAIL_RE.test(email)) bad('Enter a valid email address');
  const password = String(req.body.password ?? '');
  if (password.length < 8) bad('Password must be at least 8 characters');
  if (password.length > 200) bad('Password is too long');
  const name = str(req.body.name, 'Name', { max: 100 });
  const inviteCode = req.body.inviteCode ? str(req.body.inviteCode, 'Invite code', { max: 40 }).toUpperCase() : null;

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    bad('An account with that email already exists');
  }

  let invite = null;
  if (inviteCode) {
    invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(inviteCode);
    if (!invite || invite.used_by || invite.expires_at < nowIso()) {
      bad('That invite code is not valid or has expired');
    }
  } else {
    str(req.body.familyName, 'Family name', { max: 100 });
  }

  const hash = await hashPassword(password);
  const userId = newId();
  const now = nowIso();

  const tx = db.prepare('BEGIN');
  tx.run();
  try {
    db.prepare('INSERT INTO users (id,email,password_hash,name,created_at) VALUES (?,?,?,?,?)')
      .run(userId, email, hash, name, now);

    if (invite) {
      db.prepare('INSERT INTO memberships (user_id,family_id,role,created_at) VALUES (?,?,?,?)')
        .run(userId, invite.family_id, invite.role, now);
      db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?')
        .run(userId, now, invite.code);
    } else {
      const familyId = newId();
      db.prepare('INSERT INTO families (id,name,created_at) VALUES (?,?,?)')
        .run(familyId, str(req.body.familyName, 'Family name', { max: 100 }), now);
      db.prepare('INSERT INTO memberships (user_id,family_id,role,created_at) VALUES (?,?,?,?)')
        .run(userId, familyId, 'parent', now);
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

  const row = db.prepare('SELECT id,email,name,password_hash FROM users WHERE email = ?').get(email);
  // Hash even when the user is missing, so a wrong email and a wrong password
  // take the same amount of time.
  const ok = await verifyPassword(password, row?.password_hash ?? (await hashPassword('placeholder')));
  if (!row || !ok) throw new HttpError(401, 'Email or password is incorrect');

  clearRateLimit(key);
  const { token, expires } = createAuthSession(row.id);
  res.cookie(COOKIE_NAME, token, cookieOptions(expires));
  res.json({ user: publicUser({ id: row.id, email: row.email, name: row.name }) });
}));

router.post('/logout', (req, res) => {
  destroyAuthSession(req.authToken);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/** Join another family from inside an existing account. */
router.post('/join', requireAuth, wrap(async (req, res) => {
  const code = str(req.body.inviteCode, 'Invite code', { max: 40 }).toUpperCase();
  const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
  if (!invite || invite.used_by || invite.expires_at < nowIso()) {
    bad('That invite code is not valid or has expired');
  }
  const existing = db.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND family_id = ?')
    .get(req.user.id, invite.family_id);
  if (existing) bad('You are already a member of that family');

  const now = nowIso();
  db.prepare('INSERT INTO memberships (user_id,family_id,role,created_at) VALUES (?,?,?,?)')
    .run(req.user.id, invite.family_id, invite.role, now);
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

// Ambiguity-free alphabet: no O/0, I/1, so a code read aloud or typed from a
// phone screen lands correctly.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const makeInviteCode = () =>
  Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
