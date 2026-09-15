'use client';
import { useEffect, useState } from 'react';

const WORKER_TYPES = [
  { value: 'employee', label: 'Employee' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'casual', label: 'Casual' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'other', label: 'Other' },
] as const;

const EMPLOYMENT_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'ended', label: 'Ended' },
] as const;

type Person = {
  id?: string;
  first_name?: string;
  last_name?: string;
  preferred_name?: string | null;
  work_email?: string | null;
  work_phone?: string | null;
  job_title?: string | null;
  worker_type?: string;
  employment_status?: string;
  team_id?: string | null;
  manager_person_id?: string | null;
  linked_user_id?: string | null;
};
type Team = { id: string; name: string };
type ManagerOption = { id: string; first_name: string; last_name: string };
// HR-2 Step 1D1 — the exact, deliberately narrow shape GET
// /api/hr/linkable-users returns (see that route's own header comment
// for why: no role, no status, no password/tokens, no other
// organisation's users). `selectable` (added in the Step 1D1
// corrective pass) is the authoritative disabling signal — server-
// computed so this component never has to re-derive "is this account
// pickable" from a raw status enum.
type LinkableUser = { id: string; name: string; email: string | null; already_linked: boolean; linked_person_id: string | null; selectable: boolean };

// canManage: the SAME server-derived, HR-administrator UX flag
// app/people/page.tsx already computes (from GET /api/hr/people's own
// ctx.isHrAdministrator projection) and already uses to gate whether
// this form is even reachable at all (both the "+ Add Person" button
// and PersonDrawer's "Edit" button are themselves canManage-gated —
// this form is therefore never mounted for a non-admin viewer in the
// first place). Threaded through explicitly anyway, rather than relied
// on as an implicit invariant of how callers happen to mount this
// component today, so the linked-account control's own visibility
// doesn't silently depend on that never changing. This is a UX
// courtesy only, exactly like every other canManage gate in this
// module — PATCH /api/hr/people/[id]'s own ctx.isHrAdministrator check
// remains the actual, unchanged security boundary regardless of what
// this prop is set to.
export default function PersonForm({ initial, onSaved, canManage }: { initial?: Person; onSaved: (p: Person) => void; canManage: boolean }) {
  const [form, setForm] = useState<Person>(initial ?? { worker_type: 'employee', employment_status: 'active' });
  const [teams, setTeams] = useState<Team[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [linkableUsers, setLinkableUsers] = useState<LinkableUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/hr/teams').then(r => r.json()).then(d => setTeams(d.teams ?? []));
    fetch('/api/hr/people').then(r => r.json()).then(d => setManagers(d.people ?? []));
    // HR-2 Step 1D1 — fetched only when this management UI actually
    // needs it, matching this route's own HR-administrator-only gate
    // (a fetch from a non-admin viewer would just 403 harmlessly, but
    // there is no reason to issue it at all when canManage is false).
    // Corrective pass — editing an existing person passes person_id so
    // the route can include that person's own currently-linked account
    // even if it has since gone inactive (see that route's own header
    // comment); create-person mode has no person_id and therefore
    // requests ACTIVE candidates only, unchanged from before.
    if (canManage) {
      const url = initial?.id ? `/api/hr/linkable-users?person_id=${initial.id}` : '/api/hr/linkable-users';
      fetch(url).then(r => r.json()).then(d => setLinkableUsers(d.users ?? []));
    }
  }, [canManage, initial?.id]);

  const set = (k: keyof Person) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  // Edit mode seeds `form` from `initial` — the raw object returned by
  // GET /api/hr/people/[id] (PersonDrawer's fetch), which carries far
  // more than this form ever exposes a control for: id, organisation_id,
  // linked_user_id, start_date, end_date, created_at, updated_at, and the
  // display-only join columns (team_name, manager_first_name,
  // manager_last_name). Spreading `form` straight into the PATCH body
  // sent every one of those back to the server; PATCH /api/hr/people/
  // [id] correctly rejects any field outside its own allowlist (by
  // design — see that route's own comment), so this always failed with
  // "Unknown or unsupported field: id" (id being first in insertion
  // order) the moment an edit was attempted. This allowlist contains
  // exactly the fields this form has a control for — the same set the
  // set() calls below ever write to — so it can never drift from what's
  // actually editable here without both being updated together.
  // HR-2 Step 1D1 — linked_user_id added. Still submitted unconditionally
  // like every other field here (matching this form's own established,
  // deliberate "always send the full editable shape" convention — see
  // PATCH /api/hr/people/[id]'s own PR #212 changedFields handling,
  // which already correctly treats an unchanged resubmitted value as a
  // no-op regardless). A non-admin viewer never reaches this branch at
  // all (canManage gates this form's very existence — see this
  // component's own header comment), so this addition cannot let a
  // non-admin smuggle a link change through; PATCH's own
  // ctx.isHrAdministrator check for linked_user_id remains the real
  // boundary either way.
  const EDITABLE_FIELDS = [
    'first_name', 'last_name', 'preferred_name', 'work_email', 'work_phone',
    'job_title', 'worker_type', 'employment_status', 'team_id', 'manager_person_id', 'linked_user_id',
  ] as const satisfies readonly (keyof Person)[];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    const isEdit = Boolean(initial?.id);
    const method = isEdit ? 'PATCH' : 'POST';
    const url = isEdit ? `/api/hr/people/${initial!.id}` : '/api/hr/people';
    // Create keeps sending `form` as-is (unchanged behavior) — POST
    // /api/hr/people already picks only the fields it wants by explicit
    // destructuring and silently ignores the rest, so it was never
    // affected by this bug. Edit sends only the allowlisted fields.
    const body: Person = isEdit
      ? Object.fromEntries(EDITABLE_FIELDS.map(k => [k, form[k]]))
      : form;
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Save failed.'); setSaving(false); return; }
    onSaved(data.person);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="First Name *" value={form.first_name ?? ''} onChange={set('first_name')} required />
        <Field label="Last Name *" value={form.last_name ?? ''} onChange={set('last_name')} required />
      </div>
      <Field label="Preferred Name" value={form.preferred_name ?? ''} onChange={set('preferred_name')} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Work Email" value={form.work_email ?? ''} onChange={set('work_email')} />
        <Field label="Work Phone" value={form.work_phone ?? ''} onChange={set('work_phone')} />
      </div>
      <Field label="Job Title" value={form.job_title ?? ''} onChange={set('job_title')} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={lbl}>Worker Type</label>
          <select value={form.worker_type ?? 'employee'} onChange={set('worker_type')} style={sel}>
            {WORKER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Employment Status</label>
          <select value={form.employment_status ?? 'active'} onChange={set('employment_status')} style={sel}>
            {EMPLOYMENT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label style={lbl}>Team</label>
        <select value={form.team_id ?? ''} onChange={set('team_id')} style={sel}>
          <option value="">— No team —</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div>
        <label style={lbl}>Manager</label>
        <select value={form.manager_person_id ?? ''} onChange={set('manager_person_id')} style={sel}>
          <option value="">— No manager —</option>
          {managers.filter(m => m.id !== form.id).map(m => (
            <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
          ))}
        </select>
      </div>

      {/* HR-2 Step 1D1 — explicit-linking-only control. Never
          auto-selected or highlighted by work_email match: the
          selected value comes ONLY from `initial.linked_user_id`
          (editing an already-linked person) or a deliberate choice
          made here — nothing in this component ever reads form.work_email
          to influence this field. Corrective pass — `disabled` now
          comes straight from the server-computed `selectable` field
          (GET /api/hr/linkable-users) rather than being re-derived
          here, so this component never has to know WHY a candidate
          isn't pickable (already linked to someone else, or — since
          this route can now also return the person's own currently-
          linked account even after it goes inactive — simply no
          longer an active account). `isCurrentLink` is kept only to
          pick the more accurate label text; it plays no part in
          disabling. Either way, the actual, concurrency-safe rejection
          of picking an unavailable account still lives in the DB's own
          UNIQUE constraint (see PATCH /api/hr/people/[id]'s own 409
          linked_user_already_linked handling) — this disabling is a UX
          courtesy only. */}
      {canManage && (
        <div>
          <label style={lbl}>Linked BrainBase Account</label>
          <select value={form.linked_user_id ?? ''} onChange={set('linked_user_id')} style={sel}>
            <option value="">— No linked account —</option>
            {linkableUsers.map(u => {
              const disabled = !u.selectable;
              const isCurrentLink = u.id === form.linked_user_id;
              const label = disabled ? (isCurrentLink ? ' — currently linked (inactive)' : ' — already linked') : '';
              return (
                <option key={u.id} value={u.id} disabled={disabled}>
                  {u.name}{u.email ? ` (${u.email})` : ''}{label}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
      <button type="submit" disabled={saving} style={{ padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Person'}
      </button>
    </form>
  );
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; required?: boolean }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input value={value} onChange={onChange} required={required}
        style={{ width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const sel: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14 };
