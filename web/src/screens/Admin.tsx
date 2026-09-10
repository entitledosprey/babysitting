import { useCallback, useEffect, useState } from 'react';
import { admin } from '../lib/api';
import type {
  AdminBusiness, AdminBusinessDetail, AdminShift, AdminUser, EmailLogEntry,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../lib/router';
import { Sheet, Spinner, ErrorNote, Field, useToast } from '../components/ui';
import { fmtShortDate, fmtTime } from '../lib/time';
import { fmtMoney } from '../lib/money';

type Tab = 'overview' | 'users' | 'businesses' | 'shifts' | 'email' | 'maintenance';

const TABS: [Tab, string][] = [
  ['overview', 'Overview'], ['users', 'Users'], ['businesses', 'Businesses'],
  ['shifts', 'Shifts'], ['email', 'Email'], ['maintenance', 'Maintenance'],
];

const bytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
};

const duration = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

const when = (iso: string | null) => (iso ? `${fmtShortDate(iso)} ${fmtTime(iso)}` : '—');

const Stat = ({ v, k }: { v: string | number; k: string }) => (
  <div className="stat"><div className="v">{v}</div><div className="k">{k}</div></div>
);

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(() => {
    setError(null);
    fn().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, reload: run };
}

export function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [toast, showToast] = useToast();

  if (!user?.isAdmin) {
    return (
      <div className="app">
        <div className="content pad">
          <div className="empty"><span className="big">🔒</span>Not available.</div>
          <button className="btn block" onClick={() => navigate('/')}>Back to the app</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="appbar">
        <button className="btn ghost" onClick={() => navigate('/')} aria-label="Back">‹</button>
        <div className="grow">
          <div className="title">Administration</div>
          <div className="subtitle">Signed in as {user.email}</div>
        </div>
      </div>

      <div style={{ padding: '10px 14px 0' }}>
        <div className="seg">
          {TABS.map(([key, label]) => (
            <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="content pad pad-bottom">
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <Users showToast={showToast} />}
        {tab === 'businesses' && <Businesses showToast={showToast} />}
        {tab === 'shifts' && <Shifts showToast={showToast} />}
        {tab === 'email' && <EmailTab showToast={showToast} />}
        {tab === 'maintenance' && <Maintenance showToast={showToast} />}
      </div>

      {toast}
    </div>
  );
}

function Overview() {
  const { data, error } = useAsync(() => admin.overview());
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  const c = data.counts;

  return (
    <div className="stack">
      <div className="section-title">Platform</div>
      <div className="stat-row">
        <Stat v={c.businesses} k="businesses" />
        <Stat v={c.clients} k="clients" />
        <Stat v={c.children} k="children" />
        <Stat v={c.users} k="users" />
        <Stat v={c.parents} k="parent logins" />
      </div>
      <div className="stat-row">
        <Stat v={c.shifts} k="shifts" />
        <Stat v={c.active} k="on shift now" />
        <Stat v={c.upcoming} k="booked" />
        <Stat v={c.events} k="entries" />
        <Stat v={c.invoices} k="invoices" />
      </div>
      <div className="stat-row">
        <Stat v={c.logins} k="active logins" />
        <Stat v={c.invites} k="live invites" />
        <Stat v={c.disabled} k="disabled" />
      </div>

      <div className="section-title" style={{ marginTop: 10 }}>Storage and runtime</div>
      <div className="card stack tight">
        <div className="row"><span className="muted">Database</span><span className="spacer" /><strong>{bytes(data.storage.dbBytes)}</strong></div>
        <div className="row"><span className="muted">Write-ahead log</span><span className="spacer" /><strong>{bytes(data.storage.walBytes)}</strong></div>
        <div className="row"><span className="muted">Uptime</span><span className="spacer" /><strong>{duration(data.runtime.uptimeSeconds)}</strong></div>
        <div className="row"><span className="muted">Memory</span><span className="spacer" /><strong>{bytes(data.runtime.rssBytes)}</strong></div>
        <div className="row"><span className="muted">Node</span><span className="spacer" /><strong>{data.runtime.node}</strong></div>
      </div>

      <div className="section-title" style={{ marginTop: 10 }}>Email</div>
      <div className="card stack tight">
        <div className="row">
          <span className="muted">Status</span><span className="spacer" />
          <span className="badge" style={data.mail.configured ? { background: 'var(--ok)', color: '#fff' } : undefined}>
            {data.mail.configured ? 'configured' : 'not configured'}
          </span>
        </div>
        {data.mail.configured && (
          <>
            <div className="row"><span className="muted">Server</span><span className="spacer" /><strong>{data.mail.host}:{data.mail.port}</strong></div>
            <div className="row"><span className="muted">TLS</span><span className="spacer" /><strong>{data.mail.secure ? 'on connect' : 'STARTTLS'}</strong></div>
            <div className="row"><span className="muted">From</span><span className="spacer" /><strong>{data.mail.from}</strong></div>
          </>
        )}
        <div className="row"><span className="muted">Administrators</span><span className="spacer" /><strong>{data.mail.adminCount}</strong></div>
      </div>

      {data.mail.warnings?.length > 0 && data.mail.warnings.map((w, i) => (
        <div key={i} className="error" style={{ fontSize: '.84rem' }}>{w}</div>
      ))}

      {data.mail.recentFailures.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 10 }}>Recent delivery failures</div>
          {data.mail.recentFailures.map((f, i) => (
            <div key={i} className="card stack tight">
              <strong>{f.to_email}</strong>
              <span className="faint">{f.subject}</span>
              <span className="error" style={{ fontSize: '.8rem' }}>{f.error}</span>
            </div>
          ))}
        </>
      )}

      {data.activity.last7Days.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 10 }}>Shifts, last 7 days</div>
          <div className="card stack tight">
            {data.activity.last7Days.map((d) => (
              <div key={d.date} className="row">
                <span className="muted">{d.date}</span><span className="spacer" /><strong>{d.shifts}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Users({ showToast }: { showToast: (m: string) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, reload } = useAsync(() => admin.users(query), [query]);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const role = (u: AdminUser) =>
    u.business ? `Sitter · ${u.business.name}`
      : u.parentOf.length ? `Parent · ${u.parentOf.map((p) => p.name).join(', ')}`
      : 'No business or family';

  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
        <input className="input" value={q} placeholder="Search name or email"
          onChange={(e) => setQ(e.target.value)} />
        <button className="btn" type="submit">Search</button>
      </form>

      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.length === 0 ? (
        <div className="empty"><span className="big">🔍</span>No users match.</div>
      ) : data.map((u) => (
        <button key={u.id} className="card tap stack tight" onClick={() => setEditing(u)}>
          <div className="row">
            <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</strong>
            {u.disabled && <span className="pill" style={{ background: 'var(--danger)', color: '#fff' }}>disabled</span>}
          </div>
          <span className="faint">{u.email}</span>
          <span className="faint">{role(u)}</span>
          <span className="faint">Last seen {when(u.lastSeenAt)}</span>
        </button>
      ))}

      {editing && (
        <UserSheet user={editing} onClose={() => setEditing(null)}
          onDone={(msg) => { setEditing(null); showToast(msg); reload(); }} />
      )}
    </div>
  );
}

function UserSheet({ user, onClose, onDone }: {
  user: AdminUser; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
      setBusy(false);
    }
  };

  return (
    <Sheet title={user.name} onClose={onClose}>
      <div className="stack">
        <div className="card stack tight">
          <div className="row"><span className="muted">Email</span><span className="spacer" /><strong>{user.email}</strong></div>
          <div className="row"><span className="muted">Created</span><span className="spacer" /><strong>{when(user.createdAt)}</strong></div>
          <div className="row"><span className="muted">Last seen</span><span className="spacer" /><strong>{when(user.lastSeenAt)}</strong></div>
          {user.business && (
            <div className="row"><span className="muted">Business</span><span className="spacer" /><strong>{user.business.name}</strong></div>
          )}
          {user.parentOf.map((p) => (
            <div key={p.id} className="row"><span className="muted">Parent of</span><span className="spacer" /><strong>{p.name}</strong></div>
          ))}
        </div>

        <Field label="Set a new password">
          <div className="row">
            <input className="input" type="text" value={password} placeholder="At least 8 characters"
              onChange={(e) => setPassword(e.target.value)} />
            <button className="btn" disabled={busy || password.length < 8}
              onClick={() => guard(async () => {
                await admin.resetPassword(user.id, password);
                onDone('Password reset — their other sessions were signed out');
              })}>Set</button>
          </div>
        </Field>

        <ErrorNote error={error} />

        <button className="btn block" disabled={busy} onClick={() => guard(async () => {
          await admin.updateUser(user.id, { disabled: !user.disabled });
          onDone(user.disabled ? 'Account re-enabled' : 'Account disabled and signed out');
        })}>
          {user.disabled ? 'Re-enable this account' : 'Disable this account'}
        </button>

        <button className="btn danger block" disabled={busy} onClick={() => guard(async () => {
          if (!window.confirm(`Permanently delete ${user.email}?`)) { setBusy(false); return; }
          try {
            await admin.deleteUser(user.id);
          } catch (e) {
            // The API refuses when the user owns a business; confirm that
            // specific consequence before forcing.
            const msg = e instanceof Error ? e.message : '';
            if (/owns/i.test(msg) && window.confirm(`${msg}\n\nDelete anyway?`)) {
              await admin.deleteUser(user.id, true);
            } else {
              throw e;
            }
          }
          onDone('User deleted');
        })}>
          Delete this user
        </button>
      </div>
    </Sheet>
  );
}

