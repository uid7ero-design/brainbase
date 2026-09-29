import Link from 'next/link';
import type { ReactNode } from 'react';
import { getDashboardData, type DashboardWorkItem } from '@/lib/assurance/dashboard';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel, formatAssuranceDate, isPast } from '@/lib/assurance/domain';
import { Metric, MetricStrip, Panel, StateMessage, tableStyles, type MetricTone } from '@/components/ui/app';
import { resolvePageViewer } from './_components/pageAccess';
import { Badge, EmptyState, LinkButton, PageHeader, assuranceStyles as styles } from './_components/ui';

export const dynamic = 'force-dynamic';

const HREF: Record<DashboardWorkItem['kind'], string> = {
  action: '/assurance/actions',
  finding: '/assurance/findings',
  investigation: '/assurance/investigations',
  inspection: '/assurance/inspections',
  audit: '/assurance/audits',
  incident: '/assurance/incidents',
};

// "What needs attention?" — the counts sit in one shared MetricStrip. A
// count is only coloured when it is non-zero and carries a status meaning
// (overdue, serious, awaiting); each label links to the filtered register.
type Tile = { label: string; value: number; href: string; tone?: MetricTone; sub?: string };

export default async function AssuranceDashboardPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const data = await getDashboardData(viewer);
  const c = data.counts;
  const canRecord = viewerCan(viewer, 'record');

  const tiles: Tile[] = [
    { label: 'Overdue actions', value: c.overdue_actions, href: '/assurance/actions?view=overdue', tone: 'danger', sub: `${c.open_actions} open in total` },
    { label: 'Awaiting verification', value: c.awaiting_verification, href: '/assurance/verification', tone: 'warning', sub: c.awaiting_evidence > 0 ? `${c.awaiting_evidence} awaiting evidence` : undefined },
    { label: 'Serious open incidents', value: c.serious_open_incidents, href: '/assurance/incidents?state=open', tone: 'danger', sub: `${c.open_incidents} open incidents` },
    { label: 'Active investigations', value: c.active_investigations, href: '/assurance/investigations?state=active', sub: c.overdue_investigations > 0 ? `${c.overdue_investigations} past target date` : undefined },
    { label: 'Inspections due (7 days)', value: c.inspections_due, href: '/assurance/inspections?view=due', tone: 'info', sub: c.inspections_in_progress > 0 ? `${c.inspections_in_progress} in progress` : undefined },
    {
      label: 'Audits due (14 days)', value: c.audits_due, href: '/assurance/audits?view=due', tone: 'info',
      sub: [c.audits_in_progress > 0 ? `${c.audits_in_progress} in progress` : null, c.audits_completed_30d > 0 ? `${c.audits_completed_30d} completed in 30 days` : null].filter(Boolean).join(' · ') || undefined,
    },
    { label: 'Open findings', value: c.open_findings, href: '/assurance/findings?state=open', tone: 'info', sub: c.overdue_findings > 0 ? `${c.overdue_findings} overdue` : undefined },
    { label: 'Open audit findings', value: c.open_audit_findings, href: '/assurance/findings?state=open&source=audit', tone: 'warning' },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Assurance"
        subtitle="What needs attention across incidents, investigations, inspections, audits and corrective work."
        actions={canRecord ? (
          <>
            <LinkButton href="/assurance/inspections/new" variant="secondary">Plan inspection</LinkButton>
            <LinkButton href="/assurance/incidents/new">Report incident</LinkButton>
          </>
        ) : undefined}
      />

      {data.isEmpty && (
        <div style={{ marginBottom: 20 }}>
          <EmptyState
            title="No assurance activity yet"
            body="When incidents are reported, inspections planned and findings raised, this dashboard shows what is overdue, what is awaiting verification and what needs attention."
            action={canRecord ? <LinkButton href="/assurance/incidents/new">Report the first incident</LinkButton> : undefined}
          />
        </div>
      )}

      <section aria-labelledby="attention-counts" style={{ marginBottom: 24 }}>
        <h2 id="attention-counts" className="bb-visually-hidden">What needs attention</h2>
        {/* Eight counts: an even 4 × 2 on wide screens, 2 per row on phones
            (never a lone count on its own row). */}
        <MetricStrip style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(max(148px, calc((100% - 1px) / 4)), 1fr))' }}>
          {tiles.map(t => (
            <Metric
              key={t.label}
              label={<Link href={t.href} style={{ color: 'inherit' }}>{t.label}</Link>}
              value={t.value}
              tone={t.value > 0 ? t.tone : undefined}
              sub={t.sub}
            />
          ))}
        </MetricStrip>
      </section>

      <div className={styles.grid2}>
        <WorkPanel title="Needs attention" count={data.attention.length}>
          <WorkList items={data.attention} dueLabel="Due" empty="Nothing is overdue or due in the next three days." showOverdue />
        </WorkPanel>
        <WorkPanel title="Awaiting verification" count={c.awaiting_verification} href="/assurance/verification" linkLabel="Open queue →">
          <WorkList items={data.awaitingVerification} dueLabel="Work completed" empty="No corrective actions are waiting for independent verification." />
        </WorkPanel>
        <WorkPanel title="Serious incidents still open" count={c.serious_open_incidents}>
          <WorkList items={data.seriousIncidents} dueLabel="Occurred" empty="No open incidents at your two highest risk levels." detailAsBadge />
        </WorkPanel>
        <WorkPanel title="Active investigations" count={c.active_investigations}>
          <WorkList items={data.activeInvestigations} dueLabel="Target" empty="No investigations are in progress." showOverdue />
        </WorkPanel>
        <WorkPanel title="Inspections & audits due or in progress" count={data.inspectionsDue.length}>
          <WorkList items={data.inspectionsDue} dueLabel="Scheduled" empty="No inspections (next 7 days) or audits (next 14 days) are scheduled." showOverdue />
        </WorkPanel>
        <WorkPanel title="Recent incidents" href="/assurance/incidents" linkLabel="All incidents →">
          <WorkList items={data.recentIncidents} dueLabel="Occurred" empty="No incidents have been reported." detailAsLabel />
        </WorkPanel>
        <Panel title="Open findings by type">
          {data.findingsByType.length === 0
            ? <StateMessage kind="empty" title="No open findings." />
            : <Bars rows={data.findingsByType.map(r => ({ label: assuranceLabel(r.finding_type), n: r.n }))} />}
        </Panel>
        <Panel title="Incidents reported — last 8 weeks">
          <Trend rows={data.incidentTrend.map(r => ({ label: formatAssuranceDate(r.week_start), n: r.n }))} />
        </Panel>
      </div>
    </div>
  );
}

