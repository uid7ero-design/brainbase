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
import { useState } from 'react';
import { ModuleAccessCard } from './ModuleAccessCard';

const FONT = "var(--font-inter), -apple-system, sans-serif";

type OperationalRow = Record<string, number>;
type SRRow = { status: string; count: number; avg_days: number };

interface Props {
  orgName?: string;
  enabledCapabilities: string[];
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

function MetricCard({ label, value, sub, accent = '#A78BFA', icon }: {
  label: string; value: string; sub?: string; accent?: string; icon?: string;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderTop: `2px solid ${accent}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.40)' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#F4F4F5', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', lineHeight: 1.3 }}>{sub}</div>}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12, padding: '18px 20px',
    }}>
      {children}
    </div>
  );
}

export default function OrganisationDashboard({ orgName, enabledCapabilities, waste, fleet, serviceRequests }: Props) {
  const [hlnaHover, setHlnaHover] = useState(false);

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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: FONT, padding: '20px 24px 80px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: '#F4F4F5' }}>
            Dashboard
          </h1>
          {orgName && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>
              {orgName}
            </div>
          )}
        </div>

        <a
          href="/hlna"
          onMouseEnter={() => setHlnaHover(true)}
          onMouseLeave={() => setHlnaHover(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 16px', borderRadius: 9, textDecoration: 'none',
            background: hlnaHover ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.12)',
            border: `1px solid ${hlnaHover ? 'rgba(124,58,237,0.45)' : 'rgba(124,58,237,0.28)'}`,
            color: '#C4B5FD', fontSize: 12, fontWeight: 600, fontFamily: FONT,
            transition: 'all .18s',
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'linear-gradient(135deg,#A78BFA,#38BDF8)',
            boxShadow: '0 0 8px rgba(167,139,250,.6)', flexShrink: 0,
          }} />
          Open HLNA
        </a>
      </div>

      {/* ── Your Tools (capability-gated module entry points) ── */}
      {hasAnyCapability && (
        <div style={{ marginBottom: 22 }}>
          <ModuleAccessCard enabledCapabilities={enabledCapabilities} />
        </div>
      )}

      {/* ── Operational overview — real, organisation-scoped data only.
          Each metric group renders only when its own table genuinely has
          rows for this organisation; nothing here is a default/demo value. ── */}
      {hasOperationalData ? (
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 14 }}>
            Operational Overview
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            {hasWasteData && (
              <>
                <MetricCard label="Waste Cost" value={fmt(wasteCost)} sub={totalTonnes > 0 ? `${totalTonnes.toLocaleString('en-AU', { maximumFractionDigits: 0 })} tonnes` : undefined} accent="#8B5CF6" icon="♻" />
                <MetricCard label="Contamination" value={avgContam > 0 ? `${avgContam.toFixed(1)}%` : '—'} sub="Avg across suburbs" accent={avgContam > 10 ? '#EF4444' : '#22C55E'} icon="⚠" />
              </>
            )}
            {hasFleetData && (
              <>
                <MetricCard label="Fleet Cost" value={fmt(fleetCost)} sub={vehicleCount > 0 ? `${vehicleCount} vehicles active` : undefined} accent="#38BDF8" icon="🚛" />
                <MetricCard label="Fleet Defects" value={totalDefects > 0 ? String(totalDefects) : '—'} sub={vehicleCount > 0 ? `across ${vehicleCount} vehicles` : undefined} accent={totalDefects > 5 ? '#EF4444' : '#22C55E'} icon="🔧" />
              </>
            )}
            {hasSRData && (
              <>
                <MetricCard label="Open Requests" value={String(openCount)} sub={avgDays > 0 ? `avg ${avgDays.toFixed(1)} days open` : undefined} accent={openCount > 20 ? '#F59E0B' : '#22C55E'} icon="📋" />
                <MetricCard label="Closed Requests" value={String(closedCount)} accent="#22C55E" icon="✓" />
              </>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 22, marginBottom: 8, opacity: 0.35 }}>◈</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)' }}>No operational metrics available yet</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 4 }}>
              Metrics will appear here once operational data is available for your organisation.
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
