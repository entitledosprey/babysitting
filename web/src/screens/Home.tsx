import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Child, Family, Session } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../lib/router';
import { Sheet, Spinner, ErrorNote, Field } from '../components/ui';
import { fmtDate, fmtDuration, fmtTime, nowIso, durationMinutes, todayDate } from '../lib/time';

export function Home() {
  const { user, logout } = useAuth();
  const [familyId, setFamilyId] = useState<string>(() => localStorage.getItem('familyId') ?? '');
  const [families, setFamilies] = useState<Family[]>(user?.families ?? []);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const family = families.find((f) => f.id === familyId) ?? families[0];

  useEffect(() => {
    api.families().then((f) => {
      setFamilies(f);
      setFamilyId((cur) => (f.some((x) => x.id === cur) ? cur : f[0]?.id ?? ''));
    }).catch((e) => setError(e.message));
  }, []);

  const load = useCallback(async (id: string) => {
    setSessions(null);
    try {
      const [s, c] = await Promise.all([api.sessions(id), api.children(id)]);
      setSessions(s);
      setChildren(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    if (!family) return;
    localStorage.setItem('familyId', family.id);
    load(family.id);
  }, [family, load]);

  if (!family && families.length === 0) return <Spinner />;

  const active = sessions?.find((s) => !s.endedAt);
  const past = sessions?.filter((s) => s.endedAt) ?? [];

  return (
    <div className="app">
      <div className="appbar">
        <div className="grow">
          <div className="title">{family?.name ?? 'Sitter Log'}</div>
          <div className="subtitle">Signed in as {user?.name}</div>
        </div>
        {user?.isAdmin && (
          <button className="btn ghost" onClick={() => navigate('/admin')} aria-label="Administration">🛠️</button>
        )}
        <button className="btn ghost" onClick={() => navigate(`/family/${family!.id}`)} aria-label="Family settings">⚙️</button>
        <button className="btn ghost" onClick={() => logout()}>Sign out</button>
      </div>

      <div className="content pad pad-bottom">
        <div className="stack">
          <ErrorNote error={error} />

          {families.length > 1 && (
            <div className="seg">
              {families.map((f) => (
                <button key={f.id} aria-pressed={f.id === family?.id} onClick={() => setFamilyId(f.id)}>
                  {f.name}
                </button>
              ))}
            </div>
          )}

          {children.length === 0 && sessions !== null && (
            <div className="card stack">
              <h2>Add a child to get started</h2>
              <p className="muted" style={{ margin: 0 }}>
                {family?.role === 'parent'
                  ? 'Sessions are logged against a child, so add one first.'
                  : 'A parent in this family needs to add a child before you can log a session.'}
              </p>
              {family?.role === 'parent' && (
                <button className="btn primary" onClick={() => navigate(`/family/${family.id}`)}>
                  Open family settings
                </button>
              )}
            </div>
          )}

          {active && (
            <button className="card tap stack tight" onClick={() => navigate(`/session/${active.id}`)}
              style={{ borderColor: 'var(--accent)' }}>
              <div className="row">
                <span className="badge" style={{ background: 'var(--accent)', color: '#fff' }}>In progress</span>
                <span className="spacer" />
                <span className="muted">{fmtDuration(durationMinutes(active.startedAt, nowIso()))}</span>
              </div>
              <h2>{active.children.map((c) => c.name).join(' & ')}</h2>
              <div className="muted">
                Started {fmtTime(active.startedAt)} · {active.eventCount ?? 0} entries
              </div>
            </button>
          )}

          {children.length > 0 && !active && (
            <button className="btn primary lg block" onClick={() => setStarting(true)}>
              Start a session
            </button>
          )}

          {sessions === null ? <Spinner /> : past.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 8 }}>Earlier sessions</div>
              {past.map((s) => (
                <button key={s.id} className="card tap stack tight" onClick={() => navigate(`/session/${s.id}`)}>
                  <div className="row">
                    <strong>{s.children.map((c) => c.name).join(' & ')}</strong>
                    <span className="spacer" />
                    <span className="muted">{fmtDuration(durationMinutes(s.startedAt, s.endedAt!))}</span>
                  </div>
                  <div className="muted">
                    {fmtDate(s.startedAt)} · {fmtTime(s.startedAt)}–{fmtTime(s.endedAt!)} · {s.eventCount ?? 0} entries
                  </div>
                  {s.sitterName && <div className="faint">Logged by {s.sitterName}</div>}
                </button>
              ))}
            </>
          )}

          {sessions !== null && sessions.length === 0 && children.length > 0 && (
            <div className="empty">
              <span className="big">🗓️</span>
              No sessions yet. Start one when you arrive.
            </div>
          )}
        </div>
      </div>

      {starting && family && (
        <StartSession
          familyId={family.id}
          children={children}
          onClose={() => setStarting(false)}
          onStarted={(s) => navigate(`/session/${s.id}`)}
        />
      )}
    </div>
  );
}

function StartSession({ familyId, children, onClose, onStarted }: {
  familyId: string; children: Child[]; onClose: () => void; onStarted: (s: Session) => void;
}) {
  const [selected, setSelected] = useState<string[]>(children.length === 1 ? [children[0].id] : []);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      onStarted(await api.createSession(familyId, { childIds: selected, startedAt: nowIso(), notes }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the session');
      setBusy(false);
    }
  };

  return (
    <Sheet title="Start a session" onClose={onClose}>
      <div className="stack">
        <Field label={`Who are you watching today? (${fmtDate(todayDate() + 'T12:00:00')})`}>
          <div className="chips">
            {children.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={selected.includes(c.id)}
                onClick={() => toggle(c.id)}>
                <span className="child-dot" style={{ ['--cc' as string]: c.colour }} />
                {c.name}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Notes from the parents">
          <textarea className="input" rows={2} value={notes}
            placeholder="Anything you were told before they left"
            onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <ErrorNote error={error} />

        <button className="btn primary lg block" disabled={busy || selected.length === 0} onClick={start}>
          {busy ? 'Starting…' : 'Start now'}
        </button>
      </div>
    </Sheet>
  );
}
