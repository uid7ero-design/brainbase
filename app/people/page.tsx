'use client';
import { useEffect, useState } from 'react';
import SlidePanel from './_components/SlidePanel';
import PersonForm from './_components/PersonForm';
import PersonDrawer, { type PersonDetail } from './_components/PersonDrawer';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Person = {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  worker_type: string;
  employment_status: string;
  team_name?: string | null;
  manager_first_name?: string | null;
  manager_last_name?: string | null;
};

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  // The person currently being edited (Edit action from PersonDrawer) —
  // separate from openPersonId/showAdd so the read-only drawer and the
  // two write panels (Add, Edit) never fight over the same piece of
  // state. PersonForm already fully supports edit mode given an
  // `initial` person (see its own submit(): initial?.id present ->
  // PATCH, otherwise POST) — this phase only wires an existing person
  // into it, no change to PersonForm itself.
  const [editingPerson, setEditingPerson] = useState<PersonDetail | null>(null);
  // canManage reflects whether THIS viewer is an HR administrator — a
  // task-oriented UX flag from GET /api/hr/people (never the raw
  // entitlement/grant record), used only to decide whether to show the
  // "+ Add Person" action at all. Server-side authorization (POST
  // /api/hr/people's own permission check) remains authoritative
  // regardless of this value — hiding the button is a UX courtesy, not
  // the security boundary.
  const [canManage, setCanManage] = useState(false);

  async function load() {
    setLoading(true); setError('');
    const res = await fetch('/api/hr/people');
    if (res.ok) {
      const data = await res.json();
      setPeople(data.people);
      setCanManage(Boolean(data.canManage));
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not load People.');
    }
    setLoading(false);
  }
  useEffect(() => { queueMicrotask(() => { load(); }); }, []);

  const filtered = people.filter(p => {
    const q = search.toLowerCase();
    return `${p.first_name} ${p.last_name}`.toLowerCase().includes(q)
      || (p.job_title ?? '').toLowerCase().includes(q)
      || (p.team_name ?? '').toLowerCase().includes(q);
  });

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>People</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
            Your organisation&apos;s workers, teams, and basic employment information.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13, outline: 'none', width: 200 }} />
          {canManage && (
            <button onClick={() => setShowAdd(true)} style={btn('#1a6aff')}>+ Add Person</button>
          )}
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginTop: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Name', 'Status', 'Job Title', 'Team', 'Manager', 'Worker Type', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={empty}>Loading…</td></tr>}
            {!loading && error && <tr><td colSpan={7} style={{ ...empty, color: '#f87171' }}>{error}</td></tr>}
            {!loading && !error && filtered.length === 0 && (
              <tr><td colSpan={7} style={empty}>
                {people.length === 0
                  ? (canManage ? 'No people yet. Add your first person to get started.' : 'No people to show yet.')
                  : 'No people match your search.'}
              </td></tr>
            )}
            {filtered.map((p, i) => (
              <tr key={p.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '13px 16px' }}>
                  <button onClick={() => setOpenPersonId(p.id)} style={{ background: 'none', border: 'none', padding: 0, color: '#f9fafb', fontWeight: 500, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
                    {p.first_name} {p.last_name}
                  </button>
                </td>
                <td style={td}><StatusBadge status={p.employment_status} /></td>
                <td style={td}>{p.job_title ?? <span style={{ color: '#4b5563' }}>—</span>}</td>
                <td style={td}>{p.team_name ?? <span style={{ color: '#4b5563' }}>—</span>}</td>
                <td style={td}>{p.manager_first_name ? `${p.manager_first_name} ${p.manager_last_name}` : <span style={{ color: '#4b5563' }}>—</span>}</td>
                <td style={{ ...td, textTransform: 'capitalize' }}>{p.worker_type}</td>
                <td style={{ padding: '13px 16px' }}>
                  <button onClick={() => setOpenPersonId(p.id)} style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: '#6b7280', cursor: 'pointer' }}>View →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Person">
        <PersonForm onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>

      <SlidePanel open={editingPerson !== null} onClose={() => setEditingPerson(null)} title="Edit Person">
        {editingPerson && (
          <PersonForm initial={editingPerson} onSaved={() => { setEditingPerson(null); load(); }} />
        )}
      </SlidePanel>

      <PersonDrawer
        personId={openPersonId}
        canManage={canManage}
        onClose={() => setOpenPersonId(null)}
        onEdit={person => { setOpenPersonId(null); setEditingPerson(person); }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { fg: string; bg: string }> = {
    active: { fg: '#6ee7b7', bg: 'rgba(16,185,129,.12)' },
    onboarding: { fg: '#93c5fd', bg: 'rgba(59,130,246,.12)' },
    inactive: { fg: '#fbbf24', bg: 'rgba(245,158,11,.12)' },
    ended: { fg: '#9ca3af', bg: 'rgba(107,114,128,.12)' },
  };
  const c = colors[status] ?? colors.ended;
  return (
    <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'capitalize', color: c.fg, background: c.bg }}>
      {status}
    </span>
  );
}

const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '13px 16px', fontSize: 13, color: '#9ca3af' };
const empty: React.CSSProperties = { padding: '36px 16px', textAlign: 'center', color: '#4b5563', fontSize: 14 };
function btn(bg: string): React.CSSProperties { return { padding: '8px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }
