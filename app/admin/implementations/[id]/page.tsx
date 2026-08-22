'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

// ── Client Implementations — detail (Phase 2A) ──────────────────────────
// Core record view/edit only. Deliberately does NOT include: services
// list, milestones, tasks, progress percentage, activity feed, billing,
// or Founder OS recommendations — those are later, separate slices.

const CARD = '#0e1014';
const BORDER = '#1a1d24';
const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

type Implementation = {
  id: string;
  organisation_id: string;
  organisation_name: string | null;
  name: string;
  service_type: string | null;
  stage: string;
  health: 'on_track' | 'at_risk' | 'blocked';
  owner_user_id: string | null;
  owner_name: string | null;
  target_launch_date: string | null;
  actual_launch_date: string | null;
  summary: string | null;
  next_action: string | null;
  source_lead_id: string | null;
  source_proposal_id: string | null;
  created_at: string;
  updated_at: string;
};

type UserOption = { id: string; name: string };

const STAGE_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'discovery', label: 'Discovery' },
  { value: 'setup', label: 'Setup' },
  { value: 'build', label: 'Build' },
  { value: 'client_review', label: 'Client Review' },
  { value: 'testing', label: 'Testing' },
  { value: 'ready_to_launch', label: 'Ready to Launch' },
  { value: 'live', label: 'Live' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'cancelled', label: 'Cancelled' },
];
const HEALTH_OPTIONS = [
  { value: 'on_track', label: 'On Track', color: '#34d399' },
  { value: 'at_risk', label: 'At Risk', color: '#f59e0b' },
  { value: 'blocked', label: 'Blocked', color: '#f87171' },
];

const labelStyle: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', background: '#111318', border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 14, boxSizing: 'border-box', fontFamily: FONT };
const errorStyle: React.CSSProperties = { color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 };
const successStyle: React.CSSProperties = { color: '#34d399', fontSize: 13, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 };
function btnStyle(bg: string): React.CSSProperties { return { padding: '9px 18px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }
function field(label: string, node: React.ReactNode) {
  return <div><label style={labelStyle}>{label}</label>{node}</div>;
}

export default function ImplementationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [impl, setImpl] = useState<Implementation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);

  // Editable field state, hydrated once the record loads.
  const [name, setName] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [stage, setStage] = useState('planning');
  const [health, setHealth] = useState('on_track');
  const [ownerId, setOwnerId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [actualDate, setActualDate] = useState('');
  const [summary, setSummary] = useState('');
  const [nextAction, setNextAction] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/implementations/${params.id}`)
      .then(async r => {
        if (r.status === 404) { setNotFound(true); return null; }
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: { implementation?: Implementation } | null) => {
        if (!d?.implementation) return;
        const i = d.implementation;
        setImpl(i);
        setName(i.name);
        setServiceType(i.service_type ?? '');
        setStage(i.stage);
        setHealth(i.health);
        setOwnerId(i.owner_user_id ?? '');
        setTargetDate(i.target_launch_date ? i.target_launch_date.slice(0, 10) : '');
        setActualDate(i.actual_launch_date ? i.actual_launch_date.slice(0, 10) : '');
        setSummary(i.summary ?? '');
        setNextAction(i.next_action ?? '');
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));

    fetch('/api/admin/users').then(r => (r.ok ? r.json() : { users: [] })).then(d => setUsers(d.users ?? [])).catch(() => {});
  }, [params.id]);

  async function save() {
    setSaveError(null);
    setSaved(false);
    if (!name.trim()) { setSaveError('Implementation name is required.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/implementations/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          service_type: serviceType.trim(),
          stage,
          health,
          owner_user_id: ownerId || null,
          target_launch_date: targetDate,
          actual_launch_date: actualDate,
          summary,
          next_action: nextAction,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error ?? 'Could not save changes.'); return; }
      setImpl(data.implementation);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setSaveError('Could not save changes.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={{ fontFamily: FONT, color: '#9ca3af', fontSize: 14 }}>Loading…</div>;
  }
  if (notFound) {
    return (
      <div style={{ fontFamily: FONT, color: '#f9fafb', maxWidth: 600 }}>
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Implementation not found.</p>
        <button onClick={() => router.push('/admin/implementations')} style={btnStyle('#1f2937')}>← Back to Implementations</button>
      </div>
    );
  }
  if (loadError || !impl) {
    return <p style={errorStyle}>Couldn&apos;t load this implementation. Try refreshing.</p>;
  }

  return (
    <div style={{ maxWidth: 720, fontFamily: FONT, color: '#f9fafb' }}>
      <button onClick={() => router.push('/admin/implementations')} style={{ ...btnStyle('transparent'), color: '#6b7280', padding: '0 0 16px', fontWeight: 400 }}>← Back to Implementations</button>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          {impl.organisation_name ?? 'Unknown organisation'}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{impl.name}</h1>
      </div>

      {saveError && <p style={{ ...errorStyle, marginBottom: 16 }}>{saveError}</p>}
      {saved && <p style={{ ...successStyle, marginBottom: 16 }}>Saved.</p>}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {field('Client / organisation', (
            <div style={{ ...inputStyle, color: '#6b7280', cursor: 'not-allowed' }}>{impl.organisation_name ?? impl.organisation_id}</div>
          ))}
          {field('Implementation name', (
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
          ))}
          {field('Service type', (
            <input value={serviceType} onChange={e => setServiceType(e.target.value)} style={inputStyle} placeholder="e.g. Website" />
          ))}
          {field('Owner', (
            <select value={ownerId} onChange={e => setOwnerId(e.target.value)} style={inputStyle}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          ))}
          {field('Stage', (
            <select value={stage} onChange={e => setStage(e.target.value)} style={inputStyle}>
              {STAGE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          ))}
          {field('Health', (
            <select value={health} onChange={e => setHealth(e.target.value)} style={{ ...inputStyle, color: HEALTH_OPTIONS.find(h => h.value === health)?.color }}>
              {HEALTH_OPTIONS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          ))}
          {field('Target launch date', (
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} style={inputStyle} />
          ))}
          {field('Actual launch date', (
            <input type="date" value={actualDate} onChange={e => setActualDate(e.target.value)} style={inputStyle} />
          ))}
        </div>

        {field('Summary', (
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        ))}
        {field('Next action', (
          <textarea value={nextAction} onChange={e => setNextAction(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        ))}

        {(impl.source_lead_id || impl.source_proposal_id) && (
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 14, fontSize: 12, color: '#6b7280' }}>
            {impl.source_lead_id && <div>Sourced from Web Systems lead: <span style={{ color: '#9ca3af' }}>{impl.source_lead_id}</span></div>}
            {impl.source_proposal_id && <div>Sourced from proposal: <span style={{ color: '#9ca3af' }}>{impl.source_proposal_id}</span></div>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} disabled={saving} style={btnStyle('#1a6aff')}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}
