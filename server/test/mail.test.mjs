import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSmtpSink } from './smtp-sink.mjs';

const PORT = 8097;
const BASE = `http://127.0.0.1:${PORT}`;
let child, dir, sink;

before(async () => {
  sink = await startSmtpSink();
  dir = mkdtempSync(join(tmpdir(), 'bs-mail-'));
  child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'src/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: join(dir, 'mail.db'),
      SECURE_COOKIES: 'false',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(sink.port),
      SMTP_SECURE: 'false',
      SMTP_FROM: 'Sitter Log <log@example.com>',
      APP_BASE_URL: 'https://babysitting.example.com',
      ADMIN_EMAILS: 'admin@example.com',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(() => {
  child?.kill();
  sink?.close();
  rmSync(dir, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (m, p, b) => {
    const res = await fetch(BASE + p, {
      method: m,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) cookie = c.split(';')[0];
    const t = await res.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: res.status, body: j };
  };
}

const parent = client();
const sitter = client();
const state = {};
const waitForMail = async (n) => {
  for (let i = 0; i < 60; i++) {
    if (sink.received.length >= n) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`expected ${n} message(s), saw ${sink.received.length}`);
};

test('a family with a parent and a sitter', async () => {
  const p = await parent('POST', '/api/auth/register', {
    email: 'mum@example.com', password: 'parent-password-1', name: 'Mum', familyName: 'The Testers',
  });
  assert.equal(p.status, 201);
  state.familyId = p.body.user.families[0].id;

  const inv = await parent('POST', `/api/families/${state.familyId}/invites`, { role: 'sitter' });
  await sitter('POST', '/api/auth/register', {
    email: 'sitter@example.com', password: 'sitter-password-1', name: 'Sitter Sam',
    inviteCode: inv.body.invite.code,
  });

  state.childId = (await parent('POST', `/api/families/${state.familyId}/children`, { name: 'Robin' })).body.child.id;
});

test('closing a session emails the report to the parent only', async () => {
  const sid = (await sitter('POST', `/api/families/${state.familyId}/sessions`, {
    childIds: [state.childId],
  })).body.session.id;
  state.sessionId = sid;

  await sitter('POST', `/api/sessions/${sid}/events`, {
    type: 'bottle', childId: state.childId, detail: { amountOz: 6, contents: 'formula' },
  });
  await sitter('POST', `/api/sessions/${sid}/events`, {
    type: 'milestone', childId: state.childId, note: 'Rolled over on their own', detail: { kind: 'Developmental milestone' },
  });
  assert.equal((await sitter('POST', `/api/sessions/${sid}/end`, {})).status, 200);

  await waitForMail(1);
  assert.equal(sink.received.length, 1, 'exactly one message: the parent, not the sitter');

  const msg = sink.received[0];
  assert.match(msg.from, /log@example\.com/);
  assert.equal(msg.to.length, 1);
  assert.match(msg.to[0], /mum@example\.com/);
  assert.ok(!msg.to.some((t) => t.includes('sitter@')), 'sitters must not receive the report');
});

const qpDecode = (s) => Buffer.from(
  s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi,
    (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');

/**
 * The subject contains em dashes, so nodemailer emits it as RFC 2047
 * encoded-words, folded across continuation lines. Unfold, then decode each
 * encoded-word.
 */
const decodeSubject = (raw) => {
  const m = /^Subject: ((?:.*\n(?:[ \t].*\n)*))/m.exec(raw);
  if (!m) return '';
  const unfolded = m[1].replace(/\n[ \t]/g, '').trim();
  return unfolded.replace(/=\?UTF-8\?Q\?(.*?)\?=/gi,
    (_, body) => qpDecode(body.replace(/_/g, ' ')));
};

test('the message carries both a text and an HTML part with real content', async () => {
  const raw = sink.received[0].data;
  assert.match(decodeSubject(raw), /^Daily report — Robin — /,
    'subject survives encoded-word round trip');
  assert.match(raw, /multipart\/alternative/i);

  const decoded = qpDecode(raw);

  assert.match(decoded, /DAILY CHILDCARE REPORT/, 'plain text part');
  assert.match(decoded, /<!doctype html>/i, 'html part');
  assert.match(decoded, /Robin/, 'the child is named');
  assert.match(decoded, /The Testers/, 'the family is named');
  assert.match(decoded, /Rolled over on their own/, 'the milestone made it in');
  assert.match(decoded, /6 oz/, 'the bottle made it in');
  assert.match(decoded, /babysitting\.example\.com/, 'APP_BASE_URL link included');
});

test('delivery is recorded as sent and stamped on the session', async () => {
  const adminClient = client();
  await adminClient('POST', '/api/auth/register', {
    email: 'admin@example.com', password: 'admin-password-1', name: 'Admin', familyName: 'Admin Family',
  });

  const log = await adminClient('GET', '/api/admin/email-log');
  const entry = log.body.entries.find((e) => e.sessionId === state.sessionId);
  assert.ok(entry, 'delivery logged');
  assert.equal(entry.status, 'sent');
  assert.equal(entry.error, '');

  const sessions = await adminClient('GET', '/api/admin/sessions');
  const s = sessions.body.sessions.find((x) => x.id === state.sessionId);
  assert.ok(s.reportSentAt, 'session stamped with report_sent_at');
});

test('an admin resend delivers again', async () => {
  const adminClient = client();
  await adminClient('POST', '/api/auth/login', { email: 'admin@example.com', password: 'admin-password-1' });

  const before = sink.received.length;
  const r = await adminClient('POST', `/api/admin/sessions/${state.sessionId}/resend-report`);
  assert.equal(r.status, 200);
  assert.equal(r.body.result.sent, 1);

  await waitForMail(before + 1);
  assert.equal(sink.received.length, before + 1);
});

test('a test message can be sent from the admin console', async () => {
  const adminClient = client();
  await adminClient('POST', '/api/auth/login', { email: 'admin@example.com', password: 'admin-password-1' });

  const before = sink.received.length;
  const r = await adminClient('POST', '/api/admin/mail/test', { to: 'someone@example.com' });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.ok, true);

  await waitForMail(before + 1);
  assert.match(sink.received[before].to[0], /someone@example\.com/);
});

test('SMTP verify succeeds against a live server', async () => {
  const adminClient = client();
  await adminClient('POST', '/api/auth/login', { email: 'admin@example.com', password: 'admin-password-1' });
  const r = await adminClient('POST', '/api/admin/mail/verify');
  assert.equal(r.body.result.ok, true);
});
