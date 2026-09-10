import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Client, Shift } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../lib/router';
import { Spinner, ErrorNote, Sheet, Field, useToast } from '../components/ui';
import { fmtDate, fmtDuration, fmtTime } from '../lib/time';

/**
 * The parent's whole app: their own family, and what happened on each shift.
 * Read-only by construction — the API refuses writes, and nothing here offers
 * any.
 */
export function ParentHome() {
  const { user, logout, refresh } = useAuth();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    Promise.all([api.clients(), api.shifts('all')])
      .then(([c, s]) => { setClients(c); setShifts(s); })
      .catch((e) => { setError(e.message); setClients([]); });
  }, []);

  if (error) return <div className="pad"><ErrorNote error={error} /></div>;
  if (clients === null) return <Spinner />;

  const active = shifts.filter((s) => s.status === 'in_progress');
  const past = shifts.filter((s) => s.status === 'completed');

  return (
    <div className="app">
      <div className="appbar">
        <div className="grow">
          <div className="title">{clients[0]?.name ?? 'Sitter Log'}</div>
          <div className="subtitle">{user?.parentOf[0]?.businessName ?? ''}</div>
        </div>
        <button className="btn ghost" onClick={() => logout()}>Sign out</button>
      </div>

      <div className="content pad pad-bottom">
        <div className="stack">
          {active.map((s) => (
            <button key={s.id} className="card tap stack tight" style={{ borderColor: 'var(--accent)' }}
              onClick={() => navigate(`/shift/${s.id}`)}>
              <div className="row">
                <span className="pill live">On shift now</span>
                <span className="spacer" />
                <span className="muted">since {fmtTime(s.startedAt!)}</span>
              </div>
              <h2>{s.clientName}</h2>
              <div className="muted">{s.eventCount ?? 0} entries logged so far</div>
            </button>
          ))}

          {clients.map((c) => (
            <button key={c.id} className="card tap stack tight" onClick={() => navigate(`/client/${c.id}`)}>
              <strong>{c.name}</strong>
              <span className="faint">
                {(c.children ?? []).map((k) => k.name).join(', ') || 'No children listed'}
              </span>
              <span className="faint">Tap for care details and contacts</span>
            </button>
          ))}

          <div className="section-title" style={{ marginTop: 8 }}>Past shifts</div>
          {past.length === 0 && <div className="muted">No completed shifts yet.</div>}
          {past.map((s) => (
            <button key={s.id} className="rowcard" onClick={() => navigate(`/shift/${s.id}/report`)}>
              <span className="main">
                <strong>{fmtDate(s.startedAt ?? `${s.date}T12:00:00`)}</strong>
                <span className="faint">
                  {fmtTime(s.startedAt!)}–{fmtTime(s.endedAt!)} · {fmtDuration(s.minutes)}
                  {s.sitterName ? ` · ${s.sitterName}` : ''}
                </span>
              </span>
              <span className="pill done">Report</span>
            </button>
          ))}

          <button className="btn ghost block" style={{ marginTop: 16 }} onClick={() => setJoining(true)}>
            Join another family with a code
          </button>
        </div>
      </div>

      {joining && (
        <JoinAnother onClose={() => setJoining(false)}
          onDone={async () => { setJoining(false); await refresh(); showToast('Joined'); }} />
      )}

      {toast}
    </div>
  );
}

function JoinAnother({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet title="Join another family" onClose={onClose}>
      <div className="stack">
        <Field label="Invite code">
          <input className="input" value={code} placeholder="ABCD2345"
            style={{ textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 700 }}
            onChange={(e) => setCode(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <button className="btn primary lg block" disabled={busy || !code.trim()} onClick={async () => {
          setBusy(true);
          setError(null);
          try { await api.joinClient(code.toUpperCase()); onDone(); }
          catch (e) { setError(e instanceof Error ? e.message : 'Could not join'); setBusy(false); }
        }}>{busy ? 'Joining…' : 'Join'}</button>
      </div>
    </Sheet>
  );
}
