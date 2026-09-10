import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { LogEvent, Session } from '../lib/api';
import { navigate } from '../lib/router';
import { Timeline } from '../components/Timeline';
import { QuickAdd, EditEvent } from '../components/QuickAdd';
import type { EventDraft } from '../components/EventForm';
import { RunningBanner } from '../components/NapBanner';
import { Sheet, Spinner, ErrorNote, useToast } from '../components/ui';
import { typeDef } from '../lib/events';
import { fmtDate, fmtDuration, fmtTime, nowIso, durationMinutes } from '../lib/time';

export function Day({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LogEvent | null>(null);
  const [ending, setEnding] = useState(false);
  const [childFilter, setChildFilter] = useState<string>('all');
  const [now, setNow] = useState(() => new Date());
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.session(sessionId).then(setSession).catch((e) => setError(e.message));
  }, [sessionId]);

  // One-second tick keeps the running stopwatch and the "now" line honest.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const patchEvents = useCallback((fn: (events: LogEvent[]) => LogEvent[]) => {
    setSession((s) => (s ? { ...s, events: fn(s.events ?? []) } : s));
  }, []);

  const events = useMemo(() => session?.events ?? [], [session]);
  const visible = useMemo(
    () => (childFilter === 'all' ? events : events.filter((e) => e.childId === childFilter)),
    [events, childFilter],
  );
  const running = useMemo(
    () => events.filter((e) => typeDef(e.type).duration && !e.endAt),
    [events],
  );

  if (error) return <div className="pad"><ErrorNote error={error} /></div>;
  if (!session) return <Spinner />;

  const ended = !!session.endedAt;

  const create = async (type: string, draft: EventDraft) => {
    const created = await api.createEvent(session.id, { type, ...draft });
    patchEvents((es) => [...es, created]);
    const def = typeDef(type);
    showToast(created.endAt === null && def.duration ? `${def.label} started` : `${def.label} saved`);
  };

  const stop = async (event: LogEvent) => {
    try {
      const stopped = await api.stopEvent(event.id, { endAt: nowIso() });
      patchEvents((es) => es.map((e) => (e.id === stopped.id ? stopped : e)));
      const mins = durationMinutes(stopped.startAt, stopped.endAt!);
      showToast(`${typeDef(event.type).label} · ${fmtDuration(mins)}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not stop that');
    }
  };

  return (
    <div className="app">
      <div className="appbar">
        <button className="btn ghost" onClick={() => navigate('/')} aria-label="Back">‹</button>
        <div className="grow">
          <div className="title">{session.children.map((c) => c.name).join(' & ')}</div>
          <div className="subtitle">
            {fmtDate(session.startedAt)} · {fmtTime(session.startedAt)}
            {session.endedAt ? `–${fmtTime(session.endedAt)}` : ' – now'}
          </div>
        </div>
        <button className="btn sm" onClick={() => navigate(`/session/${session.id}/report`)}>Report</button>
      </div>

      {session.children.length > 1 && (
        <div style={{ padding: '10px 14px 0' }}>
          <div className="seg">
            <button aria-pressed={childFilter === 'all'} onClick={() => setChildFilter('all')}>Both</button>
            {session.children.map((c) => (
              <button key={c.id} aria-pressed={childFilter === c.id} onClick={() => setChildFilter(c.id)}>
                <span className="child-dot" style={{ ['--cc' as string]: c.colour }} />{c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ paddingTop: 12 }}>
        <RunningBanner running={running} childList={session.children} now={now} onStop={stop} />
      </div>

      {events.length === 0 ? (
        <div className="content">
          <div className="empty">
            <span className="big">📋</span>
            Nothing logged yet.<br />Tap ＋ to add the first entry.
          </div>
        </div>
      ) : (
        <Timeline
          events={visible}
          childList={session.children}
          sessionStart={session.startedAt}
          sessionEnd={session.endedAt}
          now={now}
          onSelect={setEditing}
        />
      )}

      {!ended && (
        <>
          <button className="fab" onClick={() => setAdding(true)} aria-label="Add an entry">＋</button>
          <div style={{ position: 'fixed', left: 14, bottom: 'calc(28px + var(--safe-bottom))', zIndex: 44 }}>
            <button className="btn" onClick={() => setEnding(true)}>End session</button>
          </div>
        </>
      )}

      {ended && (
        <div style={{ position: 'fixed', left: 14, right: 14, bottom: 'calc(20px + var(--safe-bottom))', zIndex: 44 }}>
          <button className="btn primary lg block" onClick={() => navigate(`/session/${session.id}/report`)}>
            View the daily report
          </button>
        </div>
      )}

      {adding && (
        <QuickAdd
          childList={session.children}
          defaultChildId={childFilter === 'all' ? undefined : childFilter}
          onClose={() => setAdding(false)}
          onCreate={create}
        />
      )}

      {editing && (
        <EditEvent
          event={editing}
          childList={session.children}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            const updated = await api.updateEvent(editing.id, draft);
            patchEvents((es) => es.map((e) => (e.id === updated.id ? updated : e)));
            showToast('Updated');
          }}
          onDelete={async () => {
            await api.deleteEvent(editing.id);
            patchEvents((es) => es.filter((e) => e.id !== editing.id));
            showToast('Deleted');
          }}
        />
      )}

      {ending && (
        <EndSession
          session={session}
          runningCount={running.length}
          onClose={() => setEnding(false)}
          onEnded={(s) => {
            setSession(s);
            navigate(`/session/${s.id}/report`);
          }}
        />
      )}

      {toast}
    </div>
  );
}

function EndSession({ session, runningCount, onClose, onEnded }: {
  session: Session; runningCount: number; onClose: () => void; onEnded: (s: Session) => void;
}) {
  const [notes, setNotes] = useState(session.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      if (notes !== session.notes) await api.updateSession(session.id, { notes });
      onEnded(await api.endSession(session.id, nowIso()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end the session');
      setBusy(false);
    }
  };

  return (
    <Sheet title="End this session" onClose={onClose}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          The daily report is generated as soon as you finish.
          {runningCount > 0 && ` Anything still running (${runningCount}) will be stopped now.`}
        </p>
        <label className="field">
          <span className="field-label">Notes for the parents</span>
          <textarea className="input" rows={3} value={notes}
            placeholder="How the day went overall"
            onChange={(e) => setNotes(e.target.value)} />
        </label>
        <ErrorNote error={error} />
        <button className="btn primary lg block" disabled={busy} onClick={end}>
          {busy ? 'Finishing…' : 'End session and see the report'}
        </button>
      </div>
    </Sheet>
  );
}
