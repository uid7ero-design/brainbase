import Link from 'next/link';
import { getDashboardData, type DashboardWorkItem } from '@/lib/assurance/dashboard';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel, formatAssuranceDate, isPast } from '@/lib/assurance/domain';
import { resolvePageViewer } from './_components/pageAccess';
import { Badge, BORDER, Card, Dim, EmptyState, LinkButton, PageHeader, Section, StatTile } from './_components/ui';

export const dynamic = 'force-dynamic';

const HREF: Record<DashboardWorkItem['kind'], string> = {
  action: '/assurance/actions',
  finding: '/assurance/findings',
  investigation: '/assurance/investigations',
  inspection: '/assurance/inspections',
  audit: '/assurance/audits',
  incident: '/assurance/incidents',
};

export default async function AssuranceDashboardPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const data = await getDashboardData(viewer);
  const c = data.counts;
  const canRecord = viewerCan(viewer, 'record');

  return (
    <div style={{ maxWidth: 1180 }}>
      <PageHeader
        title="Assurance"
        subtitle="What needs attention across incidents, investigations, inspections and corrective work."
        actions={canRecord ? (
          <>
            <LinkButton href="/assurance/incidents/new">Report incident</LinkButton>
            <LinkButton href="/assurance/inspections/new" variant="secondary">Plan inspection</LinkButton>
          </>
        ) : undefined}
      />

      {data.isEmpty && (
        <div style={{ marginBottom: 24 }}>
          <EmptyState
            title="No assurance activity yet"
            body="When incidents are reported, inspections planned and findings raised, this dashboard shows what is overdue, what is awaiting verification and what needs attention."
            action={canRecord ? <LinkButton href="/assurance/incidents/new">Report the first incident</LinkButton> : undefined}
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 26 }}>
        <StatTile label="Overdue actions" value={c.overdue_actions} href="/assurance/actions?view=overdue" tone="danger" hint={`${c.open_actions} open in total`} />
        <StatTile label="Awaiting verification" value={c.awaiting_verification} href="/assurance/verification" tone="warning" hint={c.awaiting_evidence > 0 ? `${c.awaiting_evidence} awaiting evidence` : undefined} />
        <StatTile label="Serious open incidents" value={c.serious_open_incidents} href="/assurance/incidents?state=open" tone="danger" hint={`${c.open_incidents} open incidents`} />
        <StatTile label="Open findings" value={c.open_findings} href="/assurance/findings?state=open" tone="info" hint={c.overdue_findings > 0 ? `${c.overdue_findings} overdue` : undefined} />
        <StatTile label="Active investigations" value={c.active_investigations} href="/assurance/investigations?state=active" tone="accent" hint={c.overdue_investigations > 0 ? `${c.overdue_investigations} past target date` : undefined} />
        <StatTile label="Inspections due (7 days)" value={c.inspections_due} href="/assurance/inspections?view=due" tone="info" hint={c.inspections_in_progress > 0 ? `${c.inspections_in_progress} in progress` : undefined} />
        <StatTile label="Audits due (14 days)" value={c.audits_due} href="/assurance/audits?view=due" tone="info"
          hint={[c.audits_in_progress > 0 ? `${c.audits_in_progress} in progress` : null, c.audits_completed_30d > 0 ? `${c.audits_completed_30d} completed in 30 days` : null].filter(Boolean).join(' · ') || undefined} />
        <StatTile label="Open audit findings" value={c.open_audit_findings} href="/assurance/findings?state=open&source=audit" tone="warning" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18 }}>
        <Section title="Needs attention" count={data.attention.length}>
          <WorkList items={data.attention} dueLabel="Due" empty="Nothing is overdue or due in the next three days." showOverdue />
        </Section>
        <Section title="Awaiting verification" count={c.awaiting_verification} actions={<Link href="/assurance/verification" style={smallLink}>Open queue →</Link>}>
          <WorkList items={data.awaitingVerification} dueLabel="Work completed" empty="No corrective actions are waiting for independent verification." />
        </Section>
        <Section title="Serious incidents still open" count={c.serious_open_incidents}>
          <WorkList items={data.seriousIncidents} dueLabel="Occurred" empty="No open incidents at your two highest risk levels." detailAsBadge />
        </Section>
        <Section title="Active investigations" count={c.active_investigations}>
          <WorkList items={data.activeInvestigations} dueLabel="Target" empty="No investigations are in progress." showOverdue />
        </Section>
        <Section title="Inspections & audits due or in progress" count={data.inspectionsDue.length}>
          <WorkList items={data.inspectionsDue} dueLabel="Scheduled" empty="No inspections (next 7 days) or audits (next 14 days) are scheduled." showOverdue />
        </Section>
        <Section title="Recent incidents" actions={<Link href="/assurance/incidents" style={smallLink}>All incidents →</Link>}>
          <WorkList items={data.recentIncidents} dueLabel="Occurred" empty="No incidents have been reported." detailAsLabel />
        </Section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18, marginTop: 4 }}>
        <Section title="Open findings by type">
          <Card>
            {data.findingsByType.length === 0 ? <Dim>No open findings.</Dim> : <Bars rows={data.findingsByType.map(r => ({ label: assuranceLabel(r.finding_type), n: r.n }))} />}
          </Card>
        </Section>
        <Section title="Incidents reported — last 8 weeks">
          <Card>
            <Trend rows={data.incidentTrend.map(r => ({ label: formatAssuranceDate(r.week_start), n: r.n }))} />
          </Card>
        </Section>
      </div>
    </div>
  );
}

