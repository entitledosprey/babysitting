import { Router } from 'express';
import { db } from '../db.js';
import { newId, nowIso } from '../auth.js';
import { wrap, str, bad, isoDate, HttpError } from '../http.js';
import {
  businessOf, loadClient, loadInvoice, assertOwner, effectiveRate,
  mapInvoice, shiftMinutes, childrenOfShift,
} from '../access.js';
import { sendMail } from '../mailer.js';
import { reportRecipients } from '../report-email.js';
import { formatDuration } from '../report.js';

export const router = Router();

const APP_URL = process.env.APP_BASE_URL || '';

const fmtMoney = (cents, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents ?? 0) / 100);

/** A billable shift is completed, not cancelled, and not already on an invoice. */
const billableShifts = (clientId, periodStart, periodEnd) => db.prepare(`
  SELECT * FROM shifts
   WHERE client_id = ? AND ended_at IS NOT NULL AND cancelled_at IS NULL
     AND invoice_id IS NULL AND date >= ? AND date <= ?
   ORDER BY date, started_at
`).all(clientId, periodStart, periodEnd);

/**
 * Line items are rounded per shift and then summed, so the invoice adds up
 * exactly as printed rather than differing from the sum of its lines by a cent.
 */
const lineItemsFor = (shifts, client, business) => shifts.map((s) => {
  const minutes = shiftMinutes(s) ?? 0;
  const rate = effectiveRate(s, client, business);
  return {
    shiftId: s.id,
    date: s.date,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    minutes,
    duration: formatDuration(minutes),
    rateCents: rate,
    amountCents: Math.round((minutes / 60) * rate),
    children: childrenOfShift(s.id).map((c) => c.name),
  };
});

const totalsOf = (items) => ({
  minutes: items.reduce((n, i) => n + i.minutes, 0),
  totalCents: items.reduce((n, i) => n + i.amountCents, 0),
});

router.get('/', wrap(async (req, res) => {
  const business = businessOf(req.user.id);
  if (!business) bad('Set up your babysitting business first');

  const clientId = req.query.clientId ? String(req.query.clientId) : null;
  const rows = clientId
    ? db.prepare('SELECT * FROM invoices WHERE business_id = ? AND client_id = ? ORDER BY number DESC')
        .all(business.id, clientId)
    : db.prepare('SELECT * FROM invoices WHERE business_id = ? ORDER BY number DESC LIMIT 200')
        .all(business.id);

  res.json({
    invoices: rows.map((i) => ({
      ...mapInvoice(i),
      clientName: db.prepare('SELECT name FROM clients WHERE id = ?').get(i.client_id)?.name ?? '',
      shiftCount: db.prepare('SELECT COUNT(*) n FROM shifts WHERE invoice_id = ?').get(i.id).n,
    })),
  });
}));

/** Preview what would be billed, without creating anything. */
router.get('/preview', wrap(async (req, res) => {
  const business = businessOf(req.user.id);
  if (!business) bad('Set up your babysitting business first');

  const { client, access } = loadClient(str(req.query.clientId, 'Client', { max: 64 }), req.user);
  assertOwner(access);

  const periodStart = isoDate(req.query.periodStart ?? '1970-01-01', 'periodStart');
  const periodEnd = isoDate(req.query.periodEnd ?? '2999-12-31', 'periodEnd');
  const items = lineItemsFor(billableShifts(client.id, periodStart, periodEnd), client, business);

  res.json({
    preview: {
      clientId: client.id,
      clientName: client.name,
      periodStart,
      periodEnd,
      currency: business.currency,
      items,
      ...totalsOf(items),
    },
  });
}));

