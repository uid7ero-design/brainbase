'use client';
import { useEffect, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';
import ActivityForm from '../_components/ActivityForm';
import { Button, PageHeader, StateMessage, WorkToolbar, buttonProps } from '@/components/ui/app';

const TYPE_ICONS: Record<string, string> = { call: '📞', email: '✉️', note: '📝', meeting: '🤝' };
// Activity type tag: neutral tokens — the type is carried by its written
// label and icon, not by a per-type hue.
const TYPE_TAG: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--status-inactive-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', textTransform: 'uppercase', letterSpacing: '0.06em' };

// Selected filter chip: accent tint + accent text, exposed via aria-pressed.
const PRESSED: React.CSSProperties = {
  background: 'var(--brand-brainbase-accent-muted)',
  borderColor: 'var(--brand-brainbase-accent-border)',
  color: 'var(--brand-brainbase-accent)',
};

type Activity = { id: string; type: string; subject: string; body: string | null; activity_date: string; created_by_name: string; contact_name: string | null; company_name: string | null; deal_title: string | null };

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('');

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
      <PageHeader
        title="Activities"
        description={`${activities.length} total`}
        actions={<Button variant="primary" onClick={() => setShowAdd(true)}>+ Log</Button>}
      />

      <WorkToolbar count={filter && !loading ? `${filtered.length} of ${activities.length}` : undefined}>
        <div role="group" aria-label="Filter by activity type" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['', 'call', 'email', 'note', 'meeting'].map(t => (
            <button key={t} type="button" onClick={() => setFilter(t)} aria-pressed={filter === t}
              {...buttonProps('secondary', 'sm')}
              style={filter === t ? PRESSED : undefined}>
              {t ? <><span aria-hidden="true">{TYPE_ICONS[t]}</span> {t.charAt(0).toUpperCase() + t.slice(1)}</> : 'All'}
            </button>
          ))}
        </div>
      </WorkToolbar>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {loading && <StateMessage kind="loading" title="Loading…" />}
        {!loading && filtered.length === 0 && <StateMessage kind="empty" title="No activities yet." />}
        {filtered.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {filtered.map((a, i) => (
              <li key={a.id} style={{ padding: '16px 20px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div aria-hidden="true" style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{TYPE_ICONS[a.type]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{a.subject}</span>
                    <span style={TYPE_TAG}>{a.type}</span>
                  </div>
                  {a.body && <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 6px', lineHeight: 1.5 }}>{a.body}</p>}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {a.contact_name && <span>{a.contact_name}</span>}
                    {a.company_name && <span>{a.company_name}</span>}
                    {a.deal_title && <span>{a.deal_title}</span>}
                    <span>{new Date(a.activity_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    <span>by {a.created_by_name}</span>
                  </div>
                </div>
                <button type="button" onClick={() => deleteActivity(a.id)}
                  {...buttonProps('ghost', 'sm')}
                  style={{ flexShrink: 0 }}
                  aria-label={`Delete activity: ${a.subject}`}
                  title="Delete"><span aria-hidden="true">×</span></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Log Activity">
        <ActivityForm onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>
    </div>
  );
}
