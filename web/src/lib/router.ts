import { useEffect, useState } from 'react';

const current = () => window.location.hash.replace(/^#/, '') || '/';

/** Hash routing: no dependency, and it survives being served from any path. */
export function useRoute(): string {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const navigate = (path: string) => { window.location.hash = path; };
export const back = () => window.history.back();

/** Matches '/session/:id' style patterns, returning the captured params. */
export function match(route: string, pattern: string): Record<string, string> | null {
  const r = route.split('/').filter(Boolean);
  const p = pattern.split('/').filter(Boolean);
  if (r.length !== p.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(r[i]);
    else if (p[i] !== r[i]) return null;
  }
  return params;
}
