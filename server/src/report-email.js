import { db } from './db.js';
import { nowIso } from './auth.js';
import { childrenOfShift, eventsOf } from './access.js';
import { buildReport, renderReportText, renderReportHtml } from './report.js';
import { sendMail, mailConfigured } from './mailer.js';

const APP_URL = process.env.APP_BASE_URL || '';

const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric',
});

/**
 * Who gets the report: the client's contacts flagged to receive them. Contacts
 * are records the sitter maintains, so this works whether or not the parents
 * ever create a portal login.
 */
export function reportRecipients(clientId) {
  return db.prepare(`
    SELECT name, email FROM client_contacts
     WHERE client_id = ? AND receives_reports = 1 AND email <> ''
     ORDER BY is_primary DESC, name
  `).all(clientId);
}

/**
 * Builds the report for a finished shift and emails it to the client's
 * contacts. Resolves with a per-recipient summary; never rejects, so callers
 * can fire it without holding up the response.
 */
export async function sendShiftReport(shift) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(shift.client_id);
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(shift.business_id);

  const report = buildReport(shift, childrenOfShift(shift.id), eventsOf(shift.id), {
    sitterName: db.prepare('SELECT name FROM users WHERE id = ?').get(shift.sitter_user_id)?.name ?? '',
    clientName: client?.name ?? '',
    businessName: business?.name ?? '',
  });

  const names = report.children.map((c) => c.child.name).join(' & ');
  const subject = `Daily report — ${names || client?.name || 'your children'} — ${fmtDay(shift.started_at)}`;
  const text = renderReportText(report);
  const html = renderReportHtml(report, { appUrl: APP_URL });

  const recipients = reportRecipients(shift.client_id);
  if (recipients.length === 0) {
    console.warn('[mail] client %s has no contacts set to receive reports', shift.client_id);
    return { sent: 0, results: [], configured: mailConfigured(), noRecipients: true };
  }

  const results = [];
  for (const r of recipients) {
    results.push({
      email: r.email,
      ...(await sendMail({ to: r.email, subject, text, html, shiftId: shift.id })),
    });
  }

  const sent = results.filter((r) => r.ok).length;
  if (sent > 0) {
    db.prepare('UPDATE shifts SET report_sent_at = ? WHERE id = ?').run(nowIso(), shift.id);
  }
  return { sent, results, configured: mailConfigured() };
}
