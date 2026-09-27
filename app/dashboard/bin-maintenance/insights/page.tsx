'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import type {
  BinMaintenanceKpi, BinMaintenanceCompliance, CategoryStreamCrossTab,
  BinMaintenancePatterns, BinMaintenanceProjections, BinMaintenanceAdditionalCancel,
  BinMaintenanceDamagedParts, BinMaintenanceMissedCollections,
} from '@/modules/bin-maintenance/calculations';
import { BIN_LABEL, ROW_BORDER, TH_LABEL, TRACK, binColor } from './tabs/constants';
import ComplianceTab from './tabs/ComplianceTab';
import CategoriesTab from './tabs/CategoriesTab';
import StreamsTab from './tabs/StreamsTab';
import PatternsTab from './tabs/PatternsTab';
import ProjectionsTab from './tabs/ProjectionsTab';
import AdditionalCancelTab from './tabs/AdditionalCancelTab';
import DamagedTab from './tabs/DamagedTab';
import MissedCollectionsTab from './tabs/MissedCollectionsTab';

type ExtraKpi = {
  compliance:        BinMaintenanceCompliance;
  category_stream:   CategoryStreamCrossTab;
  patterns:          BinMaintenancePatterns;
  projections:       BinMaintenanceProjections;
  additional_cancel: BinMaintenanceAdditionalCancel;
  damaged_parts:     BinMaintenanceDamagedParts;
  missed_collections: BinMaintenanceMissedCollections;
};

type KpiData = { hasData: false } | ({ hasData: true } & BinMaintenanceKpi & ExtraKpi);

const TABS = [
  { key: 'overview',    label: 'Overview' },
  { key: 'compliance',  label: 'Compliance' },
  { key: 'categories',  label: 'Categories' },
  { key: 'damaged',     label: 'Damaged Parts' },
  { key: 'missed',      label: 'Missed Collections' },
  { key: 'streams',     label: 'Streams' },
  { key: 'patterns',    label: 'Patterns' },
  { key: 'projections', label: 'Projections' },
  { key: 'add-cancel',  label: 'Additional Cancel' },
] as const;

type TabKey = typeof TABS[number]['key'];

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fyStart(d: Date): Date {
  return d.getMonth() >= 6 ? new Date(d.getFullYear(), 6, 1) : new Date(d.getFullYear() - 1, 6, 1);
}

