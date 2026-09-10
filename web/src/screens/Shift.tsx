import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { LogEvent, Shift as ShiftType } from '../lib/api';
import { navigate } from '../lib/router';
import { Timeline } from '../components/Timeline';
import { QuickAdd, EditEvent } from '../components/QuickAdd';
import { RunningBanner } from '../components/NapBanner';
import { Sheet, Spinner, ErrorNote, useToast } from '../components/ui';
import type { EventDraft } from '../components/EventForm';
import { typeDef } from '../lib/events';
import { fmtDate, fmtDuration, fmtTime, nowIso, durationMinutes } from '../lib/time';

export function Shift({ shiftId }: { shiftId: string }) {
  const [shift, setShift] = useState<ShiftType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LogEvent | null>(null);
  const [ending, setEnding] = useState(false);
  const [childFilter, setChildFilter] = useState<string>('all');
  const [now, setNow] = useState(() => new Date());
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.shift(shiftId).then(setShift).catch((e) => setError(e.message));
  }, [shiftId]);

  // One-second tick keeps the running stopwatch and the "now" line honest.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const patchEvents = useCallback((fn: (events: LogEvent[]) => LogEvent[]) => {
    setShift((s) => (s ? { ...s, events: fn(s.events ?? []) } : s));
  }, []);

  const events = useMemo(() => shift?.events ?? [], [shift]);
  const visible = useMemo(
    () => (childFilter === 'all' ? events : events.filter((e) => e.childId === childFilter)),
    [events, childFilter],
  );
  const running = useMemo(
    () => events.filter((e) => typeDef(e.type).duration && !e.endAt),
    [events],
  );

  if (error) return <div className="pad"><ErrorNote error={error} /></div>;
  if (!shift) return <Spinner />;

  const kids = shift.children ?? [];
  const canEdit = shift.access === 'owner' && shift.status === 'in_progress';
  const isOwner = shift.access === 'owner';

  const create = async (type: string, draft: EventDraft) => {
    const created = await api.createEvent(shift.id, { type, ...draft });
    patchEvents((es) => [...es, created]);
    const def = typeDef(type);
    showToast(created.endAt === null && def.duration ? `${def.label} started` : `${def.label} saved`);
  };

  const stop = async (event: LogEvent) => {
    try {
      const stopped = await api.stopEvent(event.id, { endAt: nowIso() });
      patchEvents((es) => es.map((e) => (e.id === stopped.id ? stopped : e)));
      showToast(`${typeDef(event.type).label} · ${fmtDuration(durationMinutes(stopped.startAt, stopped.endAt!))}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not stop that');
    }
  };

  return (
    <div className="app">
      <div className="appbar">
        <button className="btn ghost" onClick={() => navigate('/')} aria-label="Back">‹</button>
        <div className="grow">
          <div className="title">{shift.client?.name ?? shift.clientName}</div>
          <div className="subtitle">
            {fmtDate(shift.startedAt ?? shift.scheduledStart ?? `${shift.date}T12:00:00`)}
            {shift.startedAt && ` · ${fmtTime(shift.startedAt)}`}
            {shift.endedAt ? `–${fmtTime(shift.endedAt)}` : shift.startedAt ? ' – now' : ''}
          </div>
        </div>
        {shift.startedAt && (
          <button className="btn sm" onClick={() => navigate(`/shift/${shift.id}/report`)}>Report</button>
        )}
      </div>

      {shift.parentNotes && (
        <div style={{ padding: '10px 14px 0' }}>
          <div className="callout"><div className="k">From the parents</div>{shift.parentNotes}</div>
        </div>
      )}

      {kids.length > 1 && (
        <div style={{ padding: '10px 14px 0' }}>
          <div className="seg">
            <button aria-pressed={childFilter === 'all'} onClick={() => setChildFilter('all')}>All</button>
            {kids.map((c) => (
              <button key={c.id} aria-pressed={childFilter === c.id} onClick={() => setChildFilter(c.id)}>
                <span className="child-dot" style={{ ['--cc' as string]: c.colour }} />{c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {canEdit && (
        <div style={{ paddingTop: 12 }}>
          <RunningBanner running={running} childList={kids} now={now} onStop={stop} />
        </div>
      )}

      {!shift.startedAt ? (
        <div className="content">
          <div className="empty">
            <span className="big">🗓️</span>
            This shift hasn't started yet.
            {isOwner && <><br /><br />
              <button className="btn primary" onClick={async () => {
                try { setShift(await api.startShift(shift.id)); showToast('Shift started'); }
                catch (e) { showToast(e instanceof Error ? e.message : 'Could not start'); }
              }}>Start the shift</button>
            </>}
          </div>
        </div>
      ) : events.length === 0 ? (
        <div className="content">
          <div className="empty">
            <span className="big">📋</span>
            Nothing logged yet.{canEdit && <><br />Tap ＋ to add the first entry.</>}
          </div>
        </div>
      ) : (
        <Timeline
          events={visible}
          childList={kids}
          shiftStart={shift.startedAt}
          shiftEnd={shift.endedAt}
          now={now}
          onSelect={(e) => canEdit && setEditing(e)}
        />
      )}

      {canEdit && (
        <>
          <button className="fab" onClick={() => setAdding(true)} aria-label="Add an entry">＋</button>
          <div style={{ position: 'fixed', left: 14, bottom: 'calc(28px + var(--safe-bottom))', zIndex: 44 }}>
            <button className="btn" onClick={() => setEnding(true)}>End shift</button>
          </div>
        </>
      )}

      {shift.status === 'completed' && (
        <div style={{ position: 'fixed', left: 14, right: 14, bottom: 'calc(20px + var(--safe-bottom))', zIndex: 44 }}>
          <button className="btn primary lg block" onClick={() => navigate(`/shift/${shift.id}/report`)}>
            View the report
          </button>
        </div>
      )}

      {adding && (
        <QuickAdd
          childList={kids}
          defaultChildId={childFilter === 'all' ? undefined : childFilter}
          onClose={() => setAdding(false)}
          onCreate={create}
        />
      )}

      {editing && (
        <EditEvent
          event={editing}
          childList={kids}
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
        <EndShift shift={shift} runningCount={running.length} onClose={() => setEnding(false)}
          onEnded={(s) => { setShift(s); navigate(`/shift/${s.id}/report`); }} />
      )}

      {toast}
    </div>
  );
}

function EndShift({ shift, runningCount, onClose, onEnded }: {
  shift: ShiftType; runningCount: number; onClose: () => void; onEnded: (s: ShiftType) => void;
}) {
  const [notes, setNotes] = useState(shift.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet title="End this shift" onClose={onClose}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          The report is generated and emailed to this client's contacts as soon as you finish.
          {runningCount > 0 && ` Anything still running (${runningCount}) will be stopped now.`}
        </p>
        <label className="field">
          <span className="field-label">Notes for the parents</span>
          <textarea className="input" rows={3} value={notes}
            placeholder="How the day went overall" onChange={(e) => setNotes(e.target.value)} />
        </label>
        <ErrorNote error={error} />
        <button className="btn primary lg block" disabled={busy} onClick={async () => {
          setBusy(true);
          setError(null);
          try { onEnded(await api.endShift(shift.id, { endedAt: nowIso(), notes })); }
          catch (e) {
            setError(e instanceof Error ? e.message : 'Could not end the shift');
            setBusy(false);
          }
        }}>{busy ? 'Finishing…' : 'End shift and send the report'}</button>
      </div>
    </Sheet>
  );
}