const smallLink = { fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none' } as const;

function WorkList({ items, dueLabel, empty, showOverdue, detailAsBadge, detailAsLabel }: {
  items: DashboardWorkItem[]; dueLabel: string; empty: string; showOverdue?: boolean; detailAsBadge?: boolean; detailAsLabel?: boolean;
}) {
  if (items.length === 0) {
    return <Card><Dim>{empty}</Dim></Card>;
  }
  return (
    <Card padded={false}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((it, i) => {
          // An in-progress inspection's scheduled time being past is not "overdue".
          const overdue = showOverdue && isPast(it.due_at) && !((it.kind === 'inspection' || it.kind === 'audit') && it.status === 'IN_PROGRESS');
          return (
            <li key={`${it.kind}-${it.id}`} style={{ borderBottom: i < items.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
              <Link href={`${HREF[it.kind]}/${it.id}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '11px 16px', textDecoration: 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--brand-brainbase-accent)' }}>{it.reference}</span>
                    <Badge value={it.status} />
                    {detailAsBadge && it.detail && <Badge value={it.detail} tone="danger" label={it.detail} />}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {it.owner_name ?? 'Unassigned'}{detailAsLabel && it.detail ? ` · ${assuranceLabel(it.detail)}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, color: overdue ? 'var(--bb-danger)' : 'var(--text-secondary)', whiteSpace: 'nowrap', fontWeight: overdue ? 600 : 400 }}>
                  <div style={{ color: 'var(--text-muted)' }}>{dueLabel}</div>
                  {it.due_at ? formatAssuranceDate(it.due_at) : '—'}
                  {overdue && <div>Overdue</div>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Bars({ rows }: { rows: { label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {rows.map(r => (
        <li key={r.label} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 32px', gap: 10, alignItems: 'center', fontSize: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
          <span aria-hidden style={{ height: 8, borderRadius: 4, background: 'color-mix(in srgb, var(--text-muted) 16%, transparent)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${(r.n / max) * 100}%`, background: 'var(--bb-chart-1)', borderRadius: 4 }} />
          </span>
          <span style={{ textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

function Trend({ rows }: { rows: { label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  const total = rows.reduce((s, r) => s + r.n, 0);
  return (
    <figure style={{ margin: 0 }}>
      <div role="img" aria-label={`Incidents per week for the last ${rows.length} weeks: ${rows.map(r => `${r.label} ${r.n}`).join(', ')}`}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
        {rows.map(r => (
          <div key={r.label} title={`Week of ${r.label}: ${r.n}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.n > 0 ? r.n : ''}</span>
            <span style={{ width: '100%', height: `${Math.max(2, (r.n / max) * 70)}px`, background: r.n > 0 ? 'var(--bb-chart-2)' : 'color-mix(in srgb, var(--text-muted) 18%, transparent)', borderRadius: 3 }} />
          </div>
        ))}
      </div>
      <figcaption style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        {total === 0 ? 'No incidents in this period.' : `${total} incident${total === 1 ? '' : 's'} · weeks starting ${rows[0]?.label} to ${rows[rows.length - 1]?.label}`}
      </figcaption>
    </figure>
  );
}
