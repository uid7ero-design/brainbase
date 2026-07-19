'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import type {
  BinMaintenanceKpi, BinMaintenanceCompliance, CategoryStreamCrossTab,
  BinMaintenancePatterns, BinMaintenanceProjections, BinMaintenanceAdditionalCancel,
  BinMaintenanceDamagedParts, BinMaintenanceMissedCollections,
} from '@/modules/bin-maintenance/calculations';
import { FONT, BIN_COLOR, BIN_LABEL } from './tabs/constants';
import ComplianceTab from './tabs/ComplianceTab';
import CategoriesTab from './tabs/CategoriesTab';
import StreamsTab from './tabs/StreamsTab';
import PatternsTab from './tabs/PatternsTab';
import ProjectionsTab from './tabs/ProjectionsTab';
import AdditionalCancelTab from './tabs/AdditionalCancelTab';
import DamagedTab from './tabs/DamagedTab';
import MissedCollectionsTab from './tabs/MissedCollectionsTab';

const TH = {
  label: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color:'rgba(255,255,255,0.57)' },
  row:   { borderBottom: '1px solid rgba(255,255,255,0.05)' },
};

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

  return (
    <div style={{ minHeight: '100vh', background: '#07080B', fontFamily: FONT, padding: '28px 28px 48px' }}>

      {/* Back to dashboard */}
      <Link href="/dashboard/bin-maintenance" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, padding: '5px 11px', borderRadius: 7, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 600, fontFamily: FONT, textDecoration: 'none' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        Bin Maintenance
      </Link>

      {/* Date filter strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>Date range:</span>
        <input
          type="date"
          value={dateFrom}
          onChange={e => applyRange(e.target.value, dateTo)}
          style={{ background: dateActive ? 'rgba(167,139,250,0.10)' : 'rgba(255,255,255,0.05)', border: `1px solid ${dateActive ? 'rgba(167,139,250,0.35)' : 'rgba(255,255,255,0.10)'}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, color: '#fff', fontFamily: FONT, colorScheme: 'dark' }}
        />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>to</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => applyRange(dateFrom, e.target.value)}
          style={{ background: dateActive ? 'rgba(167,139,250,0.10)' : 'rgba(255,255,255,0.05)', border: `1px solid ${dateActive ? 'rgba(167,139,250,0.35)' : 'rgba(255,255,255,0.10)'}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, color: '#fff', fontFamily: FONT, colorScheme: 'dark' }}
        />
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)' }} />
        {([
          ['last30', 'Last 30 days'], ['last90', 'Last 90 days'],
          ['thismonth', 'This month'], ['thisfy', 'Full FY'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPreset(key)}
            style={{ padding: '4px 10px', fontSize: 11, fontWeight: 500, fontFamily: FONT, borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}
          >
            {label}
          </button>
        ))}
        {dateActive && (
          <button
            onClick={() => setPreset('all')}
            style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, fontFamily: FONT, borderRadius: 6, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#F87171', cursor: 'pointer' }}
          >
            ✕ Clear filter
          </button>
        )}
        {loading && <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>Loading…</span>}
        {!loading && kpi && <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>{kpi.total_jobs.toLocaleString()} jobs in range</span>}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 14px',
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: FONT,
              color: tab === t.key ? '#fff' : 'rgba(255,255,255,0.4)',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid #A78BFA' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
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
          accentColor="#A78BFA"
          theme="dark"
          loading={loading}
        />
        <KpiCard
          label="Open"
          value={loading ? '—' : (kpi?.open_jobs ?? 0)}
          accentColor="#EF4444"
          status={kpi && kpi.open_jobs > 0 ? 'risk' : undefined}
          theme="dark"
          loading={loading}
        />
        <KpiCard
          label="Overdue"
          value={loading ? '—' : (kpi?.overdue_jobs ?? 0)}
          accentColor="#F97316"
          status={kpi && kpi.overdue_jobs > 0 ? 'risk' : undefined}
          theme="dark"
          loading={loading}
        />
        <KpiCard
          label="Completion %"
          value={loading ? '—' : `${kpi?.completion_rate ?? 0}%`}
          accentColor="#10b981"
          theme="dark"
          loading={loading}
        />
        <KpiCard
          label="Unassigned Open"
          value={loading ? '—' : (kpi?.unassigned_open ?? 0)}
          accentColor="#F59E0B"
          status={kpi && kpi.unassigned_open > 0 ? 'watch' : undefined}
          theme="dark"
          loading={loading}
        />
        <KpiCard
          label="Avg Age (days)"
          value={loading ? '—' : (kpi?.avg_age_open_days ?? 0)}
          accentColor="#60A5FA"
          theme="dark"
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
                    <th key={h} style={{ ...TH.label, textAlign: h === 'Suburb' ? 'left' : 'right', padding: '0 6px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kpi.by_suburb.slice(0, 12).map((s, i) => (
                  <tr key={s.suburb} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', ...TH.row }}>
                    <td style={{ padding: '7px 6px', fontSize: 12, color:'rgba(255,255,255,0.85)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.suburb}</td>
                    <td style={{ padding: '7px 6px', fontSize: 12, fontWeight: 700, color:'rgba(255,255,255,0.77)', textAlign: 'right' }}>{s.total}</td>
                    <td style={{ padding: '7px 6px', fontSize: 12, fontWeight: 700, color: s.open > 0 ? '#EF4444' : 'rgba(255,255,255,0.30)', textAlign: 'right' }}>{s.open}</td>
                    <td style={{ padding: '7px 6px', textAlign: 'right' }}>
                      {s.critical > 0
                        ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: '#EF4444', fontWeight: 700 }}>{s.critical}</span>
                        : <span style={{ fontSize: 11, color:'rgba(255,255,255,0.42)' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '7px 6px', textAlign: 'right' }}>
                      {s.avg_age_days > 0
                        ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: s.avg_age_days > 7 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', color: s.avg_age_days > 7 ? '#EF4444' : '#F59E0B', fontWeight: 700 }}>{s.avg_age_days}d</span>
                        : <span style={{ fontSize: 11, color:'rgba(255,255,255,0.42)' }}>—</span>
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
                      <span style={{ fontSize: 11.5, color:'rgba(255,255,255,0.77)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, paddingRight: 8 }}>{issue}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color:'rgba(255,255,255,0.77)', flexShrink: 0 }}>{count}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.round((count / maxIssue) * 100)}%`, background: '#A78BFA', borderRadius: 2, transition: 'width .4s ease' }} />
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
                  const color = BIN_COLOR[binType] ?? 'rgba(148,163,184,0.7)';
                  return (
                    <div key={binType}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                          <span style={{ fontSize: 11.5, color:'rgba(255,255,255,0.77)' }}>{BIN_LABEL[binType] ?? binType}</span>
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color:'rgba(255,255,255,0.77)' }}>{count}</span>
                      </div>
                      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.round((count / maxBin) * 100)}%`, background: color, borderRadius: 2, transition: 'width .4s ease' }} />
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
              <span style={{ fontSize: 12, color:'rgba(255,255,255,0.4)' }}>No critical unresolved jobs</span>
            </div>
          )}
          {kpi && kpi.critical_unresolved.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {kpi.critical_unresolved.slice(0, 10).map((job, i) => (
                <div key={job.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color:'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.address}</div>
                    <div style={{ fontSize: 10.5, color:'rgba(255,255,255,0.52)', marginTop: 1 }}>{job.suburb} · {job.issue_type}</div>
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: job.days_open > 7 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', color: job.days_open > 7 ? '#EF4444' : '#F59E0B', fontWeight: 700, flexShrink: 0 }}>
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