function Businesses({ showToast }: { showToast: (m: string) => void }) {
  const { data, error, reload } = useAsync(() => admin.businesses());
  const [open, setOpen] = useState<AdminBusiness | null>(null);

  return (
    <div className="stack">
      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.length === 0 ? (
        <div className="empty"><span className="big">🏠</span>No businesses yet.</div>
      ) : data.map((b) => (
        <button key={b.id} className="card tap stack tight" onClick={() => setOpen(b)}>
          <strong>{b.name}</strong>
          <span className="faint">{b.ownerName} · {b.ownerEmail}</span>
          <span className="faint">
            {b.clients} client{b.clients === 1 ? '' : 's'} · {b.shifts} shift{b.shifts === 1 ? '' : 's'} ·
            {' '}{fmtMoney(b.defaultRateCents, b.currency)}/hr default
          </span>
        </button>
      ))}
      {open && (
        <BusinessSheet business={open} onClose={() => setOpen(null)}
          onDone={(m) => { setOpen(null); showToast(m); reload(); }} />
      )}
    </div>
  );
}

function BusinessSheet({ business, onClose, onDone }: {
  business: AdminBusiness; onClose: () => void; onDone: (m: string) => void;
}) {
  const [detail, setDetail] = useState<AdminBusinessDetail | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    admin.business(business.id).then(setDetail).catch((e) => setError(e.message));
  }, [business.id]);

  return (
    <Sheet title={business.name} onClose={onClose}>
      <ErrorNote error={error} />
      {!detail ? <Spinner /> : (
        <div className="stack">
          <div className="card stack tight">
            <div className="row"><span className="muted">Owner</span><span className="spacer" /><strong>{detail.owner.name}</strong></div>
            <div className="row"><span className="muted">Email</span><span className="spacer" /><strong>{detail.owner.email}</strong></div>
            <div className="row"><span className="muted">Created</span><span className="spacer" /><strong>{when(detail.createdAt)}</strong></div>
          </div>

          <div className="section-title">Clients</div>
          {detail.clients.length === 0 ? <div className="muted">None.</div> : detail.clients.map((c) => (
            <div key={c.id} className="card stack tight">
              <div className="row">
                <strong style={{ flex: 1 }}>{c.name}</strong>
                {!!c.archived && <span className="pill">archived</span>}
              </div>
              <span className="faint">
                {c.children} child{c.children === 1 ? '' : 'ren'} · {c.shifts} shift{c.shifts === 1 ? '' : 's'} ·
                {' '}{c.parents} parent login{c.parents === 1 ? '' : 's'}
              </span>
            </div>
          ))}

          <div className="section-title" style={{ marginTop: 10 }}>Danger zone</div>
          <Field label={`Type "${business.name}" to delete this business and everything in it`}>
            <input className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          </Field>
          <button className="btn danger block" disabled={confirmName !== business.name}
            onClick={async () => {
              try {
                await admin.deleteBusiness(business.id, confirmName);
                onDone('Business deleted');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Delete failed');
              }
            }}>Delete this business</button>
        </div>
      )}
    </Sheet>
  );
}

