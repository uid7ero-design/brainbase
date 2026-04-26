'use client';
import { useEffect, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';
import ActivityForm from '../_components/ActivityForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';
const TYPE_ICONS: Record<string, string> = { call: '📞', email: '✉️', note: '📝', meeting: '🤝' };
const TYPE_COLORS: Record<string, string> = { call: '#60a5fa', email: '#a78bfa', note: '#9ca3af', meeting: '#34d399' };

type Activity = { id: string; type: string; subject: string; body: string | null; activity_date: string; created_by_name: string; contact_name: string | null; company_name: string | null; deal_title: string | null };

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showAdd, setShowAdd]       = useState(false);
  const [filter, setFilter]         = useState('');

  async function load() {
    const res = await fetch('/api/crm/activities?limit=100');
    if (res.ok) setActivities((await res.json()).activities);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function deleteActivity(id: string) {
    if (!confirm('Delete this activity?')) return;
    await fetch(`/api/crm/activities/${id}`, { method: 'DELETE' });
    setActivities(a => a.filter(x => x.id !== id));
  }

  const filtered = activities.filter(a => !filter || a.type === filter);

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Activities</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>{activities.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {['', 'call', 'email', 'note', 'meeting'].map(t => (
            <button key={t} onClick={() => setFilter(t)}
              style={{ padding: '6px 12px', background: filter === t ? '#1a6aff' : CARD, color: filter === t ? '#fff' : '#9ca3af', border: `1px solid ${BORDER}`, borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
              {t ? `${TYPE_ICONS[t]} ${t.charAt(0).toUpperCase() + t.slice(1)}` : 'All'}
            </button>
          ))}
          <button onClick={() => setShowAdd(true)} style={{ padding: '6px 14px', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', marginLeft: 4 }}>+ Log</button>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
        {loading && <p style={{ padding: 32, color: '#4b5563', textAlign: 'center', fontSize: 14 }}>Loading…</p>}
        {!loading && filtered.length === 0 && <p style={{ padding: 32, color: '#4b5563', textAlign: 'center', fontSize: 14 }}>No activities yet.</p>}
        {filtered.map((a, i) => (
          <div key={a.id} style={{ padding: '16px 20px', borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{TYPE_ICONS[a.type]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#f9fafb' }}>{a.subject}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: TYPE_COLORS[a.type], background: `${TYPE_COLORS[a.type]}18`, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{a.type}</span>
              </div>
              {a.body && <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 6px', lineHeight: 1.5 }}>{a.body}</p>}
              <div style={{ fontSize: 11, color: '#4b5563', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {a.contact_name && <span>{a.contact_name}</span>}
                {a.company_name && <span>{a.company_name}</span>}
                {a.deal_title   && <span>{a.deal_title}</span>}
                <span>{new Date(a.activity_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <span>by {a.created_by_name}</span>
              </div>
            </div>
            <button onClick={() => deleteActivity(a.id)}
              style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}
              title="Delete">×</button>
          </div>
        ))}
      </div>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Log Activity">
        <ActivityForm onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>
    </div>
  );
}
