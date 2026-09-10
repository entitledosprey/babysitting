import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/babysitting.db';

if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS families (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- A user may belong to several families (a sitter working for multiple
  -- households); role is per-family, not global.
  CREATE TABLE IF NOT EXISTS memberships (
    user_id    TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('parent','sitter')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, family_id)
  );

  CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('parent','sitter')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS children (
    id         TEXT PRIMARY KEY,
    family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    birthdate  TEXT,
    colour     TEXT NOT NULL DEFAULT '#5b8def',
    notes      TEXT NOT NULL DEFAULT '',
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    family_id      TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    sitter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date           TEXT NOT NULL,
    started_at     TEXT NOT NULL,
    ended_at       TEXT,
    notes          TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_children (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    child_id   TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, child_id)
  );

  -- end_at IS NULL on a duration-type event means "in progress"; that single
  -- convention drives the running-nap banner and the live timeline block.
  CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    child_id   TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    start_at   TEXT NOT NULL,
    end_at     TEXT,
    note       TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_session   ON events(session_id, start_at);
  CREATE INDEX IF NOT EXISTS idx_events_child     ON events(child_id, start_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_family  ON sessions(family_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_members_user     ON memberships(user_id);
  CREATE INDEX IF NOT EXISTS idx_auth_expiry      ON auth_sessions(expires_at);
`);

// Records every report email attempt so delivery is visible in the admin
// console and a failed send can be retried rather than silently lost.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_log (
    id         TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    to_email   TEXT NOT NULL,
    subject    TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
    error      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_email_log_time    ON email_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_email_log_session ON email_log(session_id);
`);

// --- Migrations --------------------------------------------------------------
// Columns added after the first release. CREATE TABLE IF NOT EXISTS above only
// covers new installs, so existing databases are patched here.

const columnsOf = (table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

const addColumn = (table, name, ddl) => {
  if (!columnsOf(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
};

addColumn('users', 'disabled', "disabled INTEGER NOT NULL DEFAULT 0");
addColumn('users', 'last_seen_at', "last_seen_at TEXT");
addColumn('sessions', 'report_sent_at', "report_sent_at TEXT");

/** Drops expired login sessions and stale unused invites. Called at boot and hourly. */
export function pruneExpired() {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM invites WHERE used_by IS NULL AND expires_at < ?').run(now);
}
