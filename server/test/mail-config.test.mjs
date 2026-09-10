import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const SERVER_DIR = new URL('..', import.meta.url).pathname;

/**
 * mailer.js reads its configuration once at import time, so each case runs in a
 * fresh process with its own environment.
 */
function loadMailer(env) {
  const script = `
    import { mailSettings, explainMailError } from './src/mailer.js';
    console.log(JSON.stringify({
      settings: mailSettings(),
      hints: {
        greeting: explainMailError('Greeting never received'),
        auth: explainMailError('Invalid login: 535 authentication failed'),
        dns: explainMailError('getaddrinfo ENOTFOUND smtp.example.com'),
        refused: explainMailError('connect ECONNREFUSED 1.2.3.4:587'),
        other: explainMailError('some unrelated failure'),
      },
    }));
  `;
  const out = execFileSync(process.execPath, ['--no-warnings=ExperimentalWarning', '--input-type=module', '-e', script], {
    cwd: SERVER_DIR,
    env: { ...process.env, DB_PATH: ':memory:', ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out.trim().split('\n').pop());
}

const base = { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'Sitter Log <a@example.com>' };

test('port 465 is forced to TLS even when SMTP_SECURE says false', () => {
  const { settings } = loadMailer({ ...base, SMTP_PORT: '465', SMTP_SECURE: 'false' });
  assert.equal(settings.secure, true, '465 must connect with TLS or the greeting never arrives');
  assert.equal(settings.warnings.length, 1);
  assert.match(settings.warnings[0], /465/);
});

test('port 465 with SMTP_SECURE=true is correct and silent', () => {
  const { settings } = loadMailer({ ...base, SMTP_PORT: '465', SMTP_SECURE: 'true' });
  assert.equal(settings.secure, true);
  assert.deepEqual(settings.warnings, []);
});

test('port 587 with SMTP_SECURE=false is correct and silent', () => {
  const { settings } = loadMailer({ ...base, SMTP_PORT: '587', SMTP_SECURE: 'false' });
  assert.equal(settings.secure, false, '587 upgrades via STARTTLS');
  assert.deepEqual(settings.warnings, []);
});

test('port 587 with SMTP_SECURE=true is flagged as probably wrong', () => {
  const { settings } = loadMailer({ ...base, SMTP_PORT: '587', SMTP_SECURE: 'true' });
  assert.equal(settings.warnings.length, 1);
  assert.match(settings.warnings[0], /587/);
});

test('a display name without angle brackets is rejected', () => {
  const { settings } = loadMailer({
    ...base, SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_FROM: 'Sitter Log admin@entitledosprey.com',
  });
  assert.equal(settings.warnings.length, 1);
  assert.match(settings.warnings[0], /angle brackets/i);
});

test('valid From formats produce no warning', () => {
  for (const from of ['a@example.com', 'Sitter Log <a@example.com>', '<a@example.com>']) {
    const { settings } = loadMailer({ ...base, SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_FROM: from });
    assert.deepEqual(settings.warnings, [], `${from} should be accepted`);
  }
});

test('opaque SMTP errors are explained', () => {
  const { hints } = loadMailer({ ...base, SMTP_PORT: '587', SMTP_SECURE: 'false' });
  assert.match(hints.greeting, /TLS mismatch/i, 'the failure that actually bit us');
  assert.match(hints.greeting, /465/);
  assert.match(hints.auth, /app-specific password/i);
  assert.match(hints.dns, /could not be resolved/i);
  assert.match(hints.refused, /nothing is listening/i);
  assert.equal(hints.other, 'some unrelated failure', 'unrecognised errors pass through unchanged');
});

test('mail stays unconfigured when the host is missing', () => {
  const { settings } = loadMailer({ SMTP_HOST: '', SMTP_FROM: 'a@example.com' });
  assert.equal(settings.configured, false);
});
