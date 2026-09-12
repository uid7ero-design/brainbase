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
};
type Team = { id: string; name: string };
type ManagerOption = { id: string; first_name: string; last_name: string };

export default function PersonForm({ initial, onSaved }: { initial?: Person; onSaved: (p: Person) => void }) {
  const [form, setForm] = useState<Person>(initial ?? { worker_type: 'employee', employment_status: 'active' });
  const [teams, setTeams] = useState<Team[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/hr/teams').then(r => r.json()).then(d => setTeams(d.teams ?? []));
    fetch('/api/hr/people').then(r => r.json()).then(d => setManagers(d.people ?? []));
  }, []);

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
  const EDITABLE_FIELDS = [
    'first_name', 'last_name', 'preferred_name', 'work_email', 'work_phone',
    'job_title', 'worker_type', 'employment_status', 'team_id', 'manager_person_id',
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