function Shifts({ showToast }: { showToast: (m: string) => void }) {
  const { data, error, reload } = useAsync(() => admin.shifts());
  const [busy, setBusy] = useState<string | null>(null);

  const resend = async (s: AdminShift) => {
    setBusy(s.id);
    try {
      const r = await admin.resendReport(s.id);
      showToast(r.sent > 0
        ? `Sent to ${r.sent} recipient${r.sent === 1 ? '' : 's'}`
        : r.noRecipients ? 'That client has no contacts set to receive reports'
        : r.configured === false ? 'SMTP is not configured'
        : 'Nothing was sent — check the email log');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Resend failed');
    }
    setBusy(null);
  };

  return (
    <div className="stack">
      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.map((s) => (
        <div key={s.id} className="card stack tight">
          <div className="row">
            <strong style={{ flex: 1 }}>{s.clientName}</strong>
            <span className={`pill ${s.status === 'in_progress' ? 'live' : s.status === 'completed' ? 'done' : s.status === 'cancelled' ? 'cancelled' : 'scheduled'}`}>
              {s.status.replace('_', ' ')}
            </span>
          </div>
          <span className="faint">{s.businessName} · {s.sitterName}</span>
          <span className="faint">
            {s.date}
            {s.startedAt ? ` · ${fmtTime(s.startedAt)}` : ''}
            {s.endedAt ? `–${fmtTime(s.endedAt)}` : ''} · {s.events} entries
          </span>
          {s.startedAt && (
            <div className="row">
              <span className="faint">Report: {s.reportSentAt ? `sent ${when(s.reportSentAt)}` : 'not sent'}</span>
              <span className="spacer" />
              <button className="btn sm" disabled={busy === s.id} onClick={() => resend(s)}>
                {busy === s.id ? 'Sending…' : 'Resend'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EmailTab({ showToast }: { showToast: (m: string) => void }) {
  const [filter, setFilter] = useState('');
  const { data, error, reload } = useAsync(() => admin.emailLog(filter), [filter]);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  const badgeStyle = (s: EmailLogEntry['status']) =>
    s === 'sent' ? { background: 'var(--ok)', color: '#fff' }
      : s === 'failed' ? { background: 'var(--danger)', color: '#fff' } : undefined;

  return (
    <div className="stack">
      <div className="card stack tight">
        <div className="row">
          <button className="btn sm" disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await admin.verifyMail();
            showToast(r.ok ? 'SMTP connection is good' : `Verify failed: ${r.error}`);
            setBusy(false);
          }}>Verify connection</button>
        </div>
        <Field label="Send a test message">
          <div className="row">
            <input className="input" type="email" value={to} placeholder="you@example.com"
              onChange={(e) => setTo(e.target.value)} />
            <button className="btn" disabled={busy || !to} onClick={async () => {
              setBusy(true);
              const r = await admin.testMail(to);
              showToast(r.ok ? 'Test message sent' : `Failed: ${r.error ?? 'not configured'}`);
              setBusy(false);
              reload();
            }}>Send</button>
          </div>
        </Field>
      </div>

      <div className="seg">
        {[['', 'All'], ['sent', 'Sent'], ['failed', 'Failed'], ['skipped', 'Skipped']].map(([v, l]) => (
          <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>

      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.length === 0 ? (
        <div className="empty"><span className="big">📭</span>Nothing logged yet.</div>
      ) : data.map((e) => (
        <div key={e.id} className="card stack tight">
          <div className="row">
            <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.to}</strong>
            <span className="badge" style={badgeStyle(e.status)}>{e.status}</span>
          </div>
          <span className="faint">{e.subject}</span>
          <span className="faint">{when(e.createdAt)}{e.invoiceId ? ' · invoice' : e.shiftId ? ' · shift report' : ''}</span>
          {e.error && <span className="error" style={{ fontSize: '.8rem' }}>{e.error}</span>}
        </div>
      ))}
    </div>
  );
}

function Maintenance({ showToast }: { showToast: (m: string) => void }) {
  const [busy, setBusy] = useState(false);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    try { showToast(await fn()); } catch (e) {
      showToast(e instanceof Error ? e.message : `${label} failed`);
    }
    setBusy(false);
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <strong>Back up the database</strong>
          <div className="muted">Writes a consistent snapshot beside the live file without blocking writers.</div>
        </div>
        <button className="btn" disabled={busy} onClick={() => run('Backup', async () => {
          const r = await admin.backup();
          return `Backup written (${bytes(r.bytes)})`;
        })}>Create backup</button>
      </div>

      <div className="card stack">
        <div>
          <strong>Compact the database</strong>
          <div className="muted">Reclaims space left by deleted rows.</div>
        </div>
        <button className="btn" disabled={busy} onClick={() => run('Vacuum', async () => {
          const r = await admin.vacuum();
          const saved = r.beforeBytes - r.afterBytes;
          return saved > 0 ? `Reclaimed ${bytes(saved)}` : 'Already compact';
        })}>Vacuum now</button>
      </div>

      <div className="card stack">
        <div>
          <strong>Prune expired records</strong>
          <div className="muted">Removes expired logins and invites, and email logs older than 90 days.</div>
        </div>
        <button className="btn" disabled={busy} onClick={() => run('Prune', async () => {
          const r = await admin.prune();
          return `Removed ${r.expiredLogins} logins, ${r.expiredInvites} invites, ${r.oldEmailLogs} email logs`;
        })}>Prune now</button>
      </div>
    </div>
  );
}