router.post('/', wrap(async (req, res) => {
  const business = businessOf(req.user.id);
  if (!business) bad('Set up your babysitting business first');

  const { client, access } = loadClient(str(req.body.clientId, 'Client', { max: 64 }), req.user);
  assertOwner(access);

  const periodStart = isoDate(req.body.periodStart ?? '1970-01-01', 'periodStart');
  const periodEnd = isoDate(req.body.periodEnd ?? '2999-12-31', 'periodEnd');
  if (periodEnd < periodStart) bad('The period ends before it starts');

  const shifts = billableShifts(client.id, periodStart, periodEnd);
  if (shifts.length === 0) bad('There are no uninvoiced completed shifts in that period');

  const items = lineItemsFor(shifts, client, business);
  const { minutes, totalCents } = totalsOf(items);

  const nextNumber =
    (db.prepare('SELECT MAX(number) AS n FROM invoices WHERE business_id = ?').get(business.id).n ?? 0) + 1;
  const id = newId();

  db.prepare('BEGIN').run();
  try {
    db.prepare(`
      INSERT INTO invoices (id, business_id, client_id, number, period_start, period_end,
                            minutes, total_cents, currency, notes, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, business.id, client.id, nextNumber, periodStart, periodEnd,
           minutes, totalCents, business.currency,
           str(req.body.notes ?? '', 'Notes', { max: 2000, required: false }), nowIso());

    const link = db.prepare('UPDATE shifts SET invoice_id = ? WHERE id = ? AND invoice_id IS NULL');
    for (const s of shifts) link.run(id, s.id);
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }

  res.status(201).json({ invoice: { ...mapInvoice(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)), items } });
}));

const invoiceDetail = (invoice, client, business) => {
  const shifts = db.prepare('SELECT * FROM shifts WHERE invoice_id = ? ORDER BY date, started_at').all(invoice.id);
  return {
    ...mapInvoice(invoice),
    clientName: client.name,
    businessName: business?.name ?? '',
    items: lineItemsFor(shifts, client, business),
  };
};

router.get('/:invoiceId', wrap(async (req, res) => {
  const { invoice, client, business, access } = loadInvoice(req.params.invoiceId, req.user);
  assertOwner(access);
  res.json({ invoice: invoiceDetail(invoice, client, business) });
}));

router.patch('/:invoiceId', wrap(async (req, res) => {
  const { invoice, client, business, access } = loadInvoice(req.params.invoiceId, req.user);
  assertOwner(access);

  let status = invoice.status;
  if (req.body.status !== undefined) {
    status = str(req.body.status, 'Status', { max: 10 });
    if (!['draft', 'sent', 'paid', 'void'].includes(status)) bad('Unknown invoice status');
  }

  db.prepare(`
    UPDATE invoices SET status=?, notes=?, paid_at=? WHERE id=?
  `).run(
    status,
    req.body.notes !== undefined ? str(req.body.notes, 'Notes', { max: 2000, required: false }) : invoice.notes,
    status === 'paid' ? (invoice.paid_at ?? nowIso()) : null,
    invoice.id,
  );

  // Voiding releases the shifts so they can be billed again on a corrected invoice.
  if (status === 'void') {
    db.prepare('UPDATE shifts SET invoice_id = NULL WHERE invoice_id = ?').run(invoice.id);
  }

  res.json({ invoice: invoiceDetail(db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id), client, business) });
}));

router.post('/:invoiceId/send', wrap(async (req, res) => {
  const { invoice, client, business, access } = loadInvoice(req.params.invoiceId, req.user);
  assertOwner(access);
  if (invoice.status === 'void') throw new HttpError(409, 'That invoice has been voided');

  const detail = invoiceDetail(invoice, client, business);
  const recipients = reportRecipients(client.id);
  if (recipients.length === 0) bad('This client has no contacts set to receive email');

  const subject = `Invoice #${invoice.number} — ${business.name} — ${fmtMoney(invoice.total_cents, invoice.currency)}`;
  const lines = detail.items.map((i) =>
    `  ${i.date}   ${i.duration.padEnd(12)} ${fmtMoney(i.rateCents, invoice.currency)}/hr   ${fmtMoney(i.amountCents, invoice.currency)}`
  ).join('\n');

  const text = [
    `INVOICE #${invoice.number}`,
    business.name,
    '',
    `Billed to: ${client.name}`,
    `Period: ${invoice.period_start} to ${invoice.period_end}`,
    '',
    lines,
    '',
    `Total hours: ${formatDuration(invoice.minutes)}`,
    `Amount due:  ${fmtMoney(invoice.total_cents, invoice.currency)}`,
    invoice.notes ? `\n${invoice.notes}` : '',
  ].join('\n');

  const html = renderInvoiceHtml(detail, fmtMoney);

  const results = [];
  for (const r of recipients) {
    results.push({ email: r.email, ...(await sendMail({ to: r.email, subject, text, html, invoiceId: invoice.id })) });
  }
  const sent = results.filter((r) => r.ok).length;
  if (sent > 0) {
    db.prepare("UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = ? WHERE id = ?")
      .run(nowIso(), invoice.id);
  }

  res.json({ result: { sent, results } });
}));

router.delete('/:invoiceId', wrap(async (req, res) => {
  const { invoice, access } = loadInvoice(req.params.invoiceId, req.user);
  assertOwner(access);
  if (invoice.status === 'paid') bad('A paid invoice cannot be deleted. Void it instead.');

  db.prepare('BEGIN').run();
  try {
    db.prepare('UPDATE shifts SET invoice_id = NULL WHERE invoice_id = ?').run(invoice.id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice.id);
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
  res.json({ ok: true });
}));

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function renderInvoiceHtml(detail, money) {
  const rows = detail.items.map((i) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #e0e4ea;font-size:14px">${esc(i.date)}
        <div style="color:#8b95a3;font-size:12px">${esc(i.children.join(', '))}</div>
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #e0e4ea;font-size:14px;text-align:right">${esc(i.duration)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #e0e4ea;font-size:14px;text-align:right">${esc(money(i.rateCents, detail.currency))}/hr</td>
      <td style="padding:8px 0;border-bottom:1px solid #e0e4ea;font-size:14px;text-align:right;font-weight:600">${esc(money(i.amountCents, detail.currency))}</td>
    </tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title></head>
<body style="margin:0;padding:20px 12px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#12161c">
  <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e0e4ea;border-radius:12px;padding:22px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#4a7fe0">Invoice #${esc(detail.number)}</div>
    <h1 style="margin:6px 0 2px;font-size:22px">${esc(detail.businessName)}</h1>
    <div style="color:#5c6673;font-size:14px">Billed to ${esc(detail.clientName)}</div>
    <div style="color:#8b95a3;font-size:13px;margin-top:2px">${esc(detail.periodStart)} to ${esc(detail.periodEnd)}</div>

    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:18px">
      <tr>
        <th style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8b95a3;padding-bottom:6px">Shift</th>
        <th style="text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8b95a3;padding-bottom:6px">Hours</th>
        <th style="text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8b95a3;padding-bottom:6px">Rate</th>
        <th style="text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8b95a3;padding-bottom:6px">Amount</th>
      </tr>
      ${rows}
      <tr>
        <td colspan="3" style="padding:14px 0 0;text-align:right;font-size:15px;font-weight:600">Amount due</td>
        <td style="padding:14px 0 0;text-align:right;font-size:19px;font-weight:700">${esc(money(detail.totalCents, detail.currency))}</td>
      </tr>
    </table>

    ${detail.notes ? `<p style="margin-top:16px;padding:10px;background:#f6f7f9;border-radius:8px;font-size:14px">${esc(detail.notes)}</p>` : ''}
    ${APP_URL ? `<p style="text-align:center;margin-top:18px"><a href="${esc(APP_URL)}" style="color:#4a7fe0;font-size:13px;text-decoration:none">View shift reports →</a></p>` : ''}
  </div>
</body></html>`;
}
