import { useEffect, useMemo, useRef } from 'react';
import type { LogEvent, SessionChild } from '../lib/api';
import { typeDef } from '../lib/events';
import { fmtTime, fmtDuration, parse } from '../lib/time';

const HOUR_PX = 76;
const PX_PER_MIN = HOUR_PX / 60;
const MIN_BLOCK_PX = 26;
const POINT_PX = 26;

interface Placed {
  event: LogEvent;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  running: boolean;
  isPoint: boolean;
}

/**
 * Assigns overlapping events to side-by-side lanes. Events are grouped into
 * clusters of mutual overlap first, so a single long nap does not squeeze
 * unrelated entries later in the day.
 */
function place(events: LogEvent[], originMs: number, nowMs: number): Placed[] {
  const items = events
    .map((event) => {
      const def = typeDef(event.type);
      const startMs = parse(event.startAt).getTime();
      const running = def.duration && !event.endAt;
      const endMs = event.endAt ? parse(event.endAt).getTime() : running ? nowMs : startMs;
      const isPoint = !def.duration || (!event.endAt && !running);

      const top = ((startMs - originMs) / 60000) * PX_PER_MIN;
      const rawHeight = ((endMs - startMs) / 60000) * PX_PER_MIN;
      const height = isPoint ? POINT_PX : Math.max(MIN_BLOCK_PX, rawHeight);
      return { event, top, height, running, isPoint, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.top - b.top || a.height - b.height);

  // Cluster by pixel overlap, then lane within each cluster.
  let cluster: Placed[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    for (const it of cluster) {
      let lane = laneEnds.findIndex((end) => end <= it.top + 0.5);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = it.top + it.height;
      it.lane = lane;
    }
    for (const it of cluster) it.lanes = laneEnds.length;
    cluster = [];
  };

  for (const it of items) {
    if (it.top >= clusterEnd - 0.5) { flush(); clusterEnd = -Infinity; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.top + it.height);
  }
  flush();
  return items;
}

export function Timeline({ events, children, sessionStart, sessionEnd, now, onSelect }: {
  events: LogEvent[];
  children: SessionChild[];
  sessionStart: string;
  sessionEnd: string | null;
  now: Date;
  onSelect: (event: LogEvent) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);
  const nowMs = now.getTime();

  const { originMs, hours } = useMemo(() => {
    const starts = [parse(sessionStart).getTime(), ...events.map((e) => parse(e.startAt).getTime())];
    const ends = [
      sessionEnd ? parse(sessionEnd).getTime() : nowMs,
      ...events.map((e) => (e.endAt ? parse(e.endAt).getTime() : nowMs)),
    ];

    const origin = new Date(Math.min(...starts));
    origin.setMinutes(0, 0, 0);

    const last = new Date(Math.max(...ends));
    last.setMinutes(0, 0, 0);
    last.setHours(last.getHours() + 1);

    // Absolute times (not minutes-of-day) so an overnight session lays out
    // continuously across midnight instead of wrapping.
    const span = Math.max(4, Math.round((last.getTime() - origin.getTime()) / 3600_000));
    return { originMs: origin.getTime(), hours: span };
  }, [events, sessionStart, sessionEnd, nowMs]);

  const placed = useMemo(() => place(events, originMs, nowMs), [events, originMs, nowMs]);

  const nowTop = ((nowMs - originMs) / 60000) * PX_PER_MIN;
  const nowVisible = nowTop >= 0 && nowTop <= hours * HOUR_PX;

  // Land on the current time on first render rather than at the top of the day.
  useEffect(() => {
    if (didScroll.current || !scroller.current) return;
    didScroll.current = true;
    const target = Math.max(0, (nowVisible ? nowTop : 0) - 180);
    scroller.current.scrollTo({ top: target });
  }, [nowTop, nowVisible]);

  const childById = useMemo(
    () => new Map(children.map((c) => [c.id, c])), [children],
  );
  const showChild = children.length > 1;

  return (
    <div className="content" ref={scroller}>
      <div className="timeline">
        <div className="tl-hours" style={{ ['--hour-height' as string]: `${HOUR_PX}px` }}>
          {Array.from({ length: hours }, (_, i) => {
            const d = new Date(originMs + i * 3600_000);
            return (
              <div className="tl-hour" key={i}>
                <span className="tl-hour-label">
                  {d.toLocaleTimeString([], { hour: 'numeric' })}
                </span>
              </div>
            );
          })}

          <div className="tl-lane">
            {placed.map(({ event, top, height, lane, lanes, running, isPoint }) => {
              const def = typeDef(event.type);
              const child = childById.get(event.childId);
              const width = 100 / lanes;
              const summary = def.summary?.(event.detail) || '';
              const minutes = event.endAt
                ? Math.round((parse(event.endAt).getTime() - parse(event.startAt).getTime()) / 60000)
                : running ? Math.round((nowMs - parse(event.startAt).getTime()) / 60000) : null;

              const sub = [
                summary,
                event.note,
                minutes != null && !isPoint ? fmtDuration(minutes) : '',
              ].filter(Boolean).join(' · ');

              return (
                <button
                  key={event.id}
                  className={`tl-block${isPoint ? ' compact' : ''}${running ? ' running' : ''}`}
                  style={{
                    top, height,
                    left: `calc(${lane * width}% + ${lane ? 3 : 0}px)`,
                    width: `calc(${width}% - 4px)`,
                    ['--c' as string]: def.colour,
                  }}
                  onClick={() => onSelect(event)}
                >
                  <span className="t-title">
                    {showChild && child && (
                      <span className="child-dot" style={{ ['--cc' as string]: child.colour }} />
                    )}
                    {def.emoji} {def.label}
                    {showChild && child ? ` · ${child.name}` : ''}
                  </span>
                  {isPoint
                    ? <span className="t-sub">{fmtTime(event.startAt)}</span>
                    : sub && <span className="t-sub">{sub}</span>}
                  {!isPoint && height > 44 && (
                    <span className="t-sub">
                      {fmtTime(event.startAt)}{event.endAt ? ` – ${fmtTime(event.endAt)}` : ' – now'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {nowVisible && <div className="tl-now" style={{ top: nowTop }} />}
        </div>
        <div style={{ height: 110 }} />
      </div>
    </div>
  );
}
