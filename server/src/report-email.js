import { db } from './db.js';
import { nowIso } from './auth.js';
import { childrenOf, eventsOf } from './access.js';
import { buildReport, renderReportText, renderReportHtml } from './report.js';
import { sendMail, mailConfigured } from './mailer.js';

const APP_URL = process.env.APP_BASE_URL || '';

const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric',
});

/** Every parent in the family, by account email. Sitters are not recipients. */
export function reportRecipients(familyId) {
  return db.prepare(`
    SELECT u.email, u.name
      FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.family_id = ? AND m.role = 'parent' AND u.disabled = 0
     ORDER BY u.email
  `).all(familyId);
}

/**
 * Builds the report for a finished session and emails it to the family's
 * parents. Resolves with a per-recipient summary; never rejects, so callers can
 * fire it without holding up the response.
 */
export async function sendSessionReport(session) {
  const meta = {
    sitterName: db.prepare('SELECT name FROM users WHERE id = ?').get(session.sitter_user_id)?.name ?? '',
    familyName: db.prepare('SELECT name FROM families WHERE id = ?').get(session.family_id)?.name ?? '',
  };
  const report = buildReport(session, childrenOf(session.id), eventsOf(session.id), meta);

  const names = report.children.map((c) => c.child.name).join(' & ');
  const subject = `Daily report — ${names || meta.familyName} — ${fmtDay(session.started_at)}`;
  const text = renderReportText(report);
  const html = renderReportHtml(report, { appUrl: APP_URL });

  const recipients = reportRecipients(session.family_id);
  if (recipients.length === 0) {
    console.warn('[mail] session %s has no parent recipients', session.id);
    return { sent: 0, results: [] };
  }

  const results = [];
  for (const r of recipients) {
    results.push({ email: r.email, ...(await sendMail({ to: r.email, subject, text, html, sessionId: session.id })) });
  }

  const sent = results.filter((r) => r.ok).length;
  if (sent > 0) {
    db.prepare('UPDATE sessions SET report_sent_at = ? WHERE id = ?').run(nowIso(), session.id);
  }
  return { sent, results, configured: mailConfigured() };
}
