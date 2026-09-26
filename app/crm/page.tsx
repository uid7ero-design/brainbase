'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CapabilityIcon } from '@/components/brand/CapabilityIcon';
import { SectionHeader, Surface, TextLink } from '@/components/ui';
const STAGE_COLORS: Record<string, string> = { lead: '#6b7280', qualified: '#60a5fa', proposal: '#a78bfa', negotiation: '#fbbf24', closed_won: '#34d399', closed_lost: '#f87171' };
const TYPE_ICONS: Record<string, string> = { call: '📞', email: '✉️', note: '📝', meeting: '🤝' };

type Deal = { id: string; title: string; value: number | null; stage: string; company_name: string | null };
type Activity = { id: string; type: string; subject: string; body: string | null; activity_date: string; created_by_name: string; contact_name: string | null; company_name: string | null; deal_title: string | null };

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bb-space-4)', marginBottom: 'var(--bb-space-8)' }}>
        {/* Module identity moment (Phase D.4.3) — the same Users/violet
            CapabilityIcon already shown in ModuleAccessCard and TopNav for
            this capability, decorative since the heading right beside it
            already supplies the accessible name. This is the tenant's own
            `crm` capability, distinct from BrainBase HQ's app/clients/**
            and Founder OS's own internal "CRM clients" pipeline tracking —
            neither of those gets this icon. */}
        <CapabilityIcon capability="crm" size="md" />
        <SectionHeader title="CRM" description="Companies, contacts, deals & activities" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--bb-space-5)', marginBottom: 'var(--bb-space-8)' }}>
        {[
          { label: 'Companies', value: counts.companies, href: '/crm/companies', color: '#60a5fa' },
          { label: 'Contacts', value: counts.contacts, href: '/crm/contacts', color: '#a78bfa' },
          { label: 'Active Deals', value: pipeline.length, href: '/crm/deals', color: '#fbbf24' },
          { label: 'Pipeline Value', value: `$${pipelineValue.toLocaleString()}`, href: '/crm/deals', color: '#34d399' },
          { label: 'Won', value: `$${wonValue.toLocaleString()}`, href: '/crm/deals', color: '#34d399' },
        ].map(s => (
          <Link
            key={s.label}
            href={s.href}
            style={{ textDecoration: 'none', display: 'block' }}
          >
            <Surface variant="base" radius="lg" style={{ padding: 'var(--bb-space-6)' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{loading ? '—' : s.value}</div>
              <div style={{ fontSize: 'var(--bb-type-label-size)', color: 'var(--bb-text-tertiary)', marginTop: 'var(--bb-space-2)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {s.label}
              </div>
            </Surface>
          </Link>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--bb-space-6)' }}>
        <Surface variant="base" radius="xl" style={{ overflow: 'hidden' }}>
          <div style={{ padding: 'var(--bb-space-6) var(--bb-space-7)', borderBottom: '1px solid var(--bb-border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Open Deals</span>
            <TextLink href="/crm/deals" tone="muted" style={{ fontSize: 'var(--bb-type-body-sm-size)' }}>View all →</TextLink>
          </div>
          {loading ? (
            <p style={{ padding: 'var(--bb-space-7)', color: 'var(--bb-text-muted)', fontSize: 'var(--bb-type-body-size)' }}>Loading…</p>
          ) : pipeline.length === 0 ? (
            <p style={{ padding: 'var(--bb-space-7)', color: 'var(--bb-text-muted)', fontSize: 'var(--bb-type-body-size)' }}>
              No open deals. <TextLink href="/crm/deals">Add one →</TextLink>
            </p>
          ) : (
            pipeline.slice(0, 6).map((d, i) => (
              <Link
                key={d.id}
                href="/crm/deals"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: i < Math.min(pipeline.length, 6) - 1 ? '1px solid var(--bb-border-default)' : 'none', textDecoration: 'none' }}
              >
                <div>
                  <div style={{ fontSize: 13, color: 'var(--bb-text-primary)', fontWeight: 500 }}>{d.title}</div>
                  {d.company_name && <div style={{ fontSize: 11, color: 'var(--bb-text-tertiary)', marginTop: 2 }}>{d.company_name}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {d.value != null && <div style={{ fontSize: 13, fontWeight: 600, color: STAGE_COLORS[d.stage] }}>${Number(d.value).toLocaleString()}</div>}
                  <div style={{ fontSize: 11, color: 'var(--bb-text-muted)', marginTop: 2, textTransform: 'capitalize' }}>{d.stage.replace('_', ' ')}</div>
                </div>
              </Link>
            ))
          )}
        </Surface>

        <Surface variant="base" radius="xl" style={{ overflow: 'hidden' }}>
          <div style={{ padding: 'var(--bb-space-6) var(--bb-space-7)', borderBottom: '1px solid var(--bb-border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Recent Activity</span>
            <TextLink href="/crm/activities" tone="muted" style={{ fontSize: 'var(--bb-type-body-sm-size)' }}>View all →</TextLink>
          </div>
          {loading ? (
            <p style={{ padding: 'var(--bb-space-7)', color: 'var(--bb-text-muted)', fontSize: 'var(--bb-type-body-size)' }}>Loading…</p>
          ) : activities.length === 0 ? (
            <p style={{ padding: 'var(--bb-space-7)', color: 'var(--bb-text-muted)', fontSize: 'var(--bb-type-body-size)' }}>No activity yet.</p>
          ) : (
            activities.slice(0, 8).map((a, i) => (
              <div key={a.id} style={{ padding: '11px 20px', borderBottom: i < Math.min(activities.length, 8) - 1 ? '1px solid var(--bb-border-default)' : 'none' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{TYPE_ICONS[a.type] ?? '•'}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--bb-text-primary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.subject}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--bb-text-tertiary)', marginTop: 2 }}>
                      {a.contact_name ?? a.company_name ?? a.deal_title ?? ''} ·{' '}
                      {new Date(a.activity_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </Surface>
      </div>
    </div>
  );
}