export default function BinMaintenanceInsightsPage() {
  const [data,     setData]     = useState<KpiData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<TabKey>('overview');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');

  useEffect(() => {
    const qs = new URLSearchParams();
    if (dateFrom) qs.set('from', dateFrom);
    if (dateTo)   qs.set('to', dateTo);
    const url = qs.toString() ? `/api/bin-maintenance/kpi?${qs}` : '/api/bin-maintenance/kpi';
    fetch(url, { credentials: 'include' })
      .then(r => r.json())
      .then((d: KpiData) => setData(d))
      .catch(() => setData({ hasData: false }))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  function applyRange(from: string, to: string) {
    setLoading(true);
    setDateFrom(from);
    setDateTo(to);
  }

  function setPreset(preset: 'last30' | 'last90' | 'thismonth' | 'thisfy' | 'all') {
    const now = new Date();
    if (preset === 'all') { applyRange('', ''); return; }
    const to = toLocalDateStr(now);
    let from: string;
    if (preset === 'last30') { const d = new Date(now); d.setDate(d.getDate() - 29); from = toLocalDateStr(d); }
    else if (preset === 'last90') { const d = new Date(now); d.setDate(d.getDate() - 89); from = toLocalDateStr(d); }
    else if (preset === 'thismonth') { from = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1)); }
    else { from = toLocalDateStr(fyStart(now)); }
    applyRange(from, to);
  }

  const empty = !loading && (!data || !data.hasData);
  const kpi   = data && data.hasData ? data : null;

  const maxIssue = kpi
    ? Math.max(...Object.values(kpi.by_issue_type), 1)
    : 1;
  const maxBin = kpi
    ? Math.max(...Object.values(kpi.by_bin_type), 1)
    : 1;

  const dateActive = !!(dateFrom || dateTo);

  const chart = useDashboardChart();
  const pal = chart.palette;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Tabs: arrow / Home / End move the selection (roving tabindex).
  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex(t => t.key === tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].key);
    tabRefs.current[next]?.focus();
  }

  const control: React.CSSProperties = { padding: '4px 10px', fontSize: 11, fontWeight: 500, fontFamily: 'inherit', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)', cursor: 'pointer' };
  const dateInput: React.CSSProperties = { background: dateActive ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-raised)', border: `1px solid ${dateActive ? 'var(--brand-brainbase-accent-border)' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-md)', padding: '4px 8px', fontSize: 12, color: 'var(--text-primary)', fontFamily: 'inherit' };
  const ageChip = (days: number): React.CSSProperties => ({ fontSize: 11, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: days > 7 ? 'var(--status-danger-muted)' : 'var(--status-warning-muted)', color: days > 7 ? 'var(--status-danger)' : 'var(--status-warning)', fontWeight: 700 });
  const zebra = (i: number) => (i % 2 === 0 ? 'color-mix(in srgb, var(--bg-sunken) 60%, transparent)' : 'transparent');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'var(--bb-font-sans)', padding: '28px 28px 48px' }}>

      {/* Back to dashboard */}
      <Link href="/dashboard/bin-maintenance" style={{ ...control, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, padding: '5px 11px', fontWeight: 600, textDecoration: 'none' }}>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        Bin Maintenance
      </Link>

      {/* Date filter strip */}
      <div role="group" aria-labelledby="bmi-date-range" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16, padding: '10px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <span id="bmi-date-range" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Date range:</span>
        <input
          type="date"
          aria-label="From date"
          value={dateFrom}
          onChange={e => applyRange(e.target.value, dateTo)}
          style={dateInput}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>to</span>
        <input
          type="date"
          aria-label="To date"
          value={dateTo}
          onChange={e => applyRange(dateFrom, e.target.value)}
          style={dateInput}
        />
        <div aria-hidden="true" style={{ width: 1, height: 14, background: 'var(--border)' }} />
        {([
          ['last30', 'Last 30 days'], ['last90', 'Last 90 days'],
          ['thismonth', 'This month'], ['thisfy', 'Full FY'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPreset(key)}
            style={control}
          >
            {label}
          </button>
        ))}
        {dateActive && (
          <button
            type="button"
            onClick={() => setPreset('all')}
            style={{ ...control, fontWeight: 600, background: 'var(--bg-surface)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)' }}
          >
            ✕ Clear filter
          </button>
        )}
        {loading && <span role="status" style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>Loading…</span>}
        {!loading && kpi && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{kpi.total_jobs.toLocaleString()} jobs in range</span>}
      </div>

      {/* Tab bar */}
      <div role="tablist" aria-label="Bin maintenance insights views" onKeyDown={onTabKeyDown} style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={el => { tabRefs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 14px',
              fontSize: 12.5,
              fontWeight: tab === t.key ? 600 : 500,
              fontFamily: 'inherit',
              color: tab === t.key ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--brand-brainbase-accent)' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'compliance' && (
        <ComplianceTab compliance={kpi?.compliance} loading={loading} empty={empty} />
      )}
      {tab === 'categories' && (
        <CategoriesTab by_issue_type={kpi?.by_issue_type ?? {}} category_stream={kpi?.category_stream} loading={loading} empty={empty} />
      )}
      {tab === 'damaged' && (
        <DamagedTab data={kpi?.damaged_parts} loading={loading} empty={empty} />
      )}
      {tab === 'missed' && (
        <MissedCollectionsTab data={kpi?.missed_collections} loading={loading} empty={empty} />
      )}
      {tab === 'streams' && (
        <StreamsTab by_bin_type={kpi?.by_bin_type ?? {}} category_stream={kpi?.category_stream} loading={loading} empty={empty} />
      )}
      {tab === 'patterns' && (
        <PatternsTab patterns={kpi?.patterns} loading={loading} empty={empty} />
      )}
      {tab === 'projections' && (
        <ProjectionsTab projections={kpi?.projections} loading={loading} empty={empty} />
      )}
      {tab === 'add-cancel' && (
        <AdditionalCancelTab data={kpi?.additional_cancel} loading={loading} empty={empty} />
      )}

      {tab === 'overview' && <>
      {/* KPI Strip */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <KpiCard
          label="Total Jobs"
          value={loading ? '—' : (kpi?.total_jobs ?? 0).toLocaleString()}
          accentColor="var(--brand-brainbase-accent)"
          loading={loading}
        />
        <KpiCard
          label="Open"
          value={loading ? '—' : (kpi?.open_jobs ?? 0)}
          accentColor="var(--status-danger)"
          status={kpi && kpi.open_jobs > 0 ? 'risk' : undefined}
          loading={loading}
        />
        <KpiCard
          label="Overdue"
          value={loading ? '—' : (kpi?.overdue_jobs ?? 0)}
          accentColor="var(--status-warning)"
          status={kpi && kpi.overdue_jobs > 0 ? 'risk' : undefined}
          loading={loading}
        />
        <KpiCard
          label="Completion %"
          value={loading ? '—' : `${kpi?.completion_rate ?? 0}%`}
          accentColor="var(--status-success)"
          loading={loading}
        />
        <KpiCard
          label="Unassigned Open"
          value={loading ? '—' : (kpi?.unassigned_open ?? 0)}
          accentColor="var(--status-warning)"
          status={kpi && kpi.unassigned_open > 0 ? 'watch' : undefined}
          loading={loading}
        />
        <KpiCard
          label="Avg Age (days)"
          value={loading ? '—' : (kpi?.avg_age_open_days ?? 0)}
          accentColor="var(--status-info)"
          loading={loading}
        />
      </div>

      {/* Row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Suburb Hotspots */}
        <Widget title="Suburb Hotspots" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
          {kpi && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Suburb', 'Total', 'Open', 'Critical', 'Avg Age'].map(h => (
                    <th key={h} scope="col" style={{ ...TH_LABEL, textAlign: h === 'Suburb' ? 'left' : 'right', padding: '0 6px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kpi.by_suburb.slice(0, 12).map((s, i) => (
                  <tr key={s.suburb} style={{ background: zebra(i), ...ROW_BORDER }}>
                    <td style={{ padding: '7px 6px', fontSize: 12, color: 'var(--text-primary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.suburb}</td>
                    <td style={{ padding: '7px 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.total}</td>
                    <td style={{ padding: '7px 6px', fontSize: 12, fontWeight: 700, color: s.open > 0 ? 'var(--status-danger)' : 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.open}</td>
                    <td style={{ padding: '7px 6px', textAlign: 'right' }}>
                      {s.critical > 0
                        ? <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--status-danger-muted)', color: 'var(--status-danger)', fontWeight: 700 }}>{s.critical}</span>
                        : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '7px 6px', textAlign: 'right' }}>
                      {s.avg_age_days > 0
                        ? <span style={ageChip(s.avg_age_days)}>{s.avg_age_days}d</span>
                        : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Widget>

        {/* By Issue Type */}
        <Widget title="By Issue Type" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
          {kpi && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(kpi.by_issue_type)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10)
                .map(([issue, count]) => (
                  <div key={issue}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, paddingRight: 8 }}>{issue}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>{count}</span>
                    </div>
                    <div style={TRACK}>
                      <div style={{ height: '100%', width: `${Math.round((count / maxIssue) * 100)}%`, background: pal.primary, borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </Widget>
      </div>

      {/* Row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* By Bin Type */}
        <Widget title="By Bin Type" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
          {kpi && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Object.entries(kpi.by_bin_type)
                .sort(([, a], [, b]) => b - a)
                .map(([binType, count]) => {
                  const color = binColor(pal, binType);
                  return (
                    <div key={binType}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{BIN_LABEL[binType] ?? binType}</span>
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>{count}</span>
                      </div>
                      <div style={TRACK}>
                        <div style={{ height: '100%', width: `${Math.round((count / maxBin) * 100)}%`, background: color, borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Widget>

        {/* Critical Unresolved */}
        <Widget title="Critical Unresolved" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
          {kpi && kpi.critical_unresolved.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 60 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No critical unresolved jobs</span>
            </div>
          )}
          {kpi && kpi.critical_unresolved.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {kpi.critical_unresolved.slice(0, 10).map((job, i) => (
                <div key={job.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', background: zebra(i) }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.address}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{job.suburb} · {job.issue_type}</div>
                  </div>
                  <span style={{ ...ageChip(job.days_open), flexShrink: 0 }}>
                    {job.days_open}d
                  </span>
                </div>
              ))}
            </div>
          )}
        </Widget>
      </div>
      </>}

    </div>
  );
}
