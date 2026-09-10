import type { LogEvent, SessionChild } from '../lib/api';
import { typeDef } from '../lib/events';
import { fmtStopwatch, fmtTime, parse } from '../lib/time';

/**
 * Sticky controls for anything currently running. A nap is the common case, so
 * "Wake Up" is a single tap — details can be added afterwards by tapping the
 * block, rather than blocking the sitter with a form while holding a child.
 */
export function RunningBanner({ running, children, now, onStop }: {
  running: LogEvent[];
  children: SessionChild[];
  now: Date;
  onStop: (event: LogEvent) => void;
}) {
  if (running.length === 0) return null;
  const byId = new Map(children.map((c) => [c.id, c]));

  return (
    <>
      {running.map((event) => {
        const def = typeDef(event.type);
        const child = byId.get(event.childId);
        const seconds = Math.max(0, (now.getTime() - parse(event.startAt).getTime()) / 1000);
        return (
          <div className="banner" key={event.id} style={{ ['--c' as string]: def.colour }}>
            <span className="emoji">{def.emoji}</span>
            <div className="grow" style={{ flex: 1, minWidth: 0 }}>
              <div className="who">
                {def.label}{children.length > 1 && child ? ` · ${child.name}` : ''}
              </div>
              <div className="elapsed">
                since {fmtTime(event.startAt)} · {fmtStopwatch(seconds)}
              </div>
            </div>
            <button className="btn primary" onClick={() => onStop(event)}>
              {event.type === 'nap' ? 'Wake up' : 'Stop'}
            </button>
          </div>
        );
      })}
    </>
  );
}
