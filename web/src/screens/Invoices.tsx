import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Client, Invoice, InvoicePreview } from '../lib/api';
import { navigate, back } from '../lib/router';
import { TabBar } from '../components/TabBar';
import { Sheet, Spinner, ErrorNote, Field, useToast } from '../components/ui';
import { fmtMoney } from '../lib/money';
import { fmtDuration } from '../lib/time';

const statusPill = (s: Invoice['status']) => (
  <span className={`pill ${s === 'paid' ? 'paid' : s === 'void' ? 'void' : s === 'sent' ? 'scheduled' : 'draft'}`}>
    {s}
  </span>
);

export function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      const [i, c] = await Promise.all([api.invoices(), api.clients()]);
      setInvoices(i);
      setClients(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
      setInvoices([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const outstanding = (invoices ?? [])
    .filter((i) => i.status === 'draft' || i.status === 'sent')
    .reduce((n, i) => n + i.totalCents, 0);

  return (
    <div className="app">
      <div className="appbar">
        <div className="grow">
          <div className="title">Invoices</div>
          <div className="subtitle">
            {invoices ? `${fmtMoney(outstanding)} outstanding` : ' '}
          </div>
        </div>
        <button className="btn sm primary" disabled={clients.length === 0}
          onClick={() => setCreating(true)}>New</button>
      </div>

      <div className="content pad pad-bottom">
        <div className="stack">
          <ErrorNote error={error} />
          {invoices === null ? <Spinner /> : invoices.length === 0 ? (
            <div className="empty">
              <span className="big">💵</span>
              No invoices yet.<br />Bill a client once you've worked a shift for them.
            </div>
          ) : invoices.map((i) => (
            <button key={i.id} className="card tap stack tight" onClick={() => navigate(`/invoice/${i.id}`)}>
              <div className="row">
                <strong style={{ flex: 1 }}>#{i.number} · {i.clientName}</strong>
                {statusPill(i.status)}
              </div>
              <div className="row">
                <span className="faint">
                  {i.periodStart} to {i.periodEnd} · {i.shiftCount} shift{i.shiftCount === 1 ? '' : 's'}
                </span>
                <span className="spacer" />
                <span className="amount">{fmtMoney(i.totalCents, i.currency)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {creating && (
        <NewInvoice clients={clients} onClose={() => setCreating(false)}
          onDone={(inv) => { setCreating(false); showToast('Invoice created'); navigate(`/invoice/${inv.id}`); }} />
      )}

      {toast}
      <TabBar current="/invoices" />
    </div>
  );
}

function NewInvoice({ clients, onClose, onDone }: {
  clients: Client[]; onClose: () => void; onDone: (i: Invoice) => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    setPreview(null);
    api.invoicePreview(clientId).then(setPreview).catch((e) => setError(e.message));
  }, [clientId]);

  return (
    <Sheet title="New invoice" onClose={onClose}>
      <div className="stack">
        <Field label="Client">
          <div className="chips">
            {clients.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={clientId === c.id}
                onClick={() => setClientId(c.id)}>{c.name}</button>
            ))}
          </div>
        </Field>

        {preview === null ? <Spinner /> : preview.items.length === 0 ? (
          <div className="muted">
            No uninvoiced completed shifts for this client. Finish a shift first — a shift is
            billable once it has been closed out.
          </div>
        ) : (
          <>
            <div className="section-title">Billable shifts</div>
            <div className="card stack tight">
              {preview.items.map((i) => (
                <div key={i.shiftId} className="row">
                  <span>{i.date}</span>
                  <span className="spacer" />
                  <span className="faint">{i.duration}</span>
                  <span className="amount">{fmtMoney(i.amountCents, preview.currency)}</span>
                </div>
              ))}
              <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <strong style={{ flex: 1 }}>Total</strong>
                <span className="faint">{fmtDuration(preview.minutes)}</span>
                <span className="amount big">{fmtMoney(preview.totalCents, preview.currency)}</span>
              </div>
            </div>
          </>
        )}

        <ErrorNote error={error} />
        <button className="btn primary lg block"
          disabled={busy || !preview || preview.items.length === 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try { onDone(await api.createInvoice({ clientId })); }
            catch (e) {
              setError(e instanceof Error ? e.message : 'Could not create the invoice');
              setBusy(false);
            }
          }}>{busy ? 'Creating…' : 'Create invoice'}</button>
      </div>
    </Sheet>
  );
}

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(() => {
    api.invoice(invoiceId).then(setInvoice).catch((e) => setError(e.message));
  }, [invoiceId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="pad"><ErrorNote error={error} /></div>;
  if (!invoice) return <Spinner />;

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); showToast(label); load(); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Failed'); }
    setBusy(false);
  };

  return (
    <div className="app">
      <div className="appbar">
        <button className="btn ghost" onClick={() => back()} aria-label="Back">‹</button>
        <div className="grow">
          <div className="title">Invoice #{invoice.number}</div>
          <div className="subtitle">{invoice.clientName}</div>
        </div>
        {statusPill(invoice.status)}
      </div>

      <div className="content pad pad-bottom">
        <div className="stack">
          <div className="card stack tight">
            <div className="row">
              <span className="muted">Period</span><span className="spacer" />
              <strong>{invoice.periodStart} to {invoice.periodEnd}</strong>
            </div>
            <div className="row">
              <span className="muted">Hours</span><span className="spacer" />
              <strong>{fmtDuration(invoice.minutes)}</strong>
            </div>
            <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <strong style={{ flex: 1 }}>Amount due</strong>
              <span className="amount big">{fmtMoney(invoice.totalCents, invoice.currency)}</span>
            </div>
          </div>

          <div className="section-title">Shifts</div>
          {(invoice.items ?? []).map((i) => (
            <div key={i.shiftId} className="card stack tight">
              <div className="row">
                <strong style={{ flex: 1 }}>{i.date}</strong>
                <span className="amount">{fmtMoney(i.amountCents, invoice.currency)}</span>
              </div>
              <span className="faint">
                {i.duration} at {fmtMoney(i.rateCents, invoice.currency)}/hr · {i.children.join(', ')}
              </span>
              <button className="btn sm" onClick={() => navigate(`/shift/${i.shiftId}`)}>Open shift</button>
            </div>
          ))}

          {invoice.status !== 'void' && (
            <>
              <div className="section-title" style={{ marginTop: 8 }}>Actions</div>
              <button className="btn primary block" disabled={busy}
                onClick={() => act('Invoice emailed', async () => {
                  const r = await api.sendInvoice(invoice.id);
                  if (r.sent === 0) throw new Error('Nothing was sent — check the email log');
                })}>
                Email this invoice
              </button>
              {invoice.status !== 'paid' && (
                <button className="btn block" disabled={busy}
                  onClick={() => act('Marked paid', () => api.updateInvoice(invoice.id, { status: 'paid' }))}>
                  Mark as paid
                </button>
              )}
              <button className="btn danger block" disabled={busy}
                onClick={() => {
                  if (!window.confirm('Void this invoice? Its shifts become billable again.')) return;
                  act('Invoice voided', () => api.updateInvoice(invoice.id, { status: 'void' }));
                }}>
                Void invoice
              </button>
            </>
          )}
        </div>
      </div>

      {toast}
    </div>
  );
}
