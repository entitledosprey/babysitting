import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scryptAsync = promisify(scrypt);

const KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 30;
export const COOKIE_NAME = 'bs_session';

// --- Passwords ---------------------------------------------------------------

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, saltB64, keyB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scryptAsync(password, salt, expected.length, {
      ...SCRYPT_PARAMS, N: Number(n),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// --- Login sessions ----------------------------------------------------------
// The raw token goes to the cookie; only its SHA-256 is stored, so a database
// leak does not hand out live sessions.

const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function createAuthSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare(
    'INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)'
  ).run(hashToken(token), userId, expires.toISOString(), new Date().toISOString());
  return { token, expires };
}

export function destroyAuthSession(token) {
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
}

export const cookieOptions = (expires) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.SECURE_COOKIES !== 'false',
  path: '/',
  expires,
});

// --- Middleware --------------------------------------------------------------

export function loadUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.email, u.name, s.expires_at
        FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hashToken(token), new Date().toISOString());
    if (row) {
      req.user = { id: row.id, email: row.email, name: row.name };
      req.authToken = token;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

/**
 * Resolves the caller's membership in `familyId` and rejects non-members.
 * Every family-scoped route funnels through here so the tenant boundary lives
 * in exactly one place.
 */
export function membershipOf(userId, familyId) {
  return db.prepare(
    'SELECT role FROM memberships WHERE user_id = ? AND family_id = ?'
  ).get(userId, familyId);
}

export function requireFamily(getFamilyId) {
  return (req, res, next) => {
    const familyId = getFamilyId(req);
    if (!familyId) return res.status(404).json({ error: 'Not found' });
    const m = membershipOf(req.user.id, familyId);
    // 404 rather than 403: a non-member should not be able to probe which
    // family ids exist.
    if (!m) return res.status(404).json({ error: 'Not found' });
    req.familyId = familyId;
    req.role = m.role;
    next();
  };
}

export function requireParent(req, res, next) {
  if (req.role !== 'parent') {
    return res.status(403).json({ error: 'Only a parent can do that' });
  }
  next();
}

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

// --- Login throttling --------------------------------------------------------
// In-memory is sufficient: a single container, and a restart clearing the
// counters is an acceptable trade for having no extra dependency.

const attempts = new Map();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

export function checkRateLimit(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  rec.count += 1;
  return rec.count <= MAX_ATTEMPTS;
}

export function clearRateLimit(key) {
  attempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
}, WINDOW_MS).unref();
