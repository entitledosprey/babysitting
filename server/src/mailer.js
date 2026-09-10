import nodemailer from 'nodemailer';
import { db } from './db.js';
import { newId, nowIso } from './auth.js';

const cfg = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || 587,
  // Implicit TLS (port 465). Port 587 upgrades via STARTTLS, which nodemailer
  // negotiates automatically when secure is false.
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || '',
};

export const mailConfigured = () => Boolean(cfg.host && cfg.from);

export const mailSettings = () => ({
  configured: mailConfigured(),
  host: cfg.host,
  port: cfg.port,
  secure: cfg.secure,
  from: cfg.from,
  authenticated: Boolean(cfg.user),
});

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
    console.error('[mail] delivery failed to %s: %s', to, err?.message);
    logDelivery(sessionId, to, subject, 'failed', err?.message ?? 'unknown error');
    return { ok: false, error: err?.message ?? 'unknown error' };
  }
}

/** Used by the admin console to check credentials without sending anything. */
export async function verifyTransport() {
  if (!mailConfigured()) return { ok: false, error: 'SMTP is not configured' };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? 'unknown error' };
  }
}
