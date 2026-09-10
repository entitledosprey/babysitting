import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8098;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = 'boss@example.com';
let child;
let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bs-admin-'));
  child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'src/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: join(dir, 'admin.db'),
      SECURE_COOKIES: 'false',
      ADMIN_EMAILS: `${ADMIN_EMAIL}, spare@example.com`,
      // SMTP intentionally unset: report sends must degrade to "skipped".
      SMTP_HOST: '',
      SMTP_FROM: '',
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
  rmSync(dir, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) cookie = c.split(';')[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
}

const admin = client();
const normal = client();
const state = {};

test('setup: an admin and an ordinary user', async () => {
  const a = await admin('POST', '/api/auth/register', {
    email: ADMIN_EMAIL, password: 'admin-password-1', name: 'Boss', familyName: 'Boss Family',
  });
  assert.equal(a.status, 201);
  assert.equal(a.body.user.isAdmin, true, 'ADMIN_EMAILS should mark this account admin');

  const n = await normal('POST', '/api/auth/register', {
    email: 'parent@example.com', password: 'parent-password-1', name: 'Parent', familyName: 'Normal Family',
  });
  assert.equal(n.status, 201);
  assert.equal(n.body.user.isAdmin, false);
  state.userId = n.body.user.id;
  state.familyId = n.body.user.families[0].id;
});

test('the admin surface is invisible to ordinary users', async () => {
  for (const path of ['/api/admin/overview', '/api/admin/users', '/api/admin/families',
                      '/api/admin/sessions', '/api/admin/email-log']) {
    const r = await normal('GET', path);
    assert.equal(r.status, 404, `${path} must 404 for a non-admin`);
  }
  const w = await normal('POST', '/api/admin/maintenance/vacuum');
  assert.equal(w.status, 404, 'destructive admin routes must 404 too');
});

test('the admin surface requires a signed-in user at all', async () => {
  assert.equal((await client()('GET', '/api/admin/overview')).status, 401);
});

test('overview reports real counts', async () => {
  const r = await admin('GET', '/api/admin/overview');
  assert.equal(r.status, 200);
  assert.equal(r.body.counts.users, 2);
  assert.equal(r.body.counts.families, 2);
  assert.equal(r.body.mail.configured, false, 'SMTP is unset in this run');
  assert.equal(r.body.mail.adminCount, 2);
  assert.ok(r.body.storage.dbBytes > 0);
  assert.ok(r.body.runtime.uptimeSeconds >= 0);
});

test('user search finds by email fragment', async () => {
  const r = await admin('GET', '/api/admin/users?q=parent@');
  assert.equal(r.status, 200);
  assert.equal(r.body.users.length, 1);
  assert.equal(r.body.users[0].email, 'parent@example.com');
  assert.equal(r.body.users[0].families[0].role, 'parent');
});

test('disabling a user blocks sign-in and kills live sessions', async () => {
  const victim = client();
  await victim('POST', '/api/auth/register', {
    email: 'victim@example.com', password: 'victim-password-1', name: 'Victim', familyName: 'Victim Family',
  });
  const vid = (await admin('GET', '/api/admin/users?q=victim@')).body.users[0].id;
  assert.equal((await victim('GET', '/api/auth/me')).status, 200, 'signed in before disabling');

  const d = await admin('PATCH', `/api/admin/users/${vid}`, { disabled: true });
  assert.equal(d.status, 200);
  assert.equal(d.body.user.disabled, true);

  assert.equal((await victim('GET', '/api/auth/me')).status, 401, 'existing session revoked');
  const login = await client()('POST', '/api/auth/login', {
    email: 'victim@example.com', password: 'victim-password-1',
  });
  assert.equal(login.status, 403, 'disabled account cannot sign back in');

  await admin('PATCH', `/api/admin/users/${vid}`, { disabled: false });
  assert.equal((await client()('POST', '/api/auth/login', {
    email: 'victim@example.com', password: 'victim-password-1',
  })).status, 200, 're-enabling restores access');
});

test('admin password reset works and invalidates old sessions', async () => {
  const r = await admin('POST', `/api/admin/users/${state.userId}/password`, { newPassword: 'a-fresh-password' });
  assert.equal(r.status, 200);
  assert.equal((await normal('GET', '/api/auth/me')).status, 401, 'old session revoked');
  assert.equal((await client()('POST', '/api/auth/login', {
    email: 'parent@example.com', password: 'a-fresh-password',
  })).status, 200);
});

test('short reset passwords are rejected', async () => {
  const r = await admin('POST', `/api/admin/users/${state.userId}/password`, { newPassword: 'short' });
  assert.equal(r.status, 400);
});

test('deleting the only parent of a family needs force', async () => {
  const r = await admin('DELETE', `/api/admin/users/${state.userId}`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /only parent/i);
  assert.equal((await admin('DELETE', `/api/admin/users/${state.userId}?force=true`)).status, 200);
});

test('an admin cannot delete their own signed-in account', async () => {
  const me = (await admin('GET', '/api/admin/users?q=boss@')).body.users[0];
  const r = await admin('DELETE', `/api/admin/users/${me.id}`);
  assert.equal(r.status, 400);
});

test('family deletion requires typing the name', async () => {
  const fam = (await admin('GET', '/api/admin/families')).body.families.find((f) => f.name === 'Boss Family');
  assert.equal((await admin('DELETE', `/api/admin/families/${fam.id}`, { confirmName: 'wrong' })).status, 400);
});

test('report send without SMTP is recorded as skipped, not lost', async () => {
  // Build a real finished session on the admin's own family.
  const fam = (await admin('GET', '/api/families')).body.families[0];
  const cid = (await admin('POST', `/api/families/${fam.id}/children`, { name: 'Kid' })).body.child.id;
  const sid = (await admin('POST', `/api/families/${fam.id}/sessions`, { childIds: [cid] })).body.session.id;
  await admin('POST', `/api/sessions/${sid}/events`, { type: 'bottle', childId: cid, detail: { amountOz: 4 } });
  assert.equal((await admin('POST', `/api/sessions/${sid}/end`, {})).status, 200);

  // The send is fired without awaiting, so give it a moment to land.
  await new Promise((r) => setTimeout(r, 300));

  const log = await admin('GET', '/api/admin/email-log');
  assert.equal(log.status, 200);
  const entry = log.body.entries.find((e) => e.sessionId === sid);
  assert.ok(entry, 'closing a session must record a delivery attempt');
  assert.equal(entry.status, 'skipped');
  assert.match(entry.subject, /Daily report/);
  assert.equal(entry.to, ADMIN_EMAIL, 'the parent of the family is the recipient');

  const resend = await admin('POST', `/api/admin/sessions/${sid}/resend-report`);
  assert.equal(resend.status, 200);
  assert.equal(resend.body.result.configured, false);
});

test('maintenance actions run', async () => {
  const v = await admin('POST', '/api/admin/maintenance/vacuum');
  assert.equal(v.status, 200);
  assert.ok(v.body.afterBytes > 0);

  const p = await admin('POST', '/api/admin/maintenance/prune');
  assert.equal(p.status, 200);
  assert.equal(typeof p.body.expiredLogins, 'number');

  const b = await admin('POST', '/api/admin/maintenance/backup');
  assert.equal(b.status, 200);
  assert.ok(b.body.bytes > 0);
});

test('mail verify reports unconfigured rather than throwing', async () => {
  const r = await admin('POST', '/api/admin/mail/verify');
  assert.equal(r.status, 200);
  assert.equal(r.body.result.ok, false);
  assert.match(r.body.result.error, /not configured/i);
});
