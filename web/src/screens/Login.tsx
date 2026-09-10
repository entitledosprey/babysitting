import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { ErrorNote, Field } from '../components/ui';

type Mode = 'signin' | 'sitter' | 'invite';

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await login(email, password);
      else if (mode === 'sitter') await register({ email, password, name, businessName });
      else await register({ email, password, name, inviteCode: inviteCode.toUpperCase() });
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
            <h1>Sitter Log</h1>
            <p className="muted">Run your babysitting work, and keep parents in the loop.</p>
          </div>

          <div className="seg login-tabs">
            <button aria-pressed={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
            <button aria-pressed={mode === 'sitter'} onClick={() => setMode('sitter')}>I'm a sitter</button>
            <button aria-pressed={mode === 'invite'} onClick={() => setMode('invite')}>I'm a parent</button>
          </div>

          <form className="card stack" onSubmit={submit}>
            {mode !== 'signin' && (
              <Field label="Your name">
                <input className="input" value={name} required autoComplete="name"
                  onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Rivera" />
              </Field>
            )}

            {mode === 'sitter' && (
              <Field label="Your business name">
                <input className="input" value={businessName} required
                  onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Rivera Childcare" />
                <span className="faint">You can change this later.</span>
              </Field>
            )}

            {mode === 'invite' && (
              <Field label="Invite code">
                <input className="input" value={inviteCode} required
                  style={{ textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 700 }}
                  onChange={(e) => setInviteCode(e.target.value)} placeholder="ABCD2345" />
                <span className="faint">Your sitter can generate this for you.</span>
              </Field>
            )}

            <Field label="Email">
              <input className="input" type="email" value={email} required autoComplete="email"
                onChange={(e) => setEmail(e.target.value)} />
            </Field>

            <Field label="Password">
              <input className="input" type="password" value={password} required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                onChange={(e) => setPassword(e.target.value)} />
              {mode !== 'signin' && <span className="faint">At least 8 characters.</span>}
            </Field>

            <ErrorNote error={error} />

            <button className="btn primary lg block" type="submit" disabled={busy}>
              {busy ? 'Just a moment…'
                : mode === 'signin' ? 'Sign in'
                : mode === 'sitter' ? 'Start my business'
                : 'View my family'}
            </button>
          </form>

          <p className="faint login-foot">
            {mode === 'invite'
              ? 'Parents get a read-only view of their own family and its reports.'
              : mode === 'sitter'
              ? 'Set up your client families, log your shifts, and send reports automatically.'
              : 'Sitters and parents both sign in here.'}
          </p>
        </div>
      </div>
    </div>
  );
}
