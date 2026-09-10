import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../lib/router';
import { ErrorNote, Field } from '../components/ui';

/**
 * Shown to a signed-in account that is neither a sitter with a business nor a
 * parent with access — normally someone who registered as an admin, or whose
 * business was removed.
 */
export function Onboarding() {
  const { refresh, logout, user } = useAuth();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="content login-shell">
        <div className="login-card">
          <div className="login-head">
            <div className="login-mark">🧸</div>
            <h1>Welcome, {user?.name.split(' ')[0]}</h1>
            <p className="muted">Set up your babysitting business, or join a family you sit for.</p>
          </div>

          <div className="card stack">
            <h2>Start your business</h2>
            <Field label="Business name">
              <input className="input" value={name} placeholder="e.g. Rivera Childcare"
                onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Default hourly rate (optional)">
              <input className="input" inputMode="decimal" value={rate} placeholder="25.00"
                onChange={(e) => setRate(e.target.value)} />
              <span className="faint">You can set a different rate per client.</span>
            </Field>
            <button className="btn primary lg block" disabled={busy || !name.trim()}
              onClick={() => guard(async () => {
                await api.createBusiness({ name: name.trim(), defaultRate: rate ? Number(rate) : undefined });
              })}>
              {busy ? 'Setting up…' : 'Create my business'}
            </button>
          </div>

          <div className="card stack" style={{ marginTop: 14 }}>
            <h2>Or join a family</h2>
            <Field label="Invite code from your sitter">
              <input className="input" value={code} placeholder="ABCD2345"
                style={{ textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 700 }}
                onChange={(e) => setCode(e.target.value)} />
            </Field>
            <button className="btn block" disabled={busy || !code.trim()}
              onClick={() => guard(async () => { await api.joinClient(code.toUpperCase()); })}>
              Join
            </button>
          </div>

          <ErrorNote error={error} />

          {user?.isAdmin && (
            <button className="btn block" style={{ marginTop: 14 }} onClick={() => navigate('/admin')}>
              🛠️ Platform administration
            </button>
          )}

          <button className="btn ghost block" style={{ marginTop: 14 }} onClick={() => logout()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
