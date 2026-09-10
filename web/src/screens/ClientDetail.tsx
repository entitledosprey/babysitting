import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Child, Client, Contact, Invite } from '../lib/api';
import { navigate, back } from '../lib/router';
import { Sheet, Spinner, ErrorNote, Field, Toggle, useToast } from '../components/ui';
import { fmtRate, centsToInput } from '../lib/money';
import { fmtTime, fmtDuration } from '../lib/time';

type Tab = 'care' | 'people' | 'shifts';

export function ClientDetail({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<Client | null>(null);
  const [tab, setTab] = useState<Tab>('care');
  const [error, setError] = useState<string | null>(null);
  const [editingChild, setEditingChild] = useState<Child | 'new' | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | 'new' | null>(null);
  const [editingClient, setEditingClient] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try { setClient(await api.client(clientId)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="pad"><ErrorNote error={error} /></div>;
  if (!client) return <Spinner />;

  const isOwner = client.access === 'owner';
  const children = client.children ?? [];
  const contacts = client.contacts ?? [];
  const shifts = client.shifts ?? [];

  return (
    <div className="app">
      <div className="appbar">
        <button className="btn ghost" onClick={() => back()} aria-label="Back">‹</button>
        <div className="grow">
          <div className="title">{client.name}</div>
          <div className="subtitle">
            {isOwner ? fmtRate(client.rateCents) : 'Read-only'}
            {client.archived ? ' · archived' : ''}
          </div>
        </div>
        {isOwner && <button className="btn sm" onClick={() => setEditingClient(true)}>Edit</button>}
      </div>

      <div style={{ padding: '10px 14px 0' }}>
        <div className="seg">
          <button aria-pressed={tab === 'care'} onClick={() => setTab('care')}>Care</button>
          <button aria-pressed={tab === 'people'} onClick={() => setTab('people')}>People</button>
          <button aria-pressed={tab === 'shifts'} onClick={() => setTab('shifts')}>Shifts</button>
        </div>
      </div>

      <div className="content pad pad-bottom">
        {tab === 'care' && (
          <div className="stack">
            {children.some((c) => c.allergies) && (
              <div className="callout alert">
                <div className="k">Allergies</div>
                {children.filter((c) => c.allergies).map((c) => (
                  <div key={c.id}><strong>{c.name}:</strong> {c.allergies}</div>
                ))}
              </div>
            )}

            {client.houseRules && (
              <div className="callout"><div className="k">House rules</div>{client.houseRules}</div>
            )}
            {client.address && (
              <div className="callout"><div className="k">Address</div>{client.address}</div>
            )}
            {client.wifi && (
              <div className="callout"><div className="k">Wi-Fi</div>{client.wifi}</div>
            )}
            {client.notes && (
              <div className="callout"><div className="k">Notes</div>{client.notes}</div>
            )}

            <div className="section-title" style={{ marginTop: 6 }}>Children</div>
            {children.length === 0 && <div className="muted">No children added yet.</div>}
            {children.map((c) => (
              <button key={c.id} className="card tap stack tight" disabled={!isOwner}
                onClick={() => setEditingChild(c)}>
                <div className="row">
                  <span className="child-dot" style={{ ['--cc' as string]: c.colour, width: 12, height: 12 }} />
                  <strong style={{ flex: 1 }}>{c.name}</strong>
                  {c.archived && <span className="pill">Archived</span>}
                </div>
                {c.birthdate && <span className="faint">Born {c.birthdate}</span>}
                {c.allergies && <span style={{ color: 'var(--danger)', fontSize: '.85rem' }}>Allergies: {c.allergies}</span>}
                {c.medical && <span className="faint">Medical: {c.medical}</span>}
                {c.routines && <span className="faint">Routines: {c.routines}</span>}
                {c.notes && <span className="faint">{c.notes}</span>}
              </button>
            ))}
            {isOwner && (
              <button className="btn block" onClick={() => setEditingChild('new')}>Add a child</button>
            )}
          </div>
        )}

        {tab === 'people' && (
          <div className="stack">
            <div className="section-title">Contacts</div>
            {contacts.length === 0 && (
              <div className="muted">
                No contacts yet. Reports are emailed to contacts, so add at least one.
              </div>
            )}
            {contacts.map((c) => (
              <button key={c.id} className="card tap stack tight" disabled={!isOwner}
                onClick={() => setEditingContact(c)}>
                <div className="row">
                  <strong style={{ flex: 1 }}>{c.name}</strong>
                  {c.isPrimary && <span className="pill scheduled">Primary</span>}
                </div>
                {c.relationship && <span className="faint">{c.relationship}</span>}
                {c.email && <span className="faint">{c.email}</span>}
                {c.phone && <span className="faint">{c.phone}</span>}
                <div className="row wrap" style={{ gap: 6 }}>
                  {c.receivesReports && <span className="pill done">Gets reports</span>}
                  {c.isEmergency && <span className="pill">Emergency</span>}
                  {c.canCollect && <span className="pill">Can collect</span>}
                </div>
              </button>
            ))}
            {isOwner && (
              <button className="btn block" onClick={() => setEditingContact('new')}>Add a contact</button>
            )}

            {isOwner && <ParentAccess client={client} onChanged={load} showToast={showToast} />}
          </div>
        )}

        {tab === 'shifts' && (
          <div className="stack">
            {isOwner && (
              <button className="btn primary block" onClick={() => navigate('/')}>
                Start or book a shift
              </button>
            )}
            {shifts.length === 0 && <div className="muted">No shifts yet.</div>}
            {shifts.map((s) => (
              <button key={s.id} className="card tap stack tight" onClick={() => navigate(`/shift/${s.id}`)}>
                <div className="row">
                  <strong style={{ flex: 1 }}>{s.date}</strong>
                  <span className={`pill ${s.status === 'in_progress' ? 'live' : s.status === 'completed' ? 'done' : s.status === 'cancelled' ? 'cancelled' : 'scheduled'}`}>
                    {s.status === 'in_progress' ? 'On shift' : s.status === 'completed' ? 'Done'
                      : s.status === 'cancelled' ? 'Cancelled' : 'Booked'}
                  </span>
                </div>
                <span className="faint">
                  {s.startedAt ? `${fmtTime(s.startedAt)}${s.endedAt ? `–${fmtTime(s.endedAt)}` : ''}` :
                    s.scheduledStart ? `Booked for ${fmtTime(s.scheduledStart)}` : ''}
                  {s.minutes ? ` · ${fmtDuration(s.minutes)}` : ''}
                  {s.eventCount ? ` · ${s.eventCount} entries` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {editingChild && (
        <ChildSheet clientId={clientId} child={editingChild === 'new' ? null : editingChild}
          onClose={() => setEditingChild(null)}
          onDone={(m) => { setEditingChild(null); showToast(m); load(); }} />
      )}
      {editingContact && (
        <ContactSheet clientId={clientId} contact={editingContact === 'new' ? null : editingContact}
          onClose={() => setEditingContact(null)}
          onDone={(m) => { setEditingContact(null); showToast(m); load(); }} />
      )}
      {editingClient && (
        <ClientSheet client={client} onClose={() => setEditingClient(false)}
          onDone={(m, deleted) => {
            setEditingClient(false);
            if (deleted) { navigate('/clients'); return; }
            showToast(m); load();
          }} />
      )}
      {toast}
    </div>
  );
}

function ParentAccess({ client, onChanged, showToast }: {
  client: Client; onChanged: () => void; showToast: (m: string) => void;
}) {
  const [invites, setInvites] = useState<Invite[]>([]);

  const loadInvites = useCallback(() => {
    api.invites(client.id).then(setInvites).catch(() => setInvites([]));
  }, [client.id]);

  useEffect(() => { loadInvites(); }, [loadInvites]);

  return (
    <>
      <div className="section-title" style={{ marginTop: 12 }}>Parent portal</div>
      <p className="muted" style={{ margin: 0 }}>
        Give a parent a read-only login to see their own family's shifts and reports.
      </p>

      {(client.parents ?? []).map((p) => (
        <div key={p.id} className="card row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{p.name}</strong>
            <div className="faint">{p.email}</div>
          </div>
          <button className="btn sm danger" onClick={async () => {
            if (!window.confirm(`Remove ${p.name}'s access?`)) return;
            await api.revokeParent(client.id, p.id);
            showToast('Access removed');
            onChanged();
          }}>Remove</button>
        </div>
      ))}

      {invites.map((inv) => (
        <div key={inv.code} className="card stack tight">
          <div className="code">{inv.code}</div>
          <div className="row">
            <span className="faint">Unused invite</span>
            <span className="spacer" />
            <button className="btn sm" onClick={async () => {
              try { await navigator.clipboard.writeText(inv.code); showToast('Code copied'); }
              catch { showToast('Copy it manually'); }
            }}>Copy</button>
            <button className="btn sm danger" onClick={async () => {
              await api.revokeInvite(client.id, inv.code);
              loadInvites();
            }}>Revoke</button>
          </div>
        </div>
      ))}

      <button className="btn block" onClick={async () => {
        await api.createInvite(client.id);
        loadInvites();
        showToast('Invite code created');
      }}>Create an invite code</button>
    </>
  );
}

function ChildSheet({ clientId, child, onClose, onDone }: {
  clientId: string; child: Child | null; onClose: () => void; onDone: (m: string) => void;
}) {
  const [f, setF] = useState({
    name: child?.name ?? '', birthdate: child?.birthdate ?? '',
    colour: child?.colour ?? '#4a7fe0', allergies: child?.allergies ?? '',
    medical: child?.medical ?? '', routines: child?.routines ?? '', notes: child?.notes ?? '',
    archived: child?.archived ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  const COLOURS = ['#4a7fe0', '#e0699b', '#3fa66a', '#e8794a', '#8a5cd6', '#35a3c4', '#d4a017', '#8b6b4a'];

  return (
    <Sheet title={child ? child.name : 'Add a child'} onClose={onClose}>
      <div className="stack">
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Birthday (optional)">
          <input className="input" type="date" value={f.birthdate ?? ''}
            onChange={(e) => set('birthdate', e.target.value)} />
        </Field>
        <Field label="Colour on the timeline">
          <div className="chips">
            {COLOURS.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={f.colour === c}
                onClick={() => set('colour', c)} style={{ padding: '10px 14px' }}>
                <span className="child-dot" style={{ ['--cc' as string]: c, width: 14, height: 14, marginRight: 0 }} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Allergies">
          <input className="input" value={f.allergies} placeholder="e.g. peanuts, dairy"
            onChange={(e) => set('allergies', e.target.value)} />
          <span className="faint">Shown prominently on the client's care page.</span>
        </Field>
        <Field label="Medical notes">
          <textarea className="input" rows={2} value={f.medical}
            placeholder="Medication, conditions, doctor" onChange={(e) => set('medical', e.target.value)} />
        </Field>
        <Field label="Routines">
          <textarea className="input" rows={2} value={f.routines}
            placeholder="Naps, bedtime, comfort items" onChange={(e) => set('routines', e.target.value)} />
        </Field>
        <Field label="Anything else">
          <textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {child && (
          <Toggle label="Archived — hide from new shifts" value={f.archived}
            onChange={(v) => set('archived', v)} />
        )}
        <ErrorNote error={error} />
        <button className="btn primary lg block" disabled={busy || !f.name.trim()} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const body = { ...f, birthdate: f.birthdate || null };
            if (child) await api.updateChild(clientId, child.id, body);
            else await api.createChild(clientId, body);
            onDone(child ? 'Saved' : 'Child added');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save');
            setBusy(false);
          }
        }}>{busy ? 'Saving…' : child ? 'Save changes' : 'Add child'}</button>

        {child && (
          <button className="btn danger block" disabled={busy} onClick={async () => {
            if (!window.confirm(`Delete ${child.name}? Their logged history goes too.`)) return;
            setBusy(true);
            try { await api.deleteChild(clientId, child.id); onDone('Child deleted'); }
            catch (e) { setError(e instanceof Error ? e.message : 'Could not delete'); setBusy(false); }
          }}>Delete child</button>
        )}
      </div>
    </Sheet>
  );
}

function ContactSheet({ clientId, contact, onClose, onDone }: {
  clientId: string; contact: Contact | null; onClose: () => void; onDone: (m: string) => void;
}) {
  const [f, setF] = useState({
    name: contact?.name ?? '', email: contact?.email ?? '', phone: contact?.phone ?? '',
    relationship: contact?.relationship ?? '',
    isPrimary: contact?.isPrimary ?? false,
    receivesReports: contact?.receivesReports ?? true,
    isEmergency: contact?.isEmergency ?? false,
    canCollect: contact?.canCollect ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  return (
    <Sheet title={contact ? contact.name : 'Add a contact'} onClose={onClose}>
      <div className="stack">
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Relationship">
          <input className="input" value={f.relationship} placeholder="e.g. Mother, Grandparent"
            onChange={(e) => set('relationship', e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={f.email}
            onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Toggle label="Receives the daily report" value={f.receivesReports}
          onChange={(v) => set('receivesReports', v)} />
        <Toggle label="Primary contact" value={f.isPrimary} onChange={(v) => set('isPrimary', v)} />
        <Toggle label="Emergency contact" value={f.isEmergency} onChange={(v) => set('isEmergency', v)} />
        <Toggle label="Authorised to collect" value={f.canCollect} onChange={(v) => set('canCollect', v)} />
        <ErrorNote error={error} />
        <button className="btn primary lg block" disabled={busy || !f.name.trim()} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            if (contact) await api.updateContact(clientId, contact.id, f);
            else await api.createContact(clientId, f);
            onDone(contact ? 'Saved' : 'Contact added');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save');
            setBusy(false);
          }
        }}>{busy ? 'Saving…' : contact ? 'Save changes' : 'Add contact'}</button>

        {contact && (
          <button className="btn danger block" disabled={busy} onClick={async () => {
            if (!window.confirm(`Remove ${contact.name}?`)) return;
            setBusy(true);
            try { await api.deleteContact(clientId, contact.id); onDone('Contact removed'); }
            catch (e) { setError(e instanceof Error ? e.message : 'Could not remove'); setBusy(false); }
          }}>Remove contact</button>
        )}
      </div>
    </Sheet>
  );
}

function ClientSheet({ client, onClose, onDone }: {
  client: Client; onClose: () => void; onDone: (m: string, deleted?: boolean) => void;
}) {
  const [f, setF] = useState({
    name: client.name, address: client.address, rate: centsToInput(client.rateCents),
    houseRules: client.houseRules, wifi: client.wifi, notes: client.notes,
    archived: client.archived,
  });
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  return (
    <Sheet title="Edit client" onClose={onClose}>
      <div className="stack">
        <Field label="Family name">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Hourly rate">
          <input className="input" inputMode="decimal" value={f.rate} placeholder="Business default"
            onChange={(e) => set('rate', e.target.value)} />
        </Field>
        <Field label="Address">
          <input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="House rules">
          <textarea className="input" rows={2} value={f.houseRules}
            onChange={(e) => set('houseRules', e.target.value)} />
        </Field>
        <Field label="Wi-Fi">
          <input className="input" value={f.wifi} onChange={(e) => set('wifi', e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <Toggle label="Archived — hide from the active roster" value={f.archived}
          onChange={(v) => set('archived', v)} />

        <ErrorNote error={error} />
        <button className="btn primary lg block" disabled={busy || !f.name.trim()} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.updateClient(client.id, { ...f, rate: f.rate === '' ? null : Number(f.rate) });
            onDone('Saved');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save');
            setBusy(false);
          }
        }}>{busy ? 'Saving…' : 'Save changes'}</button>

        <div className="section-title" style={{ marginTop: 14 }}>Danger zone</div>
        <Field label={`Type "${client.name}" to delete this client and every shift logged for them`}>
          <input className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
        </Field>
        <button className="btn danger block" disabled={busy || confirmName !== client.name}
          onClick={async () => {
            setBusy(true);
            try { await api.deleteClient(client.id, confirmName); onDone('Client deleted', true); }
            catch (e) { setError(e instanceof Error ? e.message : 'Could not delete'); setBusy(false); }
          }}>Delete client</button>
      </div>
    </Sheet>
  );
}