function WorkPanel({ title, count, href, linkLabel, children }: { title: string; count?: number; href?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <Panel
      title={<>{title}{typeof count === 'number' && <span className={styles.sectionCount} style={{ marginLeft: 8 }}>{count}</span>}</>}
      padding="none"
      actions={href ? <Link href={href} className={tableStyles.link}>{linkLabel}</Link> : undefined}
    >
      {children}
    </Panel>
  );
}

function WorkList({ items, dueLabel, empty, showOverdue, detailAsBadge, detailAsLabel }: {
  items: DashboardWorkItem[]; dueLabel: string; empty: string; showOverdue?: boolean; detailAsBadge?: boolean; detailAsLabel?: boolean;
}) {
  if (items.length === 0) {
    return <StateMessage kind="empty" title={empty} />;
  }
  return (
    <ul className={styles.workList}>
      {items.map(it => {
        // An in-progress inspection's scheduled time being past is not "overdue".
        const overdue = showOverdue && isPast(it.due_at) && !((it.kind === 'inspection' || it.kind === 'audit') && it.status === 'IN_PROGRESS');
        return (
          <li key={`${it.kind}-${it.id}`}>
            <Link href={`${HREF[it.kind]}/${it.id}`} className={styles.workLink}>
              <div className={styles.workMain}>
                <div className={styles.workMeta}>
                  <span className={styles.recordRef}>{it.reference}</span>
                  <Badge value={it.status} />
                  {detailAsBadge && it.detail && <Badge value={it.detail} tone="danger" label={it.detail} />}
                </div>
                <div className={styles.workTitle}>{it.title}</div>
                <div className={styles.workSub}>
                  {it.owner_name ?? 'Unassigned'}{detailAsLabel && it.detail ? ` · ${assuranceLabel(it.detail)}` : ''}
                </div>
              </div>
              <div className={styles.workDue} data-overdue={overdue || undefined}>
                <div className={styles.workDueLabel}>{dueLabel}</div>
                {it.due_at ? formatAssuranceDate(it.due_at) : '—'}
                {overdue && <div>Overdue</div>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Bars({ rows }: { rows: { label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <ul className={styles.bars}>
      {rows.map(r => (
        <li key={r.label}>
          <span className={styles.barLabel}>{r.label}</span>
          <span aria-hidden className={styles.barTrack}>
            <span className={styles.barFill} style={{ width: `${(r.n / max) * 100}%` }} />
          </span>
          <span className={styles.barValue}>{r.n}</span>
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
      <div role="img" aria-label={`Incidents per week for the last ${rows.length} weeks: ${rows.map(r => `${r.label} ${r.n}`).join(', ')}`} className={styles.trend}>
        {rows.map(r => (
          <div key={r.label} title={`Week of ${r.label}: ${r.n}`} className={styles.trendCol}>
            <span className={styles.trendN}>{r.n > 0 ? r.n : ''}</span>
            <span className={styles.trendBar} data-empty={r.n === 0 || undefined} style={{ height: `${Math.max(2, (r.n / max) * 70)}px` }} />
          </div>
        ))}
      </div>
      <figcaption className={styles.caption}>
        {total === 0 ? 'No incidents in this period.' : `${total} incident${total === 1 ? '' : 's'} · weeks starting ${rows[0]?.label} to ${rows[rows.length - 1]?.label}`}
      </figcaption>
    </figure>
  );
}
