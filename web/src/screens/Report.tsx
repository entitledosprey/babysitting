import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ChildReport, Report as ReportData, ReportEntry } from '../lib/api';
import { navigate } from '../lib/router';
import { Spinner, ErrorNote, useToast } from '../components/ui';
import { fmtDate, fmtDuration, fmtTime } from '../lib/time';

const Line = ({ when, children }: { when?: string; children: React.ReactNode }) => (
  <div className="rep-line">
    <span className="when">{when ? fmtTime(when) : ''}</span>
    <span className="what">{children}</span>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="section">
    <div className="section-title">{title}</div>
    {children}
  </div>
);

const Stat = ({ v, k }: { v: string | number; k: string }) => (
  <div className="stat"><div className="v">{v}</div><div className="k">{k}</div></div>
);

const note = (e: ReportEntry) => (e.note ? <em className="muted"> “{e.note}”</em> : null);

function ChildSection({ entry }: { entry: ChildReport }) {
  const { child, sleep, food, diapering, activities, health, observations } = entry;
  const nothing = <div className="muted">Nothing recorded.</div>;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>
        <span className="child-dot" style={{ ['--cc' as string]: child.colour }} />
        {child.name}
      </h2>

      <Section title="Sleep">
        <div className="stat-row">
          <Stat v={sleep.napCount} k={sleep.napCount === 1 ? 'nap' : 'naps'} />
          <Stat v={fmtDuration(sleep.totalMinutes) || '—'} k="total sleep" />
          <Stat v={fmtDuration(sleep.longestMinutes) || '—'} k="longest" />
        </div>
        <div style={{ marginTop: 10 }}>
          {sleep.naps.length === 0 ? nothing : sleep.naps.map((n, i) => (
            <Line key={i} when={n.at}>
              {n.end ? `until ${fmtTime(n.end as string)}` : 'still asleep'}
              {n.minutes ? <strong> · {fmtDuration(n.minutes)}</strong> : null}
              {n.fellAsleep ? <span className="muted"> · fell asleep {String(n.fellAsleep)}</span> : null}
              {n.moodOnWaking ? <span className="muted"> · woke {String(n.moodOnWaking)}</span> : null}
              {n.difficultToSettle ? <span className="muted"> · difficult to settle</span> : null}
              {note(n)}
            </Line>
          ))}
        </div>
      </Section>

      <Section title="Food & drink">
        <div className="stat-row">
          <Stat v={food.bottleCount} k="bottles" />
          <Stat v={food.totalOz ? `${food.totalOz} oz` : '—'} k="bottle total" />
          <Stat v={food.mealCount} k="meals" />
          <Stat v={food.snackCount} k="snacks" />
          <Stat v={food.totalWaterOz ? `${food.totalWaterOz} oz` : '—'} k="water" />
        </div>
        <div style={{ marginTop: 10 }}>
          {[...food.bottles.map((b) => ({ e: b, text: `Bottle — ${b.amountOz ?? '?'} oz ${b.contents ?? ''}${b.finished === false ? ' (not finished)' : ''}` })),
            ...food.feedings.map((f) => ({ e: f, text: `Meal${f.food ? ` — ${f.food}` : ''}${f.amountEaten ? ` (ate ${f.amountEaten})` : ''}` })),
            ...food.snacks.map((s) => ({ e: s, text: `Snack${s.food ? ` — ${s.food}` : ''}` })),
            ...food.waters.map((w) => ({ e: w, text: `Water${w.amountOz ? ` — ${w.amountOz} oz` : ''}` }))]
            .sort((a, b) => String(a.e.at).localeCompare(String(b.e.at)))
            .map(({ e, text }, i) => <Line key={i} when={e.at}>{text}{note(e)}</Line>)}
          {!food.bottles.length && !food.feedings.length && !food.snacks.length && !food.waters.length && nothing}
        </div>
      </Section>

      <Section title="Diapers & potty">
        <div className="stat-row">
          <Stat v={diapering.total} k="diapers" />
          <Stat v={diapering.wet} k="wet" />
          <Stat v={diapering.dirty} k="dirty" />
          <Stat v={diapering.pottyCount} k="potty trips" />
        </div>
        <div style={{ marginTop: 10 }}>
          {[...diapering.diapers.map((d) => ({
              e: d,
              text: [d.wet && 'wet', d.dirty && 'dirty'].filter(Boolean).join(' + ') || 'dry',
              extra: d.rash ? ' · rash noted' : '',
            })),
            ...diapering.pottyTrips.map((p) => ({
              e: p,
              text: `Potty — ${[p.pee && 'pee', p.poop && 'poop'].filter(Boolean).join(' + ') || 'tried'}`,
              extra: p.accident ? ' · accident' : '',
            }))]
            .sort((a, b) => String(a.e.at).localeCompare(String(b.e.at)))
            .map(({ e, text, extra }, i) => (
              <Line key={i} when={e.at}>{text}<span className="muted">{extra}</span>{note(e)}</Line>
            ))}
          {!diapering.total && !diapering.pottyCount && nothing}
        </div>
      </Section>

      <Section title="Activities">
        {activities.items.length === 0 && !activities.baths.length && !activities.quiet.length
          && !activities.screenTime.length ? nothing : (
          <>
            {activities.items.map((a, i) => (
              <Line key={`a${i}`} when={a.at}>
                {String(a.kind ?? 'Activity')}
                {a.minutes ? <span className="muted"> · {fmtDuration(a.minutes)}</span> : null}
                {note(a)}
              </Line>
            ))}
            {activities.baths.map((b, i) => <Line key={`b${i}`} when={b.at}>Bath{note(b)}</Line>)}
            {activities.quiet.map((q, i) => (
              <Line key={`q${i}`} when={q.at}>Quiet time{q.minutes ? <span className="muted"> · {fmtDuration(q.minutes)}</span> : null}</Line>
            ))}
            {activities.screenTime.map((s, i) => (
              <Line key={`s${i}`} when={s.at}>Screen time{s.minutes ? <span className="muted"> · {fmtDuration(s.minutes)}</span> : null}{note(s)}</Line>
            ))}
            <div className="muted" style={{ marginTop: 8 }}>
              Total activity time: <strong>{fmtDuration(activities.totalMinutes) || 'none logged'}</strong>
              {activities.screenMinutes ? ` · screen time: ${fmtDuration(activities.screenMinutes)}` : ''}
            </div>
          </>
        )}
      </Section>

      {(health.medications.length > 0 || health.incidents.length > 0) && (
        <Section title="Health">
          {health.medications.map((m, i) => (
            <Line key={`m${i}`} when={m.at}>
              💊 {String(m.name ?? 'Medication')}{m.dose ? ` — ${m.dose}` : ''}{note(m)}
            </Line>
          ))}
          {health.incidents.map((x, i) => (
            <Line key={`i${i}`} when={x.at}>
              🚨 <strong>Incident{x.severity ? ` (${x.severity})` : ''}</strong>
              {x.note ? ` — ${x.note}` : ''}
              {x.actionTaken ? <span className="muted"> · {String(x.actionTaken)}</span> : null}
              {x.parentNotified ? <span className="muted"> · parent notified</span> : null}
            </Line>
          ))}
        </Section>
      )}

      {(observations.milestones.length > 0 || observations.notes.length > 0) && (
        <Section title="Observations">
          {observations.milestones.map((m, i) => (
            <Line key={`ms${i}`} when={m.at}>
              ⭐ {m.kind ? <strong>{String(m.kind)}: </strong> : null}{m.note}
            </Line>
          ))}
          {observations.notes.map((n, i) => <Line key={`n${i}`} when={n.at}>{n.note}</Line>)}
        </Section>
      )}
    </div>
  );
}

