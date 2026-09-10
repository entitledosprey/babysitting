import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bs-test-'));
  child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'src/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), DB_PATH: join(dir, 'test.db'), SECURE_COOKIES: 'false' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(() => {
  child?.kill();
  rmSync(dir, { recursive: true, force: true });
});

/** Minimal cookie-jar client so each actor keeps its own session. */
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) cookie = c.split(';')[0];
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
}

const iso = (h, m = 0) => {
  const d = new Date(2026, 8, 9, h, m, 0);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `2026-09-09T${pad(h)}:${pad(m)}:00${sign}${pad(off / 60)}:${pad(off % 60)}`;
};

const parent = client();
const sitter = client();
const outsider = client();
const state = {};

test('parent registers and gets a family', async () => {
  const r = await parent('POST', '/api/auth/register', {
    email: 'parent@example.com', password: 'correct horse battery',
    name: 'Pat Parent', familyName: 'The Parkers',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.families.length, 1);
  assert.equal(r.body.user.families[0].role, 'parent');
  state.familyId = r.body.user.families[0].id;
});

test('short passwords are rejected', async () => {
  const r = await client()('POST', '/api/auth/register', {
    email: 'x@example.com', password: 'short', name: 'X', familyName: 'Y',
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /at least 8/);
});

test('duplicate email is rejected', async () => {
  const r = await client()('POST', '/api/auth/register', {
    email: 'parent@example.com', password: 'another good password', name: 'Imposter', familyName: 'Z',
  });
  assert.equal(r.status, 400);
});

test('parent adds two children', async () => {
  for (const name of ['Ada', 'Bram']) {
    const r = await parent('POST', `/api/families/${state.familyId}/children`, { name });
    assert.equal(r.status, 201);
    state[name] = r.body.child.id;
  }
  const list = await parent('GET', `/api/families/${state.familyId}/children`);
  assert.equal(list.body.children.length, 2);
});

test('sitter joins via invite and lands in the family as a sitter', async () => {
  const inv = await parent('POST', `/api/families/${state.familyId}/invites`, { role: 'sitter' });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.invite.code.length, 8);

  const r = await sitter('POST', '/api/auth/register', {
    email: 'sitter@example.com', password: 'sitter password here',
    name: 'Sam Sitter', inviteCode: inv.body.invite.code,
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.families[0].id, state.familyId);
  assert.equal(r.body.user.families[0].role, 'sitter');
});

test('an invite cannot be reused', async () => {
  const inv = await parent('POST', `/api/families/${state.familyId}/invites`, { role: 'sitter' });
  const first = await client()('POST', '/api/auth/register', {
    email: 'one@example.com', password: 'password one here', name: 'One', inviteCode: inv.body.invite.code,
  });
  assert.equal(first.status, 201);
  const second = await client()('POST', '/api/auth/register', {
    email: 'two@example.com', password: 'password two here', name: 'Two', inviteCode: inv.body.invite.code,
  });
  assert.equal(second.status, 400);
});

test('a sitter cannot add children (parent-only)', async () => {
  const r = await sitter('POST', `/api/families/${state.familyId}/children`, { name: 'Sneaky' });
  assert.equal(r.status, 403);
});

test('sitter starts a session covering both children', async () => {
  const r = await sitter('POST', `/api/families/${state.familyId}/sessions`, {
    childIds: [state.Ada, state.Bram], startedAt: iso(9),
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.session.children.length, 2);
  assert.equal(r.body.session.date, '2026-09-09');
  state.sessionId = r.body.session.id;
});

test('nap start/stop produces an exact duration block', async () => {
  const start = await sitter('POST', `/api/sessions/${state.sessionId}/events`, {
    type: 'nap', childId: state.Ada, startAt: iso(13, 12),
  });
  assert.equal(start.status, 201);
  assert.equal(start.body.event.endAt, null);
  state.napId = start.body.event.id;

  const dup = await sitter('POST', `/api/sessions/${state.sessionId}/events`, {
    type: 'nap', childId: state.Ada, startAt: iso(13, 20),
  });
  assert.equal(dup.status, 409, 'a second running nap for the same child must be refused');

  const stop = await sitter('POST', `/api/events/${state.napId}/stop`, {
    endAt: iso(14, 48), detail: { fellAsleep: 'independently', moodOnWaking: 'happy' },
  });
  assert.equal(stop.status, 200);
  assert.equal(stop.body.event.endAt, iso(14, 48));
});

test('end time before start time is rejected', async () => {
  const r = await sitter('POST', `/api/sessions/${state.sessionId}/events`, {
    type: 'nap', childId: state.Bram, startAt: iso(15), endAt: iso(14),
  });
  assert.equal(r.status, 400);
});

test('a point-in-time type refuses a duration', async () => {
  const r = await sitter('POST', `/api/sessions/${state.sessionId}/events`, {
    type: 'diaper', childId: state.Ada, startAt: iso(15), endAt: iso(16),
  });
  assert.equal(r.status, 400);
});

test('unknown event type is rejected', async () => {
  const r = await sitter('POST', `/api/sessions/${state.sessionId}/events`, {
    type: 'skydiving', childId: state.Ada, startAt: iso(15),
  });
  assert.equal(r.status, 400);
});

test('logging a spread of entries across both children', async () => {
  const entries = [
    { type: 'bottle', childId: state.Ada, startAt: iso(15, 0), detail: { amountOz: 6, contents: 'formula' } },
    { type: 'diaper', childId: state.Ada, startAt: iso(15, 5), detail: { wet: true } },
    { type: 'diaper', childId: state.Ada, startAt: iso(17, 0), detail: { wet: true, dirty: true } },
    { type: 'snack', childId: state.Bram, startAt: iso(15, 30), detail: { food: 'apple slices' } },
    { type: 'potty', childId: state.Bram, startAt: iso(16, 0), detail: { pee: true } },
    { type: 'milestone', childId: state.Ada, startAt: iso(16, 30), note: 'said "banana"', detail: { kind: 'New word' } },
    { type: 'activity', childId: state.Bram, startAt: iso(10), endAt: iso(11), detail: { kind: 'Outside play' } },
  ];
  for (const e of entries) {
    const r = await sitter('POST', `/api/sessions/${state.sessionId}/events`, e);
    assert.equal(r.status, 201, `${e.type} should be accepted: ${JSON.stringify(r.body)}`);
  }
});

test('report totals are correct and grouped per child', async () => {
  const r = await sitter('GET', `/api/sessions/${state.sessionId}/report`);
  assert.equal(r.status, 200);
  const { children } = r.body.report;
  assert.equal(children.length, 2);

  const ada = children.find((c) => c.child.name === 'Ada');
  assert.equal(ada.sleep.napCount, 1);
  assert.equal(ada.sleep.totalMinutes, 96, '1:12 PM to 2:48 PM is 96 minutes');
  assert.equal(ada.food.bottleCount, 1);
  assert.equal(ada.food.totalOz, 6);
  assert.equal(ada.diapering.total, 2);
  assert.equal(ada.diapering.wet, 2);
  assert.equal(ada.diapering.dirty, 1);
  assert.equal(ada.observations.milestones.length, 1);

  const bram = children.find((c) => c.child.name === 'Bram');
  assert.equal(bram.sleep.napCount, 0);
  assert.equal(bram.food.snackCount, 1);
  assert.equal(bram.diapering.pottyCount, 1);
  assert.equal(bram.activities.totalMinutes, 60);
});

test('text report renders', async () => {
  const r = await sitter('GET', `/api/sessions/${state.sessionId}/report.txt`);
  assert.equal(r.status, 200);
  assert.match(r.body, /DAILY CHILDCARE REPORT/);
  assert.match(r.body, /1 hr 36 min/);
  assert.match(r.body, /ADA/);
  assert.match(r.body, /BRAM/);
});

test('ending a session closes any still-running entries', async () => {
  await sitter('POST', `/api/sessions/${state.sessionId}/events`, {
    type: 'quiet_time', childId: state.Bram, startAt: iso(17, 30),
  });
  const r = await sitter('POST', `/api/sessions/${state.sessionId}/end`, { endedAt: iso(18) });
  assert.equal(r.status, 200);
  assert.equal(r.body.session.endedAt, iso(18));
  assert.ok(r.body.session.events.every((e) => e.type === 'quiet_time' ? e.endAt === iso(18) : true));

  const again = await sitter('POST', `/api/sessions/${state.sessionId}/end`, {});
  assert.equal(again.status, 409);
});

// --- The tenant boundary -----------------------------------------------------

test('outsider in a different family cannot reach any of it', async () => {
  const reg = await outsider('POST', '/api/auth/register', {
    email: 'outsider@example.com', password: 'outsider password', name: 'Otto', familyName: 'The Others',
  });
  assert.equal(reg.status, 201);

  const probes = [
    ['GET', `/api/families/${state.familyId}/children`],
    ['GET', `/api/families/${state.familyId}/members`],
    ['GET', `/api/families/${state.familyId}/sessions`],
    ['GET', `/api/families/${state.familyId}/invites`],
    ['GET', `/api/sessions/${state.sessionId}`],
    ['GET', `/api/sessions/${state.sessionId}/report`],
    ['GET', `/api/sessions/${state.sessionId}/report.txt`],
    ['GET', `/api/sessions/${state.sessionId}/events`],
  ];
  for (const [method, path] of probes) {
    const r = await outsider(method, path);
    assert.equal(r.status, 404, `${method} ${path} must not leak to a non-member`);
  }

  const writes = [
    ['POST', `/api/families/${state.familyId}/children`, { name: 'Nope' }],
    ['POST', `/api/sessions/${state.sessionId}/events`, { type: 'note', childId: state.Ada, note: 'nope' }],
    ['PATCH', `/api/events/${state.napId}`, { note: 'tampered' }],
    ['DELETE', `/api/events/${state.napId}`, undefined],
    ['DELETE', `/api/sessions/${state.sessionId}`, undefined],
  ];
  for (const [method, path, body] of writes) {
    const r = await outsider(method, path, body);
    assert.equal(r.status, 404, `${method} ${path} must not be writable by a non-member`);
  }
});

test('the nap survived the outsider probes untouched', async () => {
  const r = await sitter('GET', `/api/sessions/${state.sessionId}`);
  assert.equal(r.status, 200);
  const nap = r.body.session.events.find((e) => e.id === state.napId);
  assert.ok(nap, 'nap still exists');
  assert.notEqual(nap.note, 'tampered');
});

test('signed-out requests are rejected', async () => {
  const anon = client();
  const r = await anon('GET', `/api/sessions/${state.sessionId}`);
  assert.equal(r.status, 401);
});

test('logout invalidates the session cookie', async () => {
  const temp = client();
  await temp('POST', '/api/auth/register', {
    email: 'temp@example.com', password: 'temporary password', name: 'Temp', familyName: 'Temp Family',
  });
  assert.equal((await temp('GET', '/api/auth/me')).status, 200);
  await temp('POST', '/api/auth/logout');
  assert.equal((await temp('GET', '/api/auth/me')).status, 401);
});
