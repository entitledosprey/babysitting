import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Client, Shift } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../lib/router';
import { TabBar } from '../components/TabBar';
import { Sheet, Spinner, ErrorNote, Field, useToast } from '../components/ui';
import { fmtDate, fmtTime, fmtDuration, nowIso, durationMinutes, todayDate, toLocalInput, fromLocalInput } from '../lib/time';

const statusPill = (s: Shift) => {
  if (s.status === 'in_progress') return <span className="pill live">On shift</span>;
  if (s.status === 'scheduled') return <span className="pill scheduled">Booked</span>;
  if (s.status === 'cancelled') return <span className="pill cancelled">Cancelled</span>;
  return <span className="pill done">Done</span>;
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function Today() {
  const { user } = useAuth();
  const [active, setActive] = useState<Shift[] | null>(null);
  const [upcoming, setUpcoming] = useState<Shift[]>([]);
  const [past, setPast] = useState<Shift[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [a, u, p, c] = await Promise.all([
        api.shifts('active'), api.shifts('upcoming'), api.shifts('past'), api.clients(),
      ]);
      setActive(a);
      setUpcoming(u);
      setPast(p.slice(0, 8));
      setClients(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
      setActive([]);
    }
  }, []);

  useEffect(() => { load(); }, [load, tick]);

  // Keeps the running duration on the active shift honest.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const today = todayDate();
  const todayShifts = upcoming.filter((s) => s.date === today);

  return (
    <div className="app">
      <div className="appbar">
        <div className="grow">
          <div className="title">{user?.business?.name ?? 'Sitter Log'}</div>
          <div className="subtitle">{fmtDate(`${today}T12:00:00`)}</div>
        </div>
      </div>

      <div className="content pad pad-bottom">
        <div className="stack">
          <ErrorNote error={error} />

          {active === null ? <Spinner /> : (
            <>
              {active.map((s) => (
                <button key={s.id} className="card tap stack tight"
                  style={{ borderColor: 'var(--accent)' }}
                  onClick={() => navigate(`/shift/${s.id}`)}>
                  <div className="row">
                    {statusPill(s)}
                    <span className="spacer" />
                    <span className="muted">{fmtDuration(durationMinutes(s.startedAt!, nowIso()))}</span>
                  </div>
                  <h2>{s.clientName}</h2>
                  <div className="muted">
                    Started {fmtTime(s.startedAt!)} · {s.eventCount ?? 0} entries
                  </div>
                  <div className="faint">{(s.children ?? []).map((c) => c.name).join(', ')}</div>
                </button>
              ))}

              {clients.length === 0 ? (
                <div className="card stack">
                  <h2>Add your first client</h2>
                  <p className="muted" style={{ margin: 0 }}>
                    A client is a family you sit for. Add their children and contacts once, then
                    every shift and report is a couple of taps.
                  </p>
                  <button className="btn primary" onClick={() => navigate('/clients')}>Add a client</button>
                </div>
              ) : active.length === 0 && (
                <button className="btn primary lg block" onClick={() => setBooking(true)}>
                  Start a shift
                </button>
              )}

              {todayShifts.length > 0 && (
                <>
                  <div className="section-title" style={{ marginTop: 8 }}>Later today</div>
                  {todayShifts.map((s) => (
                    <ShiftRow key={s.id} shift={s} onChanged={() => setTick((n) => n + 1)} showToast={showToast} />
                  ))}
                </>
              )}

              {upcoming.filter((s) => s.date > today).length > 0 && (
                <>
                  <div className="section-title" style={{ marginTop: 8 }}>Coming up</div>
                  {upcoming.filter((s) => s.date > today).map((s) => (
                    <ShiftRow key={s.id} shift={s} onChanged={() => setTick((n) => n + 1)} showToast={showToast} />
                  ))}
                </>
              )}

              {clients.length > 0 && upcoming.length === 0 && active.length === 0 && (
                <button className="btn block" onClick={() => setBooking(true)}>Book a shift for later</button>
              )}

              {past.length > 0 && (
                <>
                  <div className="section-title" style={{ marginTop: 8 }}>Recent shifts</div>
                  {past.map((s) => (
                    <button key={s.id} className="rowcard" onClick={() => navigate(`/shift/${s.id}`)}>
                      <span className="avatar">{initials(s.clientName ?? '?')}</span>
                      <span className="main">
                        <strong>{s.clientName}</strong>
                        <span className="faint">
                          {s.date} · {fmtTime(s.startedAt!)}–{fmtTime(s.endedAt!)} · {fmtDuration(s.minutes)}
                        </span>
                      </span>
                      {s.reportSentAt
                        ? <span className="pill done">Sent</span>
                        : <span className="pill">No report</span>}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {booking && (
        <BookShift clients={clients} onClose={() => setBooking(false)}
          onDone={(shift, started) => {
            setBooking(false);
            if (started) navigate(`/shift/${shift.id}`);
            else { setTick((n) => n + 1); showToast('Shift booked'); }
          }} />
      )}

      {toast}
      <TabBar current="/" />
    </div>
  );
}

function ShiftRow({ shift, onChanged, showToast }: {
  shift: Shift; onChanged: () => void; showToast: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="card stack tight">
      <div className="row">
        <strong style={{ flex: 1 }}>{shift.clientName}</strong>
        {statusPill(shift)}
      </div>
      <div className="muted">
        {shift.date}
        {shift.scheduledStart && ` · ${fmtTime(shift.scheduledStart)}`}
        {shift.scheduledEnd && `–${fmtTime(shift.scheduledEnd)}`}
      </div>
      {shift.parentNotes && <div className="faint">“{shift.parentNotes}”</div>}
      <div className="row">
        <button className="btn sm primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await api.startShift(shift.id);
            navigate(`/shift/${shift.id}`);
          } catch (e) {
            showToast(e instanceof Error ? e.message : 'Could not start');
            setBusy(false);
          }
        }}>Start now</button>
        <span className="spacer" />
        <button className="btn sm" disabled={busy} onClick={async () => {
          if (!window.confirm('Cancel this booked shift?')) return;
          setBusy(true);
          try { await api.cancelShift(shift.id); onChanged(); showToast('Shift cancelled'); }
          catch (e) { showToast(e instanceof Error ? e.message : 'Could not cancel'); }
          setBusy(false);
        }}>Cancel</button>
      </div>
    </div>
  );
}

function BookShift({ clients, onClose, onDone }: {
  clients: Client[]; onClose: () => void; onDone: (shift: Shift, started: boolean) => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [start, setStart] = useState(() => toLocalInput(nowIso()));
  const [end, setEnd] = useState('');
  const [parentNotes, setParentNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = clients.find((c) => c.id === clientId);
  const kids = client?.children ?? [];

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const shift = await api.createShift({
        clientId,
        ...(when === 'now'
          ? { startNow: true }
          : { scheduledStart: fromLocalInput(start), scheduledEnd: end ? fromLocalInput(end) : undefined }),
        parentNotes,
      });
      onDone(shift, when === 'now');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the shift');
      setBusy(false);
    }
  };

  return (
    <Sheet title="New shift" onClose={onClose}>
      <div className="stack">
        <Field label="Client">
          <div className="chips">
            {clients.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={clientId === c.id}
                onClick={() => setClientId(c.id)}>{c.name}</button>
            ))}
          </div>
        </Field>

        {kids.length > 0 && (
          <div className="faint">
            Covers {kids.map((k) => k.name).join(', ')} — you can change this once the shift starts.
          </div>
        )}

        <div className="seg">
          <button aria-pressed={when === 'now'} onClick={() => setWhen('now')}>Starting now</button>
          <button aria-pressed={when === 'later'} onClick={() => setWhen('later')}>Book for later</button>
        </div>

        {when === 'later' && (
          <>
            <Field label="Starts">
              <input className="input" type="datetime-local" value={start}
                onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Expected to end (optional)">
              <input className="input" type="datetime-local" value={end}
                onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </>
        )}

        <Field label="Notes from the parents">
          <textarea className="input" rows={2} value={parentNotes}
            placeholder="Anything they told you beforehand"
            onChange={(e) => setParentNotes(e.target.value)} />
        </Field>

        <ErrorNote error={error} />

        <button className="btn primary lg block" disabled={busy || !clientId} onClick={go}>
          {busy ? 'Just a moment…' : when === 'now' ? 'Start the shift' : 'Book it'}
        </button>
      </div>
    </Sheet>
  );
}
