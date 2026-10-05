'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CapabilityIcon } from '@/components/brand/CapabilityIcon';
import { Metric, MetricStrip, PageHeader, Panel, StateMessage, tableStyles } from '@/components/ui/app';

// Domain category encoding (kept) — deal pipeline stages. Stages whose
// meaning matches a semantic state use the status tokens; "proposal" has
// no semantic equivalent and keeps its own category hue. Colour is only
// ever drawn as a dot beside the written stage label.
const STAGE_COLORS: Record<string, string> = { lead: 'var(--status-inactive)', qualified: 'var(--status-info)', proposal: '#f472b6', negotiation: 'var(--status-warning)', closed_won: 'var(--status-success)', closed_lost: 'var(--status-danger)' };
const TYPE_ICONS: Record<string, string> = { call: '📞', email: '✉️', note: '📝', meeting: '🤝' };

type Deal = { id: string; title: string; value: number | null; stage: string; company_name: string | null };
type Activity = { id: string; type: string; subject: string; body: string | null; activity_date: string; created_by_name: string; contact_name: string | null; company_name: string | null; deal_title: string | null };

const LIST: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0 };
const ROW_BORDER = '1px solid var(--border)';

export default function CrmOverviewPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [counts, setCounts] = useState({ companies: 0, contacts: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/crm/deals').then(r => r.json()),
      fetch('/api/crm/activities?limit=15').then(r => r.json()),
      fetch('/api/crm/companies').then(r => r.json()),
      fetch('/api/crm/contacts').then(r => r.json()),
    ]).then(([d, a, co, ct]) => {
      setDeals(d.deals ?? []);
      setActivities(a.activities ?? []);
      setCounts({ companies: (co.companies ?? []).length, contacts: (ct.contacts ?? []).length });
      setLoading(false);
    });
  }, []);

  const pipeline = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage));
  const pipelineValue = pipeline.reduce((s, d) => s + (d.value ?? 0), 0);
  const wonValue = deals.filter(d => d.stage === 'closed_won').reduce((s, d) => s + (d.value ?? 0), 0);

  return (
    <div style={{ maxWidth: 1000 }}>
      {/* Module identity moment (Phase D.4.3) — the same Users/violet
          CapabilityIcon already shown in ModuleAccessCard and TopNav for
          this capability, decorative since the heading right beside it
          already supplies the accessible name. This is the tenant's own
          `crm` capability, distinct from BrainBase HQ's app/clients/**
          and Founder OS's own internal "CRM clients" pipeline tracking —
          neither of those gets this icon. */}
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <CapabilityIcon capability="crm" size="md" />
            CRM
          </span>
        }
        description="Companies, contacts, deals & activities"
      />

      <MetricStrip style={{ marginBottom: 24 }}>
        {[
          { label: 'Companies', value: counts.companies, href: '/crm/companies' },
          { label: 'Contacts', value: counts.contacts, href: '/crm/contacts' },
          { label: 'Active Deals', value: pipeline.length, href: '/crm/deals' },
          { label: 'Pipeline Value', value: `$${pipelineValue.toLocaleString()}`, href: '/crm/deals' },
          { label: 'Won', value: `$${wonValue.toLocaleString()}`, href: '/crm/deals' },
        ].map(s => (
          <Metric
            key={s.label}
            label={<Link href={s.href} style={{ color: 'inherit' }}>{s.label}</Link>}
            value={s.value}
            loading={loading}
          />
        ))}
      </MetricStrip>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 20 }}>
        <Panel
          title="Open Deals"
          padding="none"
          actions={<Link href="/crm/deals" className={tableStyles.link} aria-label="View all deals">View all →</Link>}
        >
          {loading ? (
            <StateMessage kind="loading" title="Loading…" />
          ) : pipeline.length === 0 ? (
            <StateMessage
              kind="empty"
              title="No open deals."
              action={<Link href="/crm/deals" className={tableStyles.link}>Add one →</Link>}
            />
          ) : (
            <ul style={LIST}>
              {pipeline.slice(0, 6).map((d, i) => (
                <li key={d.id} style={{ borderTop: i > 0 ? ROW_BORDER : 'none' }}>
                  <Link
                    href="/crm/deals"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', textDecoration: 'none' }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{d.title}</span>
                      {d.company_name && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{d.company_name}</span>}
                    </span>
                    <span style={{ textAlign: 'right', flexShrink: 0 }}>
                      {d.value != null && <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${Number(d.value).toLocaleString()}</span>}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, textTransform: 'capitalize' }}>
                        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: STAGE_COLORS[d.stage] ?? 'var(--status-inactive)' }} />
                        {d.stage.replace('_', ' ')}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent Activity"
          padding="none"
          actions={<Link href="/crm/activities" className={tableStyles.link} aria-label="View all activity">View all →</Link>}
        >
          {loading ? (
            <StateMessage kind="loading" title="Loading…" />
          ) : activities.length === 0 ? (
            <StateMessage kind="empty" title="No activity yet." />
          ) : (
            <ul style={LIST}>
              {activities.slice(0, 8).map((a, i) => (
                <li key={a.id} style={{ padding: '11px 20px', borderTop: i > 0 ? ROW_BORDER : 'none' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span aria-hidden="true" style={{ fontSize: 14, flexShrink: 0 }}>{TYPE_ICONS[a.type] ?? '•'}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span className="bb-visually-hidden">{a.type}: </span>
                        {a.subject}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {a.contact_name ?? a.company_name ?? a.deal_title ?? ''} ·{' '}
                        {new Date(a.activity_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
