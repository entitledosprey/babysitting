import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Client } from '../lib/api';
import { navigate } from '../lib/router';
import { TabBar } from '../components/TabBar';
import { Sheet, Spinner, ErrorNote, Field, useToast } from '../components/ui';
import { fmtRate } from '../lib/money';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function Clients() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      setClients(await api.clients(showArchived));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
      setClients([]);
    }
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="app">
      <div className="appbar">
        <div className="grow">
          <div className="title">Clients</div>
          <div className="subtitle">
            {clients ? `${clients.filter((c) => !c.archived).length} active` : ' '}
          </div>
        </div>
        <button className="btn sm primary" onClick={() => setAdding(true)}>Add</button>
      </div>

      <div className="content pad pad-bottom">
        <div className="stack">
          <ErrorNote error={error} />

          {clients === null ? <Spinner /> : clients.length === 0 ? (
            <div className="empty">
              <span className="big">👨‍👩‍👧</span>
              No clients yet.<br />Add the first family you sit for.
            </div>
          ) : clients.map((c) => (
            <button key={c.id} className="rowcard" onClick={() => navigate(`/client/${c.id}`)}>
              <span className="avatar">{initials(c.name)}</span>
              <span className="main">
                <strong>{c.name}</strong>
                <span className="faint">
                  {(c.children ?? []).map((k) => k.name).join(', ') || 'No children yet'}
                </span>
                <span className="faint">
                  {fmtRate(c.rateCents)}
                  {c.upcomingShifts ? ` · ${c.upcomingShifts} booked` : ''}
                  {c.lastShift ? ` · last ${c.lastShift}` : ''}
                </span>
              </span>
              {c.archived && <span className="pill">Archived</span>}
            </button>
          ))}

          <button className="btn ghost block" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide archived clients' : 'Show archived clients'}
          </button>
        </div>
      </div>

      {adding && (
        <AddClient onClose={() => setAdding(false)}
          onDone={(c) => { setAdding(false); showToast('Client added'); navigate(`/client/${c.id}`); }} />
      )}

      {toast}
      <TabBar current="/clients" />
    </div>
  );
}

function AddClient({ onClose, onDone }: { onClose: () => void; onDone: (c: Client) => void }) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet title="Add a client" onClose={onClose}>
      <div className="stack">
        <Field label="Family name">
          <input className="input" value={name} placeholder="e.g. The Okonkwos"
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Hourly rate (optional)">
          <input className="input" inputMode="decimal" value={rate} placeholder="25.00"
            onChange={(e) => setRate(e.target.value)} />
          <span className="faint">Leave blank to use your business default.</span>
        </Field>
        <Field label="Address (optional)">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <button className="btn primary lg block" disabled={busy || !name.trim()} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            onDone(await api.createClient({
              name: name.trim(), address, rate: rate ? Number(rate) : undefined,
            }));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not add the client');
            setBusy(false);
          }
        }}>
          {busy ? 'Adding…' : 'Add client'}
        </button>
      </div>
    </Sheet>
  );
}
