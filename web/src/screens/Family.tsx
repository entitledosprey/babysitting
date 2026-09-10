import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Child, Invite, Member } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../lib/router';
import { Sheet, Spinner, ErrorNote, Field, useToast } from '../components/ui';

const CHILD_COLOURS = ['#4a7fe0', '#e0699b', '#3fa66a', '#e8794a', '#8a5cd6', '#35a3c4', '#d4a017', '#8b6b4a'];

export function FamilyScreen({ familyId }: { familyId: string }) {
  const { user, refresh } = useAuth();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [editing, setEditing] = useState<Child | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const family = user?.families.find((f) => f.id === familyId);
  const isParent = family?.role === 'parent';

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([api.children(familyId), api.members(familyId)]);
      setChildren(c);
      setMembers(m);
      if (isParent) setInvites(await api.invites(familyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
      setChildren([]);
    }
  }, [familyId, isParent]);

  useEffect(() => { load(); }, [load]);

  const newInvite = async (role: 'parent' | 'sitter') => {
    try {
      const inv = await api.createInvite(familyId, role);
      setInvites((i) => [inv, ...i]);
      showToast('Invite code created');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not create an invite');
    }
  };

  return (
    <div className="app">
      <div className="appbar">
        <button className="btn ghost" onClick={() => navigate('/')} aria-label="Back">‹</button>
        <div className="grow">
          <div className="title">{family?.name ?? 'Family'}</div>
          <div className="subtitle">{isParent ? 'Parent' : 'Sitter'}</div>
        </div>
      </div>

      <div className="content pad pad-bottom">
        <div className="stack">
          <ErrorNote error={error} />

          <div className="section-title">Children</div>
          {children === null ? <Spinner /> : children.length === 0 ? (
            <div className="empty"><span className="big">🧒</span>No children yet.</div>
          ) : children.map((c) => (
            <button key={c.id} className="card tap row" disabled={!isParent}
              onClick={() => setEditing(c)}>
              <span className="child-dot" style={{ ['--cc' as string]: c.colour, width: 12, height: 12 }} />
              <strong style={{ flex: 1 }}>{c.name}</strong>
              {c.archived && <span className="badge">Archived</span>}
              {isParent && <span className="muted">Edit</span>}
            </button>
          ))}

          {isParent && (
            <button className="btn block" onClick={() => setEditing('new')}>Add a child</button>
          )}

          <div className="section-title" style={{ marginTop: 12 }}>People</div>
          {members.map((m) => (
            <div key={m.id} className="card row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{m.name}</strong>{m.id === user?.id && <span className="muted"> · you</span>}
                <div className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div>
              </div>
              <span className="badge">{m.role}</span>
            </div>
          ))}

          {isParent && (
            <>
              <div className="section-title" style={{ marginTop: 12 }}>Invite a sitter</div>
              <p className="muted" style={{ margin: 0 }}>
                Share a code with a sitter. They enter it when creating their account, and it works once.
              </p>
              {invites.map((inv) => (
                <div key={inv.code} className="card stack tight">
                  <div className="code">{inv.code}</div>
                  <div className="row">
                    <span className="badge">{inv.role}</span>
                    <span className="spacer" />
                    <button className="btn sm" onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inv.code);
                        showToast('Code copied');
                      } catch { showToast('Copy it manually'); }
                    }}>Copy</button>
                    <button className="btn sm danger" onClick={async () => {
                      await api.revokeInvite(familyId, inv.code);
                      setInvites((i) => i.filter((x) => x.code !== inv.code));
                    }}>Revoke</button>
                  </div>
                </div>
              ))}
              <div className="row">
                <button className="btn" onClick={() => newInvite('sitter')}>New sitter code</button>
                <button className="btn" onClick={() => newInvite('parent')}>New parent code</button>
              </div>
            </>
          )}

          <JoinAnother onJoined={async () => { await refresh(); showToast('Joined'); }} />
        </div>
      </div>

      {editing && (
        <ChildSheet
          familyId={familyId}
          child={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}

      {toast}
    </div>
  );
}

function ChildSheet({ familyId, child, onClose, onSaved }: {
  familyId: string; child: Child | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(child?.name ?? '');
  const [birthdate, setBirthdate] = useState(child?.birthdate ?? '');
  const [colour, setColour] = useState(child?.colour ?? CHILD_COLOURS[0]);
  const [notes, setNotes] = useState(child?.notes ?? '');
  const [archived, setArchived] = useState(child?.archived ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (child) {
        await api.updateChild(familyId, child.id, { name, birthdate: birthdate || null, colour, notes, archived });
      } else {
        await api.createChild(familyId, { name, birthdate: birthdate || null, colour, notes });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  };

  return (
    <Sheet title={child ? 'Edit child' : 'Add a child'} onClose={onClose}>
      <div className="stack">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ada" />
        </Field>
        <Field label="Birthday (optional)">
          <input className="input" type="date" value={birthdate ?? ''} onChange={(e) => setBirthdate(e.target.value)} />
        </Field>
        <Field label="Colour on the timeline">
          <div className="chips">
            {CHILD_COLOURS.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={colour === c}
                onClick={() => setColour(c)} style={{ padding: '10px 14px' }}>
                <span className="child-dot" style={{ ['--cc' as string]: c, width: 14, height: 14, marginRight: 0 }} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Notes (allergies, routines, anything a sitter should know)">
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {child && (
          <button type="button" className="toggle" aria-pressed={archived} onClick={() => setArchived((a) => !a)}>
            <span>Archived — hide from new sessions</span>
            <span className="mark" aria-hidden="true">✓</span>
          </button>
        )}
        <ErrorNote error={error} />
        <button className="btn primary lg block" disabled={busy || !name.trim()} onClick={save}>
          {busy ? 'Saving…' : child ? 'Save changes' : 'Add child'}
        </button>
      </div>
    </Sheet>
  );
}

function JoinAnother({ onJoined }: { onJoined: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="btn ghost block" style={{ marginTop: 20 }} onClick={() => setOpen(true)}>
        Join another family with a code
      </button>
    );
  }

  return (
    <Sheet title="Join another family" onClose={() => setOpen(false)}>
      <div className="stack">
        <Field label="Invite code">
          <input className="input" value={code} placeholder="ABCD2345"
            style={{ textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 700 }}
            onChange={(e) => setCode(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <button className="btn primary lg block" disabled={busy || !code.trim()} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.joinFamily(code.toUpperCase());
            setOpen(false);
            onJoined();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not join');
          }
          setBusy(false);
        }}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </div>
    </Sheet>
  );
}
