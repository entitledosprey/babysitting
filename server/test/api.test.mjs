import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
let child, dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bs-test-'));
  child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'src/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), DB_PATH: join(dir, 'test.db'), SECURE_COOKIES: 'false', SMTP_HOST: '' },
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

const iso = (h, m = 0, day = 9) => {
  const d = new Date(2026, 8, day, h, m, 0);
  const off = -d.getTimezoneOffset();
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `2026-09-${pad(day)}T${pad(h)}:${pad(m)}:00${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
};

const sitter = client();
const rival = client();
const parent = client();
const S = {};

// --- Onboarding --------------------------------------------------------------

test('a sitter registers and gets a business', async () => {
  const r = await sitter('POST', '/api/auth/register', {
    email: 'sam@sitters.test', password: 'sitter-password-1',
    name: 'Sam Rivera', businessName: 'Rivera Childcare',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.business.name, 'Rivera Childcare');
  assert.deepEqual(r.body.user.parentOf, []);
  S.businessId = r.body.user.business.id;
});

test('registering with neither a business nor an invite is refused', async () => {
  const r = await client()('POST', '/api/auth/register', {
    email: 'nobody@test.invalid', password: 'a-good-password', name: 'Nobody',
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /business|invite/i);
});

test('a sitter cannot open a second business', async () => {
  const r = await sitter('POST', '/api/business', { name: 'Second Business' });
  assert.equal(r.status, 400);
});

test('business settings carry a default rate in cents', async () => {
  const r = await sitter('PATCH', '/api/business', { defaultRate: 22.5, currency: 'usd' });
  assert.equal(r.status, 200);
  assert.equal(r.body.business.defaultRateCents, 2250, 'money is stored in cents');
  assert.equal(r.body.business.currency, 'USD');
});

// --- Clients -----------------------------------------------------------------

test('the sitter sets up a client with children and contacts', async () => {
  const c = await sitter('POST', '/api/clients', {
    name: 'The Okonkwos', address: '12 Elm Row', rate: 25,
    houseRules: 'Shoes off, no screens before 4pm',
  });
  assert.equal(c.status, 201);
  assert.equal(c.body.client.rateCents, 2500);
  S.clientId = c.body.client.id;

  for (const [name, allergies] of [['Ada', 'peanuts'], ['Bram', '']]) {
    const r = await sitter('POST', `/api/clients/${S.clientId}/children`, {
      name, allergies, routines: 'Nap after lunch',
    });
    assert.equal(r.status, 201);
    S[name] = r.body.child.id;
  }
  assert.equal((await sitter('GET', `/api/clients/${S.clientId}`)).body.client.children[0].allergies, 'peanuts');

  const contact = await sitter('POST', `/api/clients/${S.clientId}/contacts`, {
    name: 'Ngozi Okonkwo', email: 'ngozi@example.test', relationship: 'Mother',
    isPrimary: true, receivesReports: true, isEmergency: true, canCollect: true,
  });
  assert.equal(contact.status, 201);
  S.contactId = contact.body.contact.id;
});

test('a report recipient must have an email address', async () => {
  const r = await sitter('POST', `/api/clients/${S.clientId}/contacts`, {
    name: 'No Email', receivesReports: true,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /email/i);
});

// --- Scheduling and the shift lifecycle --------------------------------------

test('a shift can be booked ahead, then started on arrival', async () => {
  const booked = await sitter('POST', '/api/shifts', {
    clientId: S.clientId, scheduledStart: iso(9), scheduledEnd: iso(17),
    parentNotes: 'Back by six. Bram has a slight cough.',
  });
  assert.equal(booked.status, 201);
  assert.equal(booked.body.shift.status, 'scheduled');
  assert.equal(booked.body.shift.children.length, 2, 'defaults to the whole roster');
  S.shiftId = booked.body.shift.id;

  const upcoming = await sitter('GET', '/api/shifts?scope=upcoming');
  assert.equal(upcoming.body.shifts.length, 1);

  const started = await sitter('POST', `/api/shifts/${S.shiftId}/start`, { startedAt: iso(8, 55) });
  assert.equal(started.status, 200);
  assert.equal(started.body.shift.status, 'in_progress');
});

test('entries cannot be logged against a shift that has not started', async () => {
  const later = await sitter('POST', '/api/shifts', { clientId: S.clientId, scheduledStart: iso(9, 0, 12) });
  const r = await sitter('POST', `/api/shifts/${later.body.shift.id}/events`, {
    type: 'note', childId: S.Ada, note: 'too early',
  });
  assert.equal(r.status, 409);
  S.futureShiftId = later.body.shift.id;
});

test('a started shift cannot be cancelled', async () => {
  assert.equal((await sitter('POST', `/api/shifts/${S.shiftId}/cancel`)).status, 409);
  assert.equal((await sitter('POST', `/api/shifts/${S.futureShiftId}/cancel`)).status, 200);
});

test('nap start/stop produces an exact duration', async () => {
  const start = await sitter('POST', `/api/shifts/${S.shiftId}/events`, {
    type: 'nap', childId: S.Ada, startAt: iso(13, 12),
  });
  assert.equal(start.status, 201);
  assert.equal(start.body.event.endAt, null);
  S.napId = start.body.event.id;

  assert.equal((await sitter('POST', `/api/shifts/${S.shiftId}/events`, {
    type: 'nap', childId: S.Ada, startAt: iso(13, 20),
  })).status, 409, 'a second running nap for the same child is refused');

  const stop = await sitter('POST', `/api/events/${S.napId}/stop`, { endAt: iso(14, 48) });
  assert.equal(stop.status, 200);
  assert.equal(stop.body.event.endAt, iso(14, 48));
});

test('a spread of entries across both children', async () => {
  const entries = [
    { type: 'bottle', childId: S.Ada, startAt: iso(15, 0), detail: { amountOz: 6, contents: 'formula' } },
    { type: 'diaper', childId: S.Ada, startAt: iso(15, 5), detail: { wet: true } },
    { type: 'snack', childId: S.Bram, startAt: iso(15, 30), detail: { food: 'apple slices' } },
    { type: 'potty', childId: S.Bram, startAt: iso(16, 0), detail: { pee: true } },
    { type: 'milestone', childId: S.Ada, startAt: iso(16, 30), note: 'said "banana"', detail: { kind: 'New word' } },
    { type: 'activity', childId: S.Bram, startAt: iso(10), endAt: iso(11), detail: { kind: 'Outside play' } },
  ];
  for (const e of entries) {
    assert.equal((await sitter('POST', `/api/shifts/${S.shiftId}/events`, e)).status, 201, e.type);
  }
});

test('a point-in-time type refuses a duration, and unknown types are rejected', async () => {
  assert.equal((await sitter('POST', `/api/shifts/${S.shiftId}/events`, {
    type: 'diaper', childId: S.Ada, startAt: iso(15), endAt: iso(16),
  })).status, 400);
  assert.equal((await sitter('POST', `/api/shifts/${S.shiftId}/events`, {
    type: 'skydiving', childId: S.Ada, startAt: iso(15),
  })).status, 400);
});

test('closing the shift stops anything running and totals correctly', async () => {
  await sitter('POST', `/api/shifts/${S.shiftId}/events`, { type: 'quiet_time', childId: S.Bram, startAt: iso(17, 30) });

  const ended = await sitter('POST', `/api/shifts/${S.shiftId}/end`, { endedAt: iso(18), notes: 'Good day.' });
  assert.equal(ended.status, 200);
  assert.equal(ended.body.shift.status, 'completed');
  assert.equal(ended.body.shift.minutes, 545, '8:55 to 18:00 is 545 minutes');
  assert.ok(ended.body.shift.events.every((e) => e.type !== 'quiet_time' || e.endAt === iso(18)));

  assert.equal((await sitter('POST', `/api/shifts/${S.shiftId}/end`, {})).status, 409);
});

test('the report groups per child with correct totals', async () => {
  const r = await sitter('GET', `/api/shifts/${S.shiftId}/report`);
  assert.equal(r.status, 200);
  assert.equal(r.body.report.shift.clientName, 'The Okonkwos');
  assert.equal(r.body.report.shift.businessName, 'Rivera Childcare');

  const ada = r.body.report.children.find((c) => c.child.name === 'Ada');
  assert.equal(ada.sleep.napCount, 1);
  assert.equal(ada.sleep.totalMinutes, 96, '1:12 PM to 2:48 PM is 96 minutes');
  assert.equal(ada.food.totalOz, 6);
  assert.equal(ada.diapering.wet, 1);
  assert.equal(ada.observations.milestones.length, 1);

  const bram = r.body.report.children.find((c) => c.child.name === 'Bram');
  assert.equal(bram.diapering.pottyCount, 1);
  assert.equal(bram.activities.totalMinutes, 60);

  const txt = await sitter('GET', `/api/shifts/${S.shiftId}/report.txt`);
  assert.match(txt.body, /DAILY CHILDCARE REPORT/);
  assert.match(txt.body, /1 hr 36 min/);
});

// --- Earnings and invoicing --------------------------------------------------

test('earnings use the client rate over the business default', async () => {
  const r = await sitter('GET', `/api/shifts/${S.shiftId}/earnings`);
  assert.equal(r.status, 200);
  assert.equal(r.body.earnings.rateCents, 2500, 'the client rate wins over the business default');
  assert.equal(r.body.earnings.minutes, 545);
  assert.equal(r.body.earnings.totalCents, Math.round((545 / 60) * 2500));
});

test('an invoice bills the completed shift and locks it', async () => {
  const preview = await sitter('GET', `/api/invoices/preview?clientId=${S.clientId}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview.items.length, 1, 'only completed, uninvoiced shifts');
  assert.equal(preview.body.preview.minutes, 545);

  const inv = await sitter('POST', '/api/invoices', { clientId: S.clientId });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.invoice.number, 1);
  assert.equal(inv.body.invoice.totalCents, Math.round((545 / 60) * 2500));
  S.invoiceId = inv.body.invoice.id;

  assert.equal((await sitter('GET', `/api/invoices/preview?clientId=${S.clientId}`)).body.preview.items.length, 0,
    'an invoiced shift is no longer billable');
  assert.equal((await sitter('POST', '/api/invoices', { clientId: S.clientId })).status, 400);
});

