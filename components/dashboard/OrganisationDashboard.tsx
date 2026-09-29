'use client';

// Phase C.2C — the generic tenant organisation dashboard. Renders at the
// /dashboard fallthrough (app/dashboard/page.tsx) for any organisation
// that is neither Brainbase HQ (redirected to /admin/founder) nor LD
// Tennis (TennisDashboard) — replacing the old <BrainBase /> render there.
//
// Deliberately NOT a copy of app/dashboard/overview/OverviewClient.tsx,
// even though it reuses the exact same real, organisation-scoped SQL
// shape (waste_records/fleet_metrics/service_requests, WHERE
// organisation_id = oid, COALESCE(...,0) fallbacks) — that existing page
// is untouched by this phase (it has real consumers: DashboardShell's own
// breadcrumb and OnboardingWizard both link to it directly). Its own
// presentation, however, is NOT reused as-is: every one of its 6 metric
// cards, its Waste/Fleet cost-trend chart, and its hardcoded "Service
// Dashboards: Waste/Fleet/Water/Roads/Parks/Labour" quick-nav strip render
// UNCONDITIONALLY for every organisation regardless of whether that
// data source has any real rows — exactly the "waste dashboard shown to a
// non-waste tenant" problem this phase exists to avoid, even though no
// individual number there is fabricated. This component instead only
// renders a metric section when its underlying table genuinely has rows
// for this organisation, and has no hardcoded municipal quick-nav at all.
// Phase D2 — presentation moved onto the shared app system (PageHeader,
// MetricStrip/Metric, Panel, StateMessage, semantic Badge). Data flags,
// thresholds and values are unchanged; the page reads top-down as org
// context → exceptions → key metrics → module access. The three
// thresholds below are the ones that already coloured these tiles; they
// are named once so the metric tone and the exception line cannot drift.
import { Badge, MetricStrip, Metric, PageHeader, Panel, StateMessage, buttonProps } from '@/components/ui/app';
import { ModuleAccessCard } from './ModuleAccessCard';
import styles from './OrganisationDashboard.module.css';

const CONTAMINATION_THRESHOLD = 10; // %
const DEFECT_THRESHOLD = 5;
const OPEN_REQUEST_THRESHOLD = 20;

type OperationalRow = Record<string, number>;
type SRRow = { status: string; count: number; avg_days: number };

interface Props {
  orgName?: string;
  enabledCapabilities: string[];
  /** Real signed-in role — lets "Your tools" offer role-gated modules. */
  role?: string;
  waste: OperationalRow;
  fleet: OperationalRow;
  serviceRequests: SRRow[];
}

