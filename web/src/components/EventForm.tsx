import { useState } from 'react';
import type { EventTypeDef } from '../lib/events';
import { defaultDetail } from '../lib/events';
import type { LogEvent, SessionChild } from '../lib/api';
import { nowIso, toIso, toLocalInput, fromLocalInput, fmtTime, durationMinutes, fmtDuration, toMinute } from '../lib/time';
import { Chips, Toggle, NumberPicker, TextField, Field, ErrorNote } from './ui';

/** Nudges a timestamp by whole minutes — the "5 min ago" shortcuts. */
const shift = (iso: string, minutes: number) =>
  toIso(toMinute(new Date(new Date(iso).getTime() + minutes * 60_000)));

function TimePicker({ label, value, onChange, allowClear, onClear }: {
  label: string; value: string; onChange: (iso: string) => void;
  allowClear?: boolean; onClear?: () => void;
}) {
  const [precise, setPrecise] = useState(false);
  return (
    <Field label={label}>
      <div className="stack tight">
        <div className="row wrap">
          <button type="button" className="chip" onClick={() => onChange(shift(value, -15))}>−15m</button>
          <button type="button" className="chip" onClick={() => onChange(shift(value, -5))}>−5m</button>
          <button type="button" className="chip" onClick={() => onChange(toIso(toMinute(new Date())))}>Now</button>
          <button type="button" className="chip" onClick={() => onChange(shift(value, 5))}>+5m</button>
          <button
            type="button"
            className="chip"
            aria-pressed={precise}
            onClick={() => setPrecise((p) => !p)}
            style={{ marginLeft: 'auto', fontWeight: 700 }}
          >
            {fmtTime(value)}
          </button>
          {allowClear && (
            <button type="button" className="chip" onClick={onClear}>Clear</button>
          )}
        </div>
        {precise && (
          <input
            className="input"
            type="datetime-local"
            value={toLocalInput(value)}
            onChange={(e) => e.target.value && onChange(fromLocalInput(e.target.value))}
          />
        )}
      </div>
    </Field>
  );
}

export interface EventDraft {
  childId: string;
  startAt: string;
  endAt: string | null;
  note: string;
  detail: Record<string, unknown>;
}

export function EventForm({ def, children, existing, defaultChildId, submitLabel, onSubmit, onDelete }: {
  def: EventTypeDef;
  children: SessionChild[];
  existing?: LogEvent;
  defaultChildId?: string;
  submitLabel: string;
  onSubmit: (draft: EventDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [childId, setChildId] = useState(existing?.childId ?? defaultChildId ?? children[0]?.id ?? '');
  const [startAt, setStartAt] = useState(existing?.startAt ?? nowIso());
  const [endAt, setEndAt] = useState<string | null>(existing?.endAt ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [detail, setDetail] = useState<Record<string, unknown>>(
    existing ? { ...existing.detail } : defaultDetail(def),
  );
  // A stopwatch entry starts running unless it is being logged after the fact.
  const [mode, setMode] = useState<'running' | 'finished'>(
    existing ? (existing.endAt ? 'finished' : 'running') : def.stopwatch ? 'running' : 'finished',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: unknown) =>
    setDetail((d) => {
      const next = { ...d };
      if (value === undefined || value === '' || value === false) delete next[key];
      else next[key] = value;
      return next;
    });

  const wantsRange = def.duration && mode === 'finished';
  const effectiveEnd = def.duration ? (mode === 'running' ? null : endAt ?? startAt) : null;
  const minutes = effectiveEnd ? durationMinutes(startAt, effectiveEnd) : null;
  const invalidRange = !!effectiveEnd && new Date(effectiveEnd) < new Date(startAt);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ childId, startAt, endAt: effectiveEnd, note: note.trim(), detail });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {children.length > 1 && (
        <Field label="Who">
          <div className="chips">
            {children.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={childId === c.id}
                onClick={() => setChildId(c.id)}>
                <span className="child-dot" style={{ ['--cc' as string]: c.colour }} />
                {c.name}
              </button>
            ))}
          </div>
        </Field>
      )}

      {def.duration && (
        <div className="seg">
          <button type="button" aria-pressed={mode === 'running'} onClick={() => setMode('running')}>
            {def.stopwatch ? `Start ${def.label.toLowerCase()} now` : 'Still going'}
          </button>
          <button type="button" aria-pressed={mode === 'finished'} onClick={() => {
            setMode('finished');
            if (!endAt) setEndAt(nowIso());
          }}>
            Already finished
          </button>
        </div>
      )}

      <TimePicker
        label={def.duration ? 'Started' : 'Time'}
        value={startAt}
        onChange={setStartAt}
      />

      {wantsRange && (
        <TimePicker label="Ended" value={endAt ?? startAt} onChange={setEndAt} />
      )}

      {minutes != null && !invalidRange && (
        <div className="muted" style={{ marginTop: -4 }}>
          {fmtTime(startAt)} → {fmtTime(effectiveEnd!)} · <strong>{fmtDuration(minutes)}</strong>
        </div>
      )}
      {invalidRange && <ErrorNote error="The end time is before the start time." />}

      {def.fields.map((f) => {
        if (f.kind === 'toggle') {
          return (
            <Toggle key={f.key} label={f.label}
              value={detail[f.key] === true}
              onChange={(v) => set(f.key, v)} />
          );
        }
        if (f.kind === 'chips') {
          return (
            <Field key={f.key} label={f.label}>
              <Chips options={f.options} clearable={f.clearable}
                value={detail[f.key] as string | undefined}
                onChange={(v) => set(f.key, v)} />
            </Field>
          );
        }
        if (f.kind === 'number') {
          return (
            <Field key={f.key} label={f.label}>
              <NumberPicker unit={f.unit} presets={f.presets} step={f.step}
                value={detail[f.key] as number | undefined}
                onChange={(v) => set(f.key, v)} />
            </Field>
          );
        }
        return (
          <Field key={f.key} label={f.label}>
            <TextField placeholder={f.placeholder} presets={f.presets}
              value={(detail[f.key] as string) ?? ''}
              onChange={(v) => set(f.key, v)} />
          </Field>
        );
      })}

      <Field label="Note">
        <textarea className="input" value={note} rows={2}
          placeholder={def.notePlaceholder ?? 'Optional'}
          onChange={(e) => setNote(e.target.value)} />
      </Field>

      <ErrorNote error={error} />

      <button className="btn primary lg block" disabled={busy || invalidRange || !childId} onClick={submit}>
        {busy ? 'Saving…' : submitLabel}
      </button>

      {onDelete && (
        <button className="btn danger block" disabled={busy} onClick={async () => {
          if (!window.confirm('Delete this entry?')) return;
          setBusy(true);
          try { await onDelete(); } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete that');
            setBusy(false);
          }
        }}>
          Delete entry
        </button>
      )}
    </div>
  );
}
