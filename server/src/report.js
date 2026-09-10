import { EVENT_TYPES } from './types.js';

const ms = (a, b) => new Date(b).getTime() - new Date(a).getTime();

export function durationMinutes(ev) {
  if (!ev.end_at) return null;
  return Math.max(0, Math.round(ms(ev.start_at, ev.end_at) / 60000));
}

export function formatDuration(min) {
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr`;
  return `${m} min`;
}

const detailOf = (ev) => {
  try { return JSON.parse(ev.detail || '{}'); } catch { return {}; }
};

const base = (e) => ({ id: e.id, at: e.start_at, end: e.end_at, minutes: durationMinutes(e), note: e.note });
const withDetail = (e) => ({ ...base(e), ...detailOf(e) });

/** Per-child rollup: the section shape the report screen and the text export share. */
function summarise(events) {
  const byType = (t) => events.filter((e) => e.type === t);

  const naps = byType('nap').map(withDetail);
  const completedNaps = naps.filter((n) => n.minutes != null);

  const bottles = byType('bottle').map(withDetail);
  const feedings = byType('feeding').map(withDetail);
  const snacks = byType('snack').map(withDetail);
  const waters = byType('water').map(withDetail);

  const diapers = byType('diaper').map(withDetail);
  const pottyTrips = byType('potty').map(withDetail);

  const activities = byType('activity').map(withDetail);
  const screenTime = byType('screen_time').map(withDetail);
  const quiet = byType('quiet_time').map(withDetail);
  const baths = byType('bath').map(withDetail);

  const sum = (list, pick) => list.reduce((s, x) => s + (Number(pick(x)) || 0), 0);

  return {
    sleep: {
      napCount: completedNaps.length,
      inProgress: naps.length - completedNaps.length,
      totalMinutes: sum(completedNaps, (n) => n.minutes),
      longestMinutes: completedNaps.length ? Math.max(...completedNaps.map((n) => n.minutes)) : 0,
      naps,
    },
    food: {
      bottleCount: bottles.length,
      totalOz: sum(bottles, (b) => b.amountOz),
      bottles,
      mealCount: feedings.length,
      feedings,
      snackCount: snacks.length,
      snacks,
      waterCount: waters.length,
      totalWaterOz: sum(waters, (w) => w.amountOz),
      waters,
    },
    diapering: {
      total: diapers.length,
      wet: diapers.filter((d) => d.wet).length,
      dirty: diapers.filter((d) => d.dirty).length,
      diapers,
      pottyCount: pottyTrips.length,
      pottyAccidents: pottyTrips.filter((p) => p.accident).length,
      pottyTrips,
    },
    activities: {
      totalMinutes: sum(activities, (a) => a.minutes),
      items: activities,
      screenMinutes: sum(screenTime, (a) => a.minutes),
      screenTime,
      quiet,
      baths,
    },
    health: {
      medications: byType('medication').map(withDetail),
      incidents: byType('incident').map(withDetail),
    },
    observations: {
      milestones: byType('milestone').map(withDetail),
      notes: byType('note').map(base),
      photos: byType('photo').map(base),
    },
    timeline: [...events]
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
      .map((e) => ({
        id: e.id,
        type: e.type,
        label: EVENT_TYPES[e.type]?.label ?? e.type,
        emoji: EVENT_TYPES[e.type]?.emoji ?? '•',
        start: e.start_at,
        end: e.end_at,
        minutes: durationMinutes(e),
        note: e.note,
        detail: detailOf(e),
      })),
  };
}

/**
 * Builds the end-of-day report: one rollup per child in the session, plus the
 * session envelope. `children` comes from access.childrenOf().
 */
export function buildReport(session, children, events, meta = {}) {
  return {
    session: {
      id: session.id,
      date: session.date,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      durationMinutes: session.ended_at
        ? Math.round(ms(session.started_at, session.ended_at) / 60000) : null,
      notes: session.notes,
      sitterName: meta.sitterName ?? '',
      familyName: meta.familyName ?? '',
    },
    children: children.map((child) => ({
      child,
      ...summarise(events.filter((e) => e.child_id === child.id)),
    })),
    generatedAt: new Date().toISOString(),
  };
}

// --- Plain-text rendering ----------------------------------------------------
// Produces something a sitter can paste straight into a text message.

/**
 * Timestamps are stored with the offset of the device that logged them, so the
 * wall-clock reading is recoverable without knowing a timezone name. Shifting
 * by that offset and formatting in UTC reproduces exactly what the sitter saw.
 */
function wallClock(iso) {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  const d = new Date(iso);
  if (!m) return d; // 'Z' or offset-less: treat as UTC
  const offsetMin = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  return new Date(d.getTime() + offsetMin * 60_000);
}

const fmtTime = (iso) => wallClock(iso).toLocaleTimeString('en-US', {
  hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
});

const fmtDate = (iso) => wallClock(iso).toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

export function renderReportText(report) {
  const L = [];
  const t = fmtTime;
  const line = (s = '') => L.push(s);

  line('DAILY CHILDCARE REPORT');
  if (report.session.familyName) line(report.session.familyName);
  line(fmtDate(report.session.startedAt));
  line(
    `${t(report.session.startedAt)} – ${report.session.endedAt ? t(report.session.endedAt) : 'in progress'}` +
    (report.session.durationMinutes != null ? `  (${formatDuration(report.session.durationMinutes)})` : '')
  );
  if (report.session.sitterName) line(`Caregiver: ${report.session.sitterName}`);
  line();

  for (const entry of report.children) {
    const { child, sleep, food, diapering, activities, health, observations } = entry;
    line('='.repeat(44));
    line(child.name.toUpperCase());
    line('='.repeat(44));

    line();
    line('SLEEP');
    if (sleep.naps.length === 0) {
      line('  No naps recorded.');
    } else {
      for (const n of sleep.naps) {
        const span = n.end ? `${t(n.at)} – ${t(n.end)}` : `${t(n.at)} – still asleep`;
        line(`  ${span}${n.minutes != null ? `   ${formatDuration(n.minutes)}` : ''}`);
        const bits = [];
        if (n.fellAsleep) bits.push(`fell asleep ${n.fellAsleep}`);
        if (n.difficultToSettle) bits.push('difficult to settle');
        if (n.wokeBriefly) bits.push('woke briefly');
        if (n.moodOnWaking) bits.push(`woke ${n.moodOnWaking}`);
        if (bits.length) line(`      ${bits.join(', ')}`);
        if (n.note) line(`      "${n.note}"`);
      }
      line(
        `  Naps: ${sleep.napCount}   Total daytime sleep: ${formatDuration(sleep.totalMinutes)}` +
        (sleep.inProgress ? `   (${sleep.inProgress} still in progress)` : '')
      );
    }

    line();
    line('FOOD & DRINK');
    const foodLines = [
      ...food.bottles.map((b) => ({ at: b.at, text: `Bottle${b.amountOz ? ` — ${b.amountOz} oz` : ''}${b.contents ? ` ${b.contents}` : ''}${b.finished === false ? ' (not finished)' : ''}` })),
      ...food.feedings.map((f) => ({ at: f.at, text: `Meal${f.food ? ` — ${f.food}` : ''}${f.amountEaten ? ` (ate ${f.amountEaten})` : ''}` })),
      ...food.snacks.map((x) => ({ at: x.at, text: `Snack${x.food ? ` — ${x.food}` : ''}` })),
      ...food.waters.map((w) => ({ at: w.at, text: `Water${w.amountOz ? ` — ${w.amountOz} oz` : ''}` })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

    if (foodLines.length === 0) {
      line('  Nothing recorded.');
    } else {
      for (const f of foodLines) line(`  ${t(f.at)}  ${f.text}`);
      const totals = [
        food.bottleCount ? `Bottles: ${food.bottleCount}${food.totalOz ? ` (${food.totalOz} oz)` : ''}` : '',
        food.mealCount ? `Meals: ${food.mealCount}` : '',
        food.snackCount ? `Snacks: ${food.snackCount}` : '',
        food.totalWaterOz ? `Water: ${food.totalWaterOz} oz` : '',
      ].filter(Boolean);
      if (totals.length) line(`  ${totals.join('   ')}`);
    }

    line();
    line('DIAPERS & POTTY');
    if (diapering.total) {
      line(`  Diapers: ${diapering.total} total — ${diapering.wet} wet, ${diapering.dirty} dirty`);
      for (const d of diapering.diapers) {
        const kind = [d.wet && 'wet', d.dirty && 'dirty'].filter(Boolean).join(' + ') || 'dry';
        line(`  ${t(d.at)}  ${kind}${d.rash ? ' — rash noted' : ''}${d.note ? ` "${d.note}"` : ''}`);
      }
    }
    if (diapering.pottyCount) {
      line(`  Potty trips: ${diapering.pottyCount}${diapering.pottyAccidents ? ` (${diapering.pottyAccidents} accident${diapering.pottyAccidents === 1 ? '' : 's'})` : ''}`);
      for (const p of diapering.pottyTrips) {
        const kind = [p.pee && 'pee', p.poop && 'poop'].filter(Boolean).join(' + ') || 'tried';
        line(`  ${t(p.at)}  ${kind}${p.accident ? ' — accident' : ''}`);
      }
    }
    if (!diapering.total && !diapering.pottyCount) line('  Nothing recorded.');

    line();
    line('ACTIVITIES');
    if (activities.items.length) {
      for (const a of activities.items) {
        line(`  ${t(a.at)}  ${a.kind ?? 'Activity'}${a.minutes ? ` — ${formatDuration(a.minutes)}` : ''}${a.note ? ` "${a.note}"` : ''}`);
      }
      line(`  Total activity time: ${formatDuration(activities.totalMinutes)}`);
    } else {
      line('  Nothing recorded.');
    }
    for (const b of activities.baths) line(`  ${t(b.at)}  Bath${b.minutes ? ` — ${formatDuration(b.minutes)}` : ''}`);
    for (const q of activities.quiet) line(`  ${t(q.at)}  Quiet time${q.minutes ? ` — ${formatDuration(q.minutes)}` : ''}`);
    if (activities.screenMinutes) line(`  Screen time: ${formatDuration(activities.screenMinutes)}`);

    if (health.medications.length || health.incidents.length) {
      line();
      line('HEALTH');
      for (const m of health.medications) {
        line(`  ${t(m.at)}  ${m.name ?? 'Medication'}${m.dose ? ` — ${m.dose}` : ''}${m.note ? ` "${m.note}"` : ''}`);
      }
      for (const i of health.incidents) {
        line(`  ${t(i.at)}  INCIDENT${i.severity ? ` (${i.severity})` : ''}: ${i.note || 'see notes'}`);
        if (i.actionTaken) line(`      Action taken: ${i.actionTaken}`);
        if (i.parentNotified) line('      Parent notified at the time.');
      }
    }

    if (observations.milestones.length || observations.notes.length) {
      line();
      line('OBSERVATIONS');
      for (const m of observations.milestones) {
        line(`  ${t(m.at)}  ⭐ ${m.kind ? `${m.kind}: ` : ''}${m.note}`);
      }
      for (const n of observations.notes) line(`  ${t(n.at)}  ${n.note}`);
    }
    line();
  }

  if (report.session.notes) {
    line('SESSION NOTES');
    line(`  ${report.session.notes}`);
    line();
  }

  return L.join('\n');
}
