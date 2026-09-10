import { navigate } from '../lib/router';

const TABS = [
  { path: '/', icon: '📅', label: 'Today' },
  { path: '/clients', icon: '👨‍👩‍👧', label: 'Clients' },
  { path: '/invoices', icon: '💵', label: 'Invoices' },
  { path: '/settings', icon: '⚙️', label: 'Settings' },
] as const;

export function TabBar({ current }: { current: string }) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button
          key={t.path}
          aria-current={current === t.path ? 'page' : undefined}
          onClick={() => navigate(t.path)}
        >
          <span className="ic" aria-hidden="true">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