function fmt(n: number) {
  if (!n) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

type Exception = { key: string; state: 'error' | 'warning'; label: string; text: string };

export default function OrganisationDashboard({ orgName, enabledCapabilities, role, waste, fleet, serviceRequests }: Props) {
  const wasteCost    = Number(waste.total_cost ?? 0);
  const totalTonnes  = Number(waste.total_tonnes ?? 0);
  const avgContam    = Number(waste.avg_contamination ?? 0);
  const hasWasteData = wasteCost > 0 || totalTonnes > 0;

  const fleetCost     = Number(fleet.total_fuel ?? 0) + Number(fleet.total_maintenance ?? 0) + Number(fleet.total_wages ?? 0);
  const vehicleCount  = Number(fleet.vehicle_count ?? 0);
  const totalDefects  = Number(fleet.total_defects ?? 0);
  const hasFleetData  = fleetCost > 0 || vehicleCount > 0;

  const openCount    = serviceRequests.find(r => r.status === 'Open')?.count ?? 0;
  const closedCount  = serviceRequests.find(r => r.status === 'Closed')?.count ?? 0;
  const pendingCount = serviceRequests.find(r => r.status === 'Pending')?.count ?? 0;
  const avgDays      = serviceRequests.find(r => r.status === 'Open')?.avg_days ?? 0;
  const hasSRData    = openCount > 0 || closedCount > 0 || pendingCount > 0;

  const hasOperationalData = hasWasteData || hasFleetData || hasSRData;
  const hasAnyCapability   = enabledCapabilities.length > 0;

  const contamHigh   = hasWasteData && avgContam > CONTAMINATION_THRESHOLD;
  const defectsHigh  = hasFleetData && totalDefects > DEFECT_THRESHOLD;
  const requestsHigh = hasSRData && openCount > OPEN_REQUEST_THRESHOLD;

  const exceptions: Exception[] = [
    ...(contamHigh ? [{ key: 'contam', state: 'error' as const, label: 'Above threshold', text: `Contamination averaging ${avgContam.toFixed(1)}% (threshold ${CONTAMINATION_THRESHOLD}%)` }] : []),
    ...(defectsHigh ? [{ key: 'defects', state: 'error' as const, label: 'Above threshold', text: `${totalDefects} fleet defects (threshold ${DEFECT_THRESHOLD})` }] : []),
    ...(requestsHigh ? [{ key: 'requests', state: 'warning' as const, label: 'Backlog', text: `${openCount} open service requests (threshold ${OPEN_REQUEST_THRESHOLD})` }] : []),
  ];

  return (
    <div className={styles.page} style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>

      <PageHeader
        title="Dashboard"
        description={orgName}
        actions={<a href="/hlna" {...buttonProps('secondary', 'sm')}>Open HLNA</a>}
      />

      {/* ── Operational overview — real, organisation-scoped data only.
          Each metric group renders only when its own table genuinely has
          rows for this organisation; nothing here is a default/demo value. ── */}
      {hasOperationalData ? (
        <section className={styles.section} aria-labelledby="org-dashboard-ops">
          <h2 id="org-dashboard-ops" className={styles.sectionTitle}>Operational Overview</h2>

          {exceptions.length > 0 && (
            <ul className={styles.exceptions} aria-label="Needs attention">
              {exceptions.map(e => (
                <li key={e.key} className={styles.exception}>
                  <Badge state={e.state}>{e.label}</Badge>
                  <span>{e.text}</span>
                </li>
              ))}
            </ul>
          )}

          <MetricStrip>
            {hasWasteData && (
              <>
                <Metric label="Waste Cost" value={fmt(wasteCost)} sub={totalTonnes > 0 ? `${totalTonnes.toLocaleString('en-AU', { maximumFractionDigits: 0 })} tonnes` : undefined} />
                <Metric label="Contamination" value={avgContam > 0 ? `${avgContam.toFixed(1)}%` : '—'} sub="Avg across suburbs" tone={contamHigh ? 'danger' : undefined} />
              </>
            )}
            {hasFleetData && (
              <>
                <Metric label="Fleet Cost" value={fmt(fleetCost)} sub={vehicleCount > 0 ? `${vehicleCount} vehicles active` : undefined} />
                <Metric label="Fleet Defects" value={totalDefects > 0 ? String(totalDefects) : '—'} sub={vehicleCount > 0 ? `across ${vehicleCount} vehicles` : undefined} tone={defectsHigh ? 'danger' : undefined} />
              </>
            )}
            {hasSRData && (
              <>
                <Metric label="Open Requests" value={String(openCount)} sub={avgDays > 0 ? `avg ${avgDays.toFixed(1)} days open` : undefined} tone={requestsHigh ? 'warning' : undefined} />
                <Metric label="Closed Requests" value={String(closedCount)} />
              </>
            )}
          </MetricStrip>
        </section>
      ) : (
        <Panel className={styles.section}>
          <StateMessage kind="empty" title="No operational metrics available yet">
            Metrics will appear here once operational data is available for your organisation.
          </StateMessage>
        </Panel>
      )}

      {/* ── Your Tools (capability-gated module entry points) ── */}
      {hasAnyCapability && (
        <div className={styles.section}>
          <ModuleAccessCard enabledCapabilities={enabledCapabilities} role={role} />
        </div>
      )}
    </div>
  );
}
