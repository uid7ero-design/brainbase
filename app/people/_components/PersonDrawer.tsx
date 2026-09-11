'use client';
import { useEffect, useState } from 'react';
import SlidePanel from './SlidePanel';

type PersonDetail = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name?: string | null;
  work_email?: string | null;
  work_phone?: string | null;
  job_title: string | null;
  worker_type: string;
  employment_status: string;
  team_name?: string | null;
  manager_first_name?: string | null;
  manager_last_name?: string | null;
};

// Read-only detail view — "basic profile page or drawer" per the HR-1
// brief, using the panel convention already established by
// app/crm/_components/SlidePanel.tsx rather than a second, dedicated
// /people/[id] route. Renders only whatever fields GET /api/hr/people/
// [id] actually returned — the server already applied lib/hr/access.ts's
// field-tier filtering, so this component never has to (and never
// could) show a field the caller isn't permitted to see.
export default function PersonDrawer({ personId, onClose }: { personId: string | null; onClose: () => void }) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    queueMicrotask(() => {
      if (!personId) { setPerson(null); return; }
      setLoading(true); setError(''); setPerson(null);
      fetch(`/api/hr/people/${personId}`)
        .then(async r => {
          const data = await r.json();
          if (!r.ok) { setError(data.error ?? 'Could not load person.'); return; }
          setPerson(data.person);
        })
        .finally(() => setLoading(false));
    });
  }, [personId]);

  return (
    <SlidePanel open={personId !== null} onClose={onClose} title="Person">
      {loading && <p style={{ color: '#6b7280', fontSize: 13 }}>Loading…</p>}
      {error && <p style={{ color: '#f87171', fontSize: 13 }}>{error}</p>}
      {person && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {person.first_name} {person.last_name}
              {person.preferred_name ? <span style={{ color: '#6b7280', fontWeight: 400 }}> ({person.preferred_name})</span> : null}
            </div>
            {person.job_title && <div style={{ color: '#9ca3af', fontSize: 13, marginTop: 2 }}>{person.job_title}</div>}
          </div>
          <Row label="Status" value={person.employment_status} />
          <Row label="Worker Type" value={person.worker_type} />
          <Row label="Team" value={person.team_name ?? '—'} />
          <Row label="Manager" value={person.manager_first_name ? `${person.manager_first_name} ${person.manager_last_name}` : '—'} />
          {'work_email' in person && <Row label="Work Email" value={person.work_email ?? '—'} />}
          {'work_phone' in person && <Row label="Work Phone" value={person.work_phone ?? '—'} />}
        </div>
      )}
    </SlidePanel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ color: '#f9fafb', fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}
