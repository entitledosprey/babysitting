import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Business } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../lib/router';
import { TabBar } from '../components/TabBar';
import { Spinner, ErrorNote, Field, useToast } from '../components/ui';
import { centsToInput, fmtMoney } from '../lib/money';

export function Settings() {
  const { user, logout, refresh } = useAuth();
  const [business, setBusiness] = useState<Business | null>(null);
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.business().then((b) => {
      setBusiness(b);
      setName(b?.name ?? '');
      setRate(centsToInput(b?.defaultRateCents));
    }).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="app">
      <div className="appbar">
        <div className="grow">
          <div className="title">Settings</div>
          <div className="subtitle">{user?.email}</div>
        </div>
      </div>

      <div className="content pad pad-bottom">
        <div className="stack">
          <ErrorNote error={error} />

          {business === null ? <Spinner /> : (
            <>
              <div className="section-title">Your business</div>
              <div className="card stack">
                <Field label="Business name">
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Default hourly rate">
                  <input className="input" inputMode="decimal" value={rate}
                    placeholder="0.00" onChange={(e) => setRate(e.target.value)} />
                  <span className="faint">
                    Used when a client has no rate of their own. Currently {fmtMoney(business.defaultRateCents, business.currency)}/hr.
                  </span>
                </Field>
                <button className="btn primary" disabled={busy || !name.trim()} onClick={async () => {
                  setBusy(true);
                  try {
                    const b = await api.updateBusiness({
                      name: name.trim(), defaultRate: rate === '' ? 0 : Number(rate),
                    });
                    setBusiness(b);
                    await refresh();
                    showToast('Saved');
                  } catch (e) {
                    showToast(e instanceof Error ? e.message : 'Could not save');
                  }
                  setBusy(false);
                }}>Save</button>
              </div>

              {business.stats && (
                <div className="stat-row">
                  <div className="stat"><div className="v">{business.stats.clients}</div><div className="k">clients</div></div>
                  <div className="stat"><div className="v">{business.stats.shifts}</div><div className="k">shifts</div></div>
                  <div className="stat"><div className="v">{business.stats.upcoming}</div><div className="k">booked</div></div>
                </div>
              )}
            </>
          )}

          <div className="section-title" style={{ marginTop: 10 }}>Account</div>
          <ChangePassword showToast={showToast} />

          {user?.isAdmin && (
            <button className="btn block" onClick={() => navigate('/admin')}>
              🛠️ Platform administration
            </button>
          )}

          <button className="btn danger block" onClick={() => logout()}>Sign out</button>
        </div>
      </div>

      {toast}
      <TabBar current="/settings" />
    </div>
  );
}

function ChangePassword({ showToast }: { showToast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return <button className="btn block" onClick={() => setOpen(true)}>Change password</button>;
  }

  return (
    <div className="card stack">
      <Field label="Current password">
        <input className="input" type="password" value={current}
          onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password">
        <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        <span className="faint">At least 8 characters. Your other devices will be signed out.</span>
      </Field>
      <ErrorNote error={error} />
      <div className="row">
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <span className="spacer" />
        <button className="btn primary" disabled={busy || next.length < 8} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.changePassword(current, next);
            setOpen(false);
            setCurrent('');
            setNext('');
            showToast('Password changed');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not change it');
          }
          setBusy(false);
        }}>Change it</button>
      </div>
    </div>
  );
}
