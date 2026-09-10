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
 * Builds the end-of-shift report: one rollup per child on the shift, plus the
 * shift envelope. `children` comes from access.childrenOfShift().
 */
export function buildReport(shift, children, events, meta = {}) {
  return {
    shift: {
      id: shift.id,
      date: shift.date,
      startedAt: shift.started_at,
      endedAt: shift.ended_at,
      durationMinutes: shift.ended_at
        ? Math.round(ms(shift.started_at, shift.ended_at) / 60000) : null,
      notes: shift.notes,
      parentNotes: shift.parent_notes ?? '',
      sitterName: meta.sitterName ?? '',
      clientName: meta.clientName ?? '',
      businessName: meta.businessName ?? '',
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
  if (report.shift.clientName) line(report.shift.clientName);
  line(fmtDate(report.shift.startedAt));
  line(
    `${t(report.shift.startedAt)} – ${report.shift.endedAt ? t(report.shift.endedAt) : 'in progress'}` +
    (report.shift.durationMinutes != null ? `  (${formatDuration(report.shift.durationMinutes)})` : '')
  );
  if (report.shift.sitterName) line(`Caregiver: ${report.shift.sitterName}`);
  if (report.shift.businessName) line(report.shift.businessName);
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

  if (report.shift.notes) {
    line('NOTES FROM THE SHIFT');
    line(`  ${report.shift.notes}`);
    line();
  }

  return L.join('\n');
}

// --- HTML rendering (email) --------------------------------------------------
// Deliberately table-and-inline-style based: email clients strip <style> blocks
// and have no flexbox or grid worth relying on.

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const C = {
  text: '#12161c', dim: '#5c6673', faint: '#8b95a3',
  border: '#e0e4ea', bg: '#f6f7f9', card: '#ffffff', accent: '#4a7fe0',
};

const row = (when, what) => `
  <tr>
    <td style="padding:6px 10px 6px 0;color:${C.dim};font-size:13px;white-space:nowrap;vertical-align:top;width:78px">${esc(when)}</td>
    <td style="padding:6px 0;font-size:14px;color:${C.text};vertical-align:top">${what}</td>
  </tr>`;

const section = (title, inner) => `
  <div style="margin-top:22px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.faint};margin-bottom:6px">${esc(title)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${inner}</table>
  </div>`;

const statTiles = (stats) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:6px 0;margin:10px 0 2px">
    <tr>${stats.map(([v, k]) => `
      <td style="background:${C.bg};border:1px solid ${C.border};border-radius:8px;padding:10px 6px;text-align:center">
        <div style="font-size:18px;font-weight:700;color:${C.text}">${esc(v)}</div>
        <div style="font-size:11px;color:${C.dim};margin-top:2px">${esc(k)}</div>
      </td>`).join('')}
    </tr>
  </table>`;

const noteHtml = (e) => (e.note ? ` <span style="color:${C.dim}">“${esc(e.note)}”</span>` : '');

/** Full HTML report for the end-of-day email. */
export function renderReportHtml(report, { appUrl = '' } = {}) {
  const t = fmtTime;
  const children = report.children.map((entry) => {
    const { child, sleep, food, diapering, activities, health, observations } = entry;
    const empty = row('', `<span style="color:${C.dim}">Nothing recorded.</span>`);

    const sleepRows = sleep.naps.length
      ? sleep.naps.map((n) => row(t(n.at), [
          n.end ? `until ${esc(t(n.end))}` : 'still asleep',
          n.minutes != null ? `<strong>${esc(formatDuration(n.minutes))}</strong>` : '',
          n.fellAsleep ? `<span style="color:${C.dim}">fell asleep ${esc(n.fellAsleep)}</span>` : '',
          n.moodOnWaking ? `<span style="color:${C.dim}">woke ${esc(n.moodOnWaking)}</span>` : '',
        ].filter(Boolean).join(' · ') + noteHtml(n))).join('')
      : empty;

    const foodItems = [
      ...food.bottles.map((b) => ({ at: b.at, e: b, text: `Bottle${b.amountOz ? ` — ${esc(b.amountOz)} oz` : ''}${b.contents ? ` ${esc(b.contents)}` : ''}` })),
      ...food.feedings.map((f) => ({ at: f.at, e: f, text: `Meal${f.food ? ` — ${esc(f.food)}` : ''}${f.amountEaten ? ` <span style="color:${C.dim}">(ate ${esc(f.amountEaten)})</span>` : ''}` })),
      ...food.snacks.map((x) => ({ at: x.at, e: x, text: `Snack${x.food ? ` — ${esc(x.food)}` : ''}` })),
      ...food.waters.map((w) => ({ at: w.at, e: w, text: `Water${w.amountOz ? ` — ${esc(w.amountOz)} oz` : ''}` })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

    const diaperItems = [
      ...diapering.diapers.map((d) => ({ at: d.at, e: d, text: ([d.wet && 'wet', d.dirty && 'dirty'].filter(Boolean).join(' + ') || 'dry') + (d.rash ? ` <span style="color:${C.dim}">· rash noted</span>` : '') })),
      ...diapering.pottyTrips.map((x) => ({ at: x.at, e: x, text: `Potty — ${[x.pee && 'pee', x.poop && 'poop'].filter(Boolean).join(' + ') || 'tried'}${x.accident ? ' <span style="color:#b91c1c">· accident</span>' : ''}` })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

    const activityItems = [
      ...activities.items.map((a) => ({ at: a.at, e: a, text: `${esc(a.kind ?? 'Activity')}${a.minutes ? ` <span style="color:${C.dim}">· ${esc(formatDuration(a.minutes))}</span>` : ''}` })),
      ...activities.baths.map((b) => ({ at: b.at, e: b, text: 'Bath' })),
      ...activities.quiet.map((q) => ({ at: q.at, e: q, text: `Quiet time${q.minutes ? ` <span style="color:${C.dim}">· ${esc(formatDuration(q.minutes))}</span>` : ''}` })),
      ...activities.screenTime.map((x) => ({ at: x.at, e: x, text: `Screen time${x.minutes ? ` <span style="color:${C.dim}">· ${esc(formatDuration(x.minutes))}</span>` : ''}` })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

    const healthRows = [
      ...health.medications.map((m) => row(t(m.at), `💊 ${esc(m.name ?? 'Medication')}${m.dose ? ` — ${esc(m.dose)}` : ''}${noteHtml(m)}`)),
      ...health.incidents.map((x) => row(t(x.at), `🚨 <strong style="color:#b91c1c">Incident${x.severity ? ` (${esc(x.severity)})` : ''}</strong>${x.note ? ` — ${esc(x.note)}` : ''}${x.actionTaken ? `<br><span style="color:${C.dim}">Action taken: ${esc(x.actionTaken)}</span>` : ''}${x.parentNotified ? `<br><span style="color:${C.dim}">You were notified at the time.</span>` : ''}`)),
    ].join('');

    const obsRows = [
      ...observations.milestones.map((m) => row(t(m.at), `⭐ ${m.kind ? `<strong>${esc(m.kind)}:</strong> ` : ''}${esc(m.note)}`)),
      ...observations.notes.map((n) => row(t(n.at), esc(n.note))),
    ].join('');

    return `
    <div style="background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:18px;margin-top:14px">
      <h2 style="margin:0;font-size:19px;color:${C.text}">
        <span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${esc(child.colour || C.accent)}"></span>
        ${esc(child.name)}
      </h2>

      ${statTiles([
        [String(sleep.napCount), sleep.napCount === 1 ? 'nap' : 'naps'],
        [formatDuration(sleep.totalMinutes) || '—', 'total sleep'],
        [String(food.bottleCount + food.mealCount + food.snackCount), 'food items'],
        [String(diapering.total + diapering.pottyCount), 'changes'],
      ])}

      ${section('Sleep', sleepRows)}
      ${section('Food & drink', foodItems.length ? foodItems.map((i) => row(t(i.at), i.text + noteHtml(i.e))).join('') : empty)}
      ${section('Diapers & potty', diaperItems.length ? diaperItems.map((i) => row(t(i.at), i.text + noteHtml(i.e))).join('') : empty)}
      ${section('Activities', activityItems.length ? activityItems.map((i) => row(t(i.at), i.text + noteHtml(i.e))).join('') : empty)}
      ${healthRows ? section('Health', healthRows) : ''}
      ${obsRows ? section('Observations', obsRows) : ''}
    </div>`;
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Daily Childcare Report</title></head>
<body style="margin:0;padding:20px 12px;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.text}">
  <div style="max-width:620px;margin:0 auto">
    <div style="background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:18px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${C.accent}">Daily Childcare Report</div>
      <h1 style="margin:6px 0 2px;font-size:22px">${esc(report.shift.clientName)}</h1>
      <div style="color:${C.dim};font-size:14px">${esc(fmtDate(report.shift.startedAt))}</div>
      <div style="color:${C.dim};font-size:14px;margin-top:4px">
        ${esc(t(report.shift.startedAt))}${report.shift.endedAt ? ` – ${esc(t(report.shift.endedAt))}` : ''}
        ${report.shift.durationMinutes != null ? ` · ${esc(formatDuration(report.shift.durationMinutes))}` : ''}
      </div>
      ${report.shift.sitterName ? `<div style="color:${C.faint};font-size:13px;margin-top:4px">Caregiver: ${esc(report.shift.sitterName)}</div>` : ''}
      ${report.shift.notes ? `<p style="margin:12px 0 0;font-size:14px;padding:10px;background:${C.bg};border-radius:8px">${esc(report.shift.notes)}</p>` : ''}
    </div>

    ${children}

    ${appUrl ? `<p style="text-align:center;margin:20px 0 0">
      <a href="${esc(appUrl)}" style="color:${C.accent};font-size:13px;text-decoration:none">Open the full log →</a>
    </p>` : ''}
    <p style="text-align:center;color:${C.faint};font-size:11px;margin-top:14px">
      ${report.shift.businessName ? `${esc(report.shift.businessName)} · ` : ''}sent automatically when the shift was closed out.
    </p>
  </div>
</body></html>`;
}
