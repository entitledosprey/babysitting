#!/usr/bin/env node
/**
 * Migrates a pre-business database to the sitter-business schema.
 *
 * The old model rooted everything at a family that parents owned; the new one
 * roots everything at a babysitting business that a sitter owns. There is no
 * meaningful automatic mapping between the two — a family is not a business —
 * so the domain data is dropped and the structure rebuilt. Logins are kept, so
 * existing accounts (including platform admins) survive and can set up a
 * business, or continue as admin, on next sign-in.
 *
 * A timestamped backup is written beside the database first.
 *
 *   DB_PATH=/app/data/babysitting.db node scripts/migrate-to-business.mjs [--yes]
 */
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = process.env.DB_PATH || './data/babysitting.db';
const assumeYes = process.argv.includes('--yes');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = OFF');

const tableExists = (name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

const countOf = (name) => {
  if (!tableExists(name)) return 0;
  return db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n;
};

const LEGACY_TABLES = [
  'session_children', 'sessions', 'memberships', 'invites',
  'events', 'children', 'families', 'email_log',
];

const before = Object.fromEntries(
  ['users', 'families', 'children', 'sessions', 'events', 'email_log'].map((t) => [t, countOf(t)]),
);

if (!tableExists('families') && !tableExists('sessions')) {
  console.log('Nothing to do — this database is already on the business schema.');
  process.exit(0);
}

console.log(`Database: ${DB_PATH}`);
console.log('About to drop the old family-rooted domain data:');
for (const [t, n] of Object.entries(before)) {
  if (t === 'users') continue;
  console.log(`  ${t.padEnd(12)} ${n} row${n === 1 ? '' : 's'}  → dropped`);
}
console.log(`  ${'users'.padEnd(12)} ${before.users} row${before.users === 1 ? '' : 's'}  → kept`);

if (!assumeYes) {
  console.log('\nRe-run with --yes to proceed.');
  process.exit(1);
}

const backup = `${DB_PATH}.pre-business-${new Date().toISOString().replace(/[:.]/g, '-')}`;
db.prepare('VACUUM INTO ?').run(backup);
console.log(`\nBackup written: ${backup}`);

for (const t of LEGACY_TABLES) {
  if (tableExists(t)) {
    db.exec(`DROP TABLE ${t}`);
    console.log(`  dropped ${t}`);
  }
}

db.exec('PRAGMA foreign_keys = ON');
console.log(`\nDone. ${countOf('users')} login(s) kept; the app will create the new tables on next start.`);
