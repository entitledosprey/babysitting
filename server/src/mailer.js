import nodemailer from 'nodemailer';
import { db } from './db.js';
import { newId, nowIso } from './auth.js';

const port = Number(process.env.SMTP_PORT) || 587;
const declaredSecure = process.env.SMTP_SECURE === 'true';

// Port 465 is implicit TLS everywhere in practice: the server expects a
// handshake immediately and never sends a plaintext greeting. Connecting
// without TLS there hangs until timeout and reports "Greeting never received",
// which points at the network rather than the real cause. Treat 465 as secure
// regardless of what the environment says, and say so.
const secure = declaredSecure || port === 465;

const warnings = [];
if (port === 465 && !declaredSecure) {
  warnings.push('SMTP_PORT is 465, which requires TLS on connect — using secure mode despite SMTP_SECURE=false.');
}
if (port === 587 && declaredSecure) {
  warnings.push('SMTP_PORT is 587 with SMTP_SECURE=true. Port 587 normally upgrades via STARTTLS; set SMTP_SECURE=false unless your provider says otherwise.');
}

const from = (process.env.SMTP_FROM || '').trim();
// Either "user@host" or "Display Name <user@host>". A bare display name with a
// loose address is not a valid From header and providers reject it.
const FROM_RE = /^(?:[^<>]*<\s*[^<>@\s]+@[^<>@\s]+\s*>|[^<>@\s]+@[^<>@\s]+)$/;
if (from && !FROM_RE.test(from)) {
  warnings.push(`SMTP_FROM is not a valid address. Use "you@example.com" or "Display Name <you@example.com>" — angle brackets are required around the address.`);
}

for (const w of warnings) console.warn('[mail] %s', w);

const cfg = {
  host: process.env.SMTP_HOST || '',
  port,
  secure,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from,
};

export const mailConfigured = () => Boolean(cfg.host && cfg.from);

export const configWarnings = () => [...warnings];

export const mailSettings = () => ({
  configured: mailConfigured(),
  host: cfg.host,
  port: cfg.port,
  secure: cfg.secure,
  from: cfg.from,
  authenticated: Boolean(cfg.user),
  warnings: [...warnings],
});

/** Turns opaque SMTP failures into something that names the likely cause. */
export function explainMailError(message) {
  const m = String(message ?? '');
  if (/greeting never received|ETIMEDOUT|ESOCKET/i.test(m)) {
    return `${m} — this usually means a TLS mismatch: use SMTP_SECURE=true on port 465, or SMTP_SECURE=false on port 587.`;
  }
  if (/EAUTH|535|Invalid login|authentication fail/i.test(m)) {
    return `${m} — the username or password was rejected. Some providers need an app-specific password.`;
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) {
    return `${m} — SMTP_HOST could not be resolved.`;
  }
  if (/ECONNREFUSED/i.test(m)) {
    return `${m} — nothing is listening on that host and port.`;
  }
  if (/from|sender|5\.7\.1|not allowed to send/i.test(m) && /reject|denied|not allowed/i.test(m)) {
    return `${m} — the SMTP account may not be permitted to send as SMTP_FROM.`;
  }
  return m;
}

let transport = null;

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      // A stuck SMTP server must not hold a request open.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

const logDelivery = (sessionId, to, subject, status, error = '') => {
  db.prepare(`
    INSERT INTO email_log (id, session_id, to_email, subject, status, error, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(newId(), sessionId ?? null, to, subject, status, String(error).slice(0, 500), nowIso());
};

/**
 * Sends one message and records the outcome. Never throws: delivery is a
 * side effect of closing out a session and must not fail that request.
 */
export async function sendMail({ to, subject, text, html, sessionId = null }) {
  if (!mailConfigured()) {
    logDelivery(sessionId, to, subject, 'skipped', 'SMTP is not configured');
    return { ok: false, skipped: true };
  }
  try {
    await getTransport().sendMail({ from: cfg.from, to, subject, text, html });
    logDelivery(sessionId, to, subject, 'sent');
    return { ok: true };
  } catch (err) {
    const error = explainMailError(err?.message ?? 'unknown error');
    console.error('[mail] delivery failed to %s: %s', to, error);
    logDelivery(sessionId, to, subject, 'failed', error);
    return { ok: false, error };
  }
}

/** Used by the admin console to check credentials without sending anything. */
export async function verifyTransport() {
  if (!mailConfigured()) return { ok: false, error: 'SMTP is not configured' };
  try {
    await getTransport().verify();
    return { ok: true, warnings: [...warnings] };
  } catch (err) {
    return { ok: false, error: explainMailError(err?.message ?? 'unknown error') };
  }
}
