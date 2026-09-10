import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { ErrorNote, Field } from '../components/ui';

type Mode = 'signin' | 'create' | 'invite';

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await login(email, password);
      else if (mode === 'create') await register({ email, password, name, familyName });
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
            <p className="muted">Everything that happened today, in one place.</p>
          </div>

          <div className="seg login-tabs">
            <button aria-pressed={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
            <button aria-pressed={mode === 'create'} onClick={() => setMode('create')}>New family</button>
            <button aria-pressed={mode === 'invite'} onClick={() => setMode('invite')}>Have a code</button>
          </div>

          <form className="card stack" onSubmit={submit}>
            {mode !== 'signin' && (
              <Field label="Your name">
                <input className="input" value={name} required autoComplete="name"
                  onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Rivera" />
              </Field>
            )}

            {mode === 'create' && (
              <Field label="Family name">
                <input className="input" value={familyName} required
                  onChange={(e) => setFamilyName(e.target.value)} placeholder="e.g. The Rivera family" />
              </Field>
            )}

            {mode === 'invite' && (
              <Field label="Invite code">
                <input className="input" value={inviteCode} required
                  style={{ textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 700 }}
                  onChange={(e) => setInviteCode(e.target.value)} placeholder="ABCD2345" />
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
                : mode === 'create' ? 'Create family'
                : 'Join family'}
            </button>
          </form>

          <p className="faint login-foot">
            {mode === 'invite'
              ? 'A parent can generate a code for you from their family settings.'
              : 'Sitters join an existing family with an invite code.'}
          </p>
        </div>
      </div>
    </div>
  );
}
