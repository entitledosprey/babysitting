/** Timestamps carry the offset of the device that logged them, so the wall-clock
 *  reading survives a server in another timezone. */
export function toIso(date: Date): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

export const nowIso = () => toIso(new Date());

export const parse = (iso: string) => new Date(iso);

export const fmtTime = (iso: string) =>
  parse(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const fmtDate = (iso: string) =>
  parse(iso).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

export const fmtShortDate = (iso: string) =>
  parse(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** Minutes since local midnight — the timeline's vertical coordinate. */
export const minutesOfDay = (iso: string) => {
  const d = parse(iso);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};

export const durationMinutes = (startIso: string, endIso: string) =>
  Math.max(0, Math.round((parse(endIso).getTime() - parse(startIso).getTime()) / 60000));

export function fmtDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr`;
  return `${m} min`;
}

/** Compact form for the running-nap banner: 1:36:04 */
export function fmtStopwatch(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Rounds a Date to the nearest minute — entries are logged to the minute. */
export const toMinute = (d: Date) => {
  const c = new Date(d);
  c.setSeconds(0, 0);
  return c;
};

/** For <input type="datetime-local">, which wants local time with no offset. */
export function toLocalInput(iso: string): string {
  const d = parse(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (value: string) => toIso(new Date(value));

export const todayDate = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
