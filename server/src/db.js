import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/babysitting.db';

if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// --- Legacy schema guard -----------------------------------------------------
// The first release rooted everything at a family. Several tables kept their
// names but changed columns (children.family_id → client_id, events.session_id →
// shift_id), and `CREATE TABLE IF NOT EXISTS` would leave those stale
// definitions in place — a database that looks fine and fails at the first
// query. Refuse to start instead, and say exactly what to run.

const tableExists = (name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

const columnNames = (table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

const legacy =
  tableExists('families') ||
  tableExists('sessions') ||
  (tableExists('children') && columnNames('children').includes('family_id')) ||
  (tableExists('events') && columnNames('events').includes('session_id'));

if (legacy) {
  throw new Error(
    'This database uses the pre-business schema (families/sessions). ' +
    'Run `node scripts/migrate-to-business.mjs` against it first — it takes a ' +
    'backup, then drops the old domain tables while keeping user logins.',
  );
}

// --- Identity ----------------------------------------------------------------
// A user is just a login. What they can do comes from what they own (a
// business) or what they have been granted (read-only access to a client).
// Platform admins are named by the ADMIN_EMAILS environment variable.

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    disabled      INTEGER NOT NULL DEFAULT 0,
    last_seen_at  TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_auth_expiry ON auth_sessions(expires_at);
`);

// --- The business ------------------------------------------------------------
// The tenant root. One sitter owns one business; staff would be added here as a
// members table without disturbing anything below.

db.exec(`
  CREATE TABLE IF NOT EXISTS businesses (
    id                TEXT PRIMARY KEY,
    owner_user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    default_rate_cents INTEGER NOT NULL DEFAULT 0,
    currency          TEXT NOT NULL DEFAULT 'USD',
    created_at        TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_business_owner ON businesses(owner_user_id);

  CREATE TABLE IF NOT EXISTS clients (
    id           TEXT PRIMARY KEY,
    business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    address      TEXT NOT NULL DEFAULT '',
    rate_cents   INTEGER,
    notes        TEXT NOT NULL DEFAULT '',
    house_rules  TEXT NOT NULL DEFAULT '',
    wifi         TEXT NOT NULL DEFAULT '',
    archived     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_clients_business ON clients(business_id, archived, name);

  -- Parents and other people attached to a client. Contacts are records, not
  -- logins; a contact only becomes a login if invited to the parent portal.
  CREATE TABLE IF NOT EXISTS client_contacts (
    id               TEXT PRIMARY KEY,
    client_id        TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    email            TEXT NOT NULL DEFAULT '',
    phone            TEXT NOT NULL DEFAULT '',
    relationship     TEXT NOT NULL DEFAULT '',
    is_primary       INTEGER NOT NULL DEFAULT 0,
    receives_reports INTEGER NOT NULL DEFAULT 1,
    is_emergency     INTEGER NOT NULL DEFAULT 0,
    can_collect      INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_client ON client_contacts(client_id);

  CREATE TABLE IF NOT EXISTS children (
    id           TEXT PRIMARY KEY,
    client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    birthdate    TEXT,
    colour       TEXT NOT NULL DEFAULT '#4a7fe0',
    allergies    TEXT NOT NULL DEFAULT '',
    medical      TEXT NOT NULL DEFAULT '',
    routines     TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    archived     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_children_client ON children(client_id, archived);
`);

// --- Parent access -----------------------------------------------------------
// Read-only, scoped to a single client. Granted by the business owner and
// revocable at any time.

db.exec(`
  CREATE TABLE IF NOT EXISTS client_parents (
    user_id    TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, client_id)
  );

  CREATE INDEX IF NOT EXISTS idx_client_parents_user ON client_parents(user_id);

  CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    email      TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL
  );
`);

// --- Shifts ------------------------------------------------------------------
// A shift is booked, worked, then closed out. `status` is derived from the
// timestamps rather than stored separately, so the two can never disagree:
//   scheduled   started_at IS NULL
//   in_progress started_at set, ended_at NULL
//   completed   both set
//   cancelled   cancelled_at set

db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    id              TEXT PRIMARY KEY,
    business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    client_id       TEXT NOT NULL REFERENCES clients(id)    ON DELETE CASCADE,
    sitter_user_id  TEXT NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    date            TEXT NOT NULL,
    scheduled_start TEXT,
    scheduled_end   TEXT,
    started_at      TEXT,
    ended_at        TEXT,
    cancelled_at    TEXT,
    rate_cents      INTEGER,
    notes           TEXT NOT NULL DEFAULT '',
    parent_notes    TEXT NOT NULL DEFAULT '',
    report_sent_at  TEXT,
    invoice_id      TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_shifts_business ON shifts(business_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_shifts_client   ON shifts(client_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_shifts_invoice  ON shifts(invoice_id);

  CREATE TABLE IF NOT EXISTS shift_children (
    shift_id TEXT NOT NULL REFERENCES shifts(id)   ON DELETE CASCADE,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    PRIMARY KEY (shift_id, child_id)
  );

  -- end_at IS NULL on a duration-type event means "in progress"; that single
  -- convention drives the running-nap banner and the live timeline block.
  CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY,
    shift_id   TEXT NOT NULL REFERENCES shifts(id)   ON DELETE CASCADE,
    child_id   TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    start_at   TEXT NOT NULL,
    end_at     TEXT,
    note       TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_shift ON events(shift_id, start_at);
  CREATE INDEX IF NOT EXISTS idx_events_child ON events(child_id, start_at);
`);

// --- Invoicing ---------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id            TEXT PRIMARY KEY,
    business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    client_id     TEXT NOT NULL REFERENCES clients(id)    ON DELETE CASCADE,
    number        INTEGER NOT NULL,
    period_start  TEXT NOT NULL,
    period_end    TEXT NOT NULL,
    minutes       INTEGER NOT NULL DEFAULT 0,
    total_cents   INTEGER NOT NULL DEFAULT 0,
    currency      TEXT NOT NULL DEFAULT 'USD',
    status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
    notes         TEXT NOT NULL DEFAULT '',
    sent_at       TEXT,
    paid_at       TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(business_id, number);
`);

// --- Delivery log ------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS email_log (
    id         TEXT PRIMARY KEY,
    shift_id   TEXT REFERENCES shifts(id)   ON DELETE SET NULL,
    invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    to_email   TEXT NOT NULL,
    subject    TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
    error      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_email_log_time  ON email_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_email_log_shift ON email_log(shift_id);
`);

/** Drops expired login sessions and stale unused invites. Called at boot and hourly. */
export function pruneExpired() {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM invites WHERE used_by IS NULL AND expires_at < ?').run(now);
}