test('an invoiced shift cannot be deleted, and voiding releases it', async () => {
  assert.equal((await sitter('DELETE', `/api/shifts/${S.shiftId}`)).status, 400);

  assert.equal((await sitter('PATCH', `/api/invoices/${S.invoiceId}`, { status: 'void' })).status, 200);
  assert.equal((await sitter('GET', `/api/invoices/preview?clientId=${S.clientId}`)).body.preview.items.length, 1,
    'voiding puts the shift back in the billable pool');
});

// --- The parent portal -------------------------------------------------------

test('a parent joins by invite and gets read-only access', async () => {
  const inv = await sitter('POST', `/api/clients/${S.clientId}/invites`, { email: 'ngozi@example.test' });
  assert.equal(inv.status, 201);

  const r = await parent('POST', '/api/auth/register', {
    email: 'ngozi@example.test', password: 'parent-password-1',
    name: 'Ngozi Okonkwo', inviteCode: inv.body.invite.code,
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.business, null, 'a parent has no business');
  assert.equal(r.body.user.parentOf.length, 1);
  assert.equal(r.body.user.parentOf[0].name, 'The Okonkwos');
});

test('the parent can read their family, its shifts and reports', async () => {
  const list = await parent('GET', '/api/clients');
  assert.equal(list.body.clients.length, 1);
  assert.equal(list.body.clients[0].access, 'parent');

  const detail = await parent('GET', `/api/clients/${S.clientId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.client.children.length, 2);

  assert.equal((await parent('GET', `/api/shifts/${S.shiftId}`)).status, 200);
  assert.equal((await parent('GET', `/api/shifts/${S.shiftId}/report`)).status, 200);
  assert.equal((await parent('GET', `/api/shifts/${S.shiftId}/events`)).status, 200);
});

test('the parent can write nothing at all', async () => {
  const writes = [
    ['PATCH',  `/api/clients/${S.clientId}`, { name: 'Renamed' }],
    ['POST',   `/api/clients/${S.clientId}/children`, { name: 'Ghost' }],
    ['DELETE', `/api/clients/${S.clientId}/children/${S.Ada}`, undefined],
    ['POST',   `/api/clients/${S.clientId}/contacts`, { name: 'X' }],
    ['POST',   `/api/clients/${S.clientId}/invites`, {}],
    ['POST',   `/api/shifts/${S.shiftId}/events`, { type: 'note', childId: S.Ada, note: 'x' }],
    ['PATCH',  `/api/events/${S.napId}`, { note: 'tampered' }],
    ['DELETE', `/api/events/${S.napId}`, undefined],
    ['PATCH',  `/api/shifts/${S.shiftId}`, { notes: 'x' }],
    ['DELETE', `/api/shifts/${S.shiftId}`, undefined],
  ];
  for (const [method, path, body] of writes) {
    const r = await parent(method, path, body);
    assert.equal(r.status, 403, `${method} ${path} must be refused for a parent`);
  }

  // Business-scoped surfaces are not merely read-only — they do not exist.
  assert.equal((await parent('POST', '/api/shifts', { clientId: S.clientId, startNow: true })).status, 400);
  assert.equal((await parent('GET', '/api/invoices')).status, 400);
  assert.equal((await parent('GET', `/api/shifts/${S.shiftId}/earnings`)).status, 403);
});

test('the nap survived the parent write attempts', async () => {
  const r = await sitter('GET', `/api/shifts/${S.shiftId}`);
  const nap = r.body.shift.events.find((e) => e.id === S.napId);
  assert.ok(nap);
  assert.notEqual(nap.note, 'tampered');
});

// --- The tenant boundary -----------------------------------------------------

test('a rival sitter cannot see or touch any of it', async () => {
  const reg = await rival('POST', '/api/auth/register', {
    email: 'rival@sitters.test', password: 'rival-password-1',
    name: 'Rival', businessName: 'Rival Childcare',
  });
  assert.equal(reg.status, 201);

  const reads = [
    `/api/clients/${S.clientId}`,
    `/api/shifts/${S.shiftId}`,
    `/api/shifts/${S.shiftId}/report`,
    `/api/shifts/${S.shiftId}/report.txt`,
    `/api/shifts/${S.shiftId}/events`,
    `/api/shifts/${S.shiftId}/earnings`,
    `/api/clients/${S.clientId}/invites`,
    `/api/invoices/${S.invoiceId}`,
  ];
  for (const path of reads) {
    assert.equal((await rival('GET', path)).status, 404, `${path} must not leak to another sitter`);
  }

  const writes = [
    ['PATCH',  `/api/clients/${S.clientId}`, { name: 'Stolen' }],
    ['POST',   `/api/clients/${S.clientId}/children`, { name: 'Ghost' }],
    ['POST',   `/api/shifts/${S.shiftId}/events`, { type: 'note', childId: S.Ada, note: 'x' }],
    ['PATCH',  `/api/events/${S.napId}`, { note: 'stolen' }],
    ['DELETE', `/api/events/${S.napId}`, undefined],
    ['POST',   `/api/shifts/${S.shiftId}/end`, {}],
    ['DELETE', `/api/shifts/${S.shiftId}`, undefined],
    ['POST',   `/api/shifts`, { clientId: S.clientId, startNow: true }],
    ['POST',   `/api/invoices`, { clientId: S.clientId }],
  ];
  for (const [method, path, body] of writes) {
    assert.equal((await rival(method, path, body)).status, 404, `${method} ${path} must not be writable`);
  }

  assert.equal((await rival('GET', '/api/clients')).body.clients.length, 0);
  assert.equal((await rival('GET', '/api/shifts')).body.shifts.length, 0);
});

test('the rival could not alter anything', async () => {
  const r = await sitter('GET', `/api/clients/${S.clientId}`);
  assert.equal(r.body.client.name, 'The Okonkwos');
  assert.equal(r.body.client.children.length, 2);
});

test('signed-out requests are rejected', async () => {
  assert.equal((await client()('GET', `/api/shifts/${S.shiftId}`)).status, 401);
  assert.equal((await client()('GET', '/api/clients')).status, 401);
});

test('revoking parent access takes effect immediately', async () => {
  const parentUser = (await sitter('GET', `/api/clients/${S.clientId}`)).body.client.parents[0];
  assert.equal((await sitter('DELETE', `/api/clients/${S.clientId}/parents/${parentUser.id}`)).status, 200);
  assert.equal((await parent('GET', `/api/clients/${S.clientId}`)).status, 404);
  assert.equal((await parent('GET', `/api/shifts/${S.shiftId}`)).status, 404);
});
