'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

const CARD = '#0e1014'; const BORDER = '#1a1d24';
const STAGE_COLORS: Record<string, string> = { lead:'#6b7280', qualified:'#60a5fa', proposal:'#a78bfa', negotiation:'#fbbf24', closed_won:'#34d399', closed_lost:'#f87171' };
const TYPE_ICONS: Record<string, string> = { call: '📞', email: '✉️', note: '📝', meeting: '🤝' };

type Deal     = { id: string; title: string; value: number | null; stage: string; company_name: string | null };
type Activity = { id: string; type: string; subject: string; body: string | null; activity_date: string; created_by_name: string; contact_name: string | null; company_name: string | null; deal_title: string | null };

export default function CrmDashboard() {
  const [deals, setDeals]         = useState<Deal[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [counts, setCounts]       = useState({ companies: 0, contacts: 0, deals: 0 });
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/crm/deals').then(r => r.json()),
      fetch('/api/crm/activities?limit=15').then(r => r.json()),
      fetch('/api/crm/companies').then(r => r.json()),
      fetch('/api/crm/contacts').then(r => r.json()),
    ]).then(([d, a, co, ct]) => {
      setDeals(d.deals ?? []);
      setActivities(a.activities ?? []);
      setCounts({ companies: (co.companies ?? []).length, contacts: (ct.contacts ?? []).length, deals: (d.deals ?? []).length });
      setLoading(false);
    });
  }, []);

  const pipeline = deals.filter(d => !['closed_won','closed_lost'].includes(d.stage));
  const pipelineValue = pipeline.reduce((s, d) => s + (d.value ?? 0), 0);
  const wonValue      = deals.filter(d => d.stage === 'closed_won').reduce((s, d) => s + (d.value ?? 0), 0);

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>CRM</h1>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>Sales pipeline and relationship management</p>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
        {[
          { label: 'Companies',      value: counts.companies, href: '/crm/companies', color: '#60a5fa' },
          { label: 'Contacts',       value: counts.contacts,  href: '/crm/contacts',  color: '#a78bfa' },
          { label: 'Active Deals',   value: pipeline.length,  href: '/crm/deals',     color: '#fbbf24' },
          { label: 'Pipeline Value', value: `$${pipelineValue.toLocaleString()}`, href: '/crm/deals', color: '#34d399' },
          { label: 'Won',            value: `$${wonValue.toLocaleString()}`,      href: '/crm/deals', color: '#34d399' },
        ].map(s => (
          <Link key={s.label} href={s.href} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '16px 18px', textDecoration: 'none', display: 'block' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{loading ? '—' : s.value}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
          </Link>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Open deals */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Open Deals</span>
            <Link href="/crm/deals" style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>View all →</Link>
          </div>
          {loading ? <p style={{ padding: 20, color: '#4b5563', fontSize: 13 }}>Loading…</p> : pipeline.length === 0 ? (
            <p style={{ padding: 20, color: '#4b5563', fontSize: 13 }}>No open deals. <Link href="/crm/deals" style={{ color: '#1a6aff', textDecoration: 'none' }}>Add one →</Link></p>
          ) : pipeline.slice(0, 6).map((d, i) => (
            <Link key={d.id} href={`/crm/deals`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: i < Math.min(pipeline.length, 6) - 1 ? `1px solid ${BORDER}` : 'none', textDecoration: 'none' }}>
              <div>
                <div style={{ fontSize: 13, color: '#f9fafb', fontWeight: 500 }}>{d.title}</div>
                {d.company_name && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{d.company_name}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                {d.value != null && <div style={{ fontSize: 13, fontWeight: 600, color: STAGE_COLORS[d.stage] }}>${Number(d.value).toLocaleString()}</div>}
                <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2, textTransform: 'capitalize' }}>{d.stage.replace('_', ' ')}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Recent activity */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Recent Activity</span>
            <Link href="/crm/activities" style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>View all →</Link>
          </div>
          {loading ? <p style={{ padding: 20, color: '#4b5563', fontSize: 13 }}>Loading…</p> : activities.length === 0 ? (
            <p style={{ padding: 20, color: '#4b5563', fontSize: 13 }}>No activity yet.</p>
          ) : activities.slice(0, 8).map((a, i) => (
            <div key={a.id} style={{ padding: '11px 20px', borderBottom: i < Math.min(activities.length, 8) - 1 ? `1px solid ${BORDER}` : 'none' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{TYPE_ICONS[a.type] ?? '•'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#f9fafb', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.subject}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {a.contact_name ?? a.company_name ?? a.deal_title ?? ''} · {new Date(a.activity_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