export function Report({ sessionId }: { sessionId: string }) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.report(sessionId).then(setReport).catch((e) => setError(e.message));
  }, [sessionId]);

  if (error) return <div className="pad"><ErrorNote error={error} /></div>;
  if (!report) return <Spinner />;

  const share = async () => {
    const text = await api.reportText(sessionId);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Daily Childcare Report', text });
        return;
      } catch { /* cancelled — fall through to clipboard */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Report copied');
    } catch {
      setRaw(text);
      showToast('Select and copy the text below');
    }
  };

  return (
    <div className="app">
      <div className="appbar">
        <button className="btn ghost" onClick={() => navigate(`/session/${sessionId}`)} aria-label="Back">‹</button>
        <div className="grow">
          <div className="title">Daily report</div>
          <div className="subtitle">{fmtDate(report.session.startedAt)}</div>
        </div>
        <button className="btn sm" onClick={share}>Share</button>
      </div>

      <div className="content pad pad-bottom report">
        <div className="card">
          <h2>{report.session.familyName}</h2>
          <div className="muted">
            {fmtTime(report.session.startedAt)}
            {report.session.endedAt ? ` – ${fmtTime(report.session.endedAt)}` : ' – in progress'}
            {report.session.durationMinutes != null && ` · ${fmtDuration(report.session.durationMinutes)}`}
          </div>
          {report.session.sitterName && <div className="faint">Caregiver: {report.session.sitterName}</div>}
          {report.session.notes && (
            <p style={{ marginBottom: 0, marginTop: 10 }}>{report.session.notes}</p>
          )}
        </div>

        {report.children.map((entry) => <ChildSection key={entry.child.id} entry={entry} />)}

        {raw && (
          <div style={{ marginTop: 16 }}>
            <div className="section-title">Plain text</div>
            <pre className="report-text">{raw}</pre>
          </div>
        )}

        <button className="btn block" style={{ marginTop: 16 }}
          onClick={async () => setRaw(raw ? null : await api.reportText(sessionId))}>
          {raw ? 'Hide plain text' : 'Show as plain text'}
        </button>
      </div>

      {toast}
    </div>
  );
}
