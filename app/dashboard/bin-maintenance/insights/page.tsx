'use client';

import { useEffect, useState } from 'react';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import type { BinMaintenanceKpi } from '@/modules/bin-maintenance/calculations';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

const BIN_COLOR: Record<string, string> = {
  GENERAL_WASTE: 'rgba(148,163,184,0.7)',
  RECYCLING:     '#10b981',
  ORGANICS:      '#84cc16',
  BULK_WASTE:    '#F59E0B',
};

const BIN_LABEL: Record<string, string> = {
  GENERAL_WASTE: 'General Waste',
  RECYCLING:     'Recycling',
  ORGANICS:      'Organics',
  BULK_WASTE:    'Bulk Waste',
};

const TH = {
  label: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.35)' },
  row:   { borderBottom: '1px solid rgba(255,255,255,0.05)' },
};

type KpiData = { hasData: false } | ({ hasData: true } & BinMaintenanceKpi);

export default function BinMaintenanceInsightsPage() {
  const [data,    setData]    = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/bin-maintenance/kpi', { credentials: 'include' })
      .then(r => r.json())
      .then((d: KpiData) => setData(d))
      .catch(() => setData({ hasData: false }))
      .finally(() => setLoading(false));
  }, []);

  const empty = !loading && (!data || !data.hasData);
  const kpi   = data && data.hasData ? data : null;

  const maxIssue = kpi
    ? Math.max(...Object.values(kpi.by_issue_type), 1)
    : 1;
  const maxBin = kpi
    ? Math.max(...Object.values(kpi.by_bin_type), 1)
    : 1;

  return (
    <div style={{ minHeight: '100vh', background: '#07080B', fontFamily: FONT, padding: '28px 28px 48px' }}>

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
                    <td style={{ padding: '7px 6px', fontSize: 12, color: 'rgba(255,255,255,0.72)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.suburb}</td>
                    <td style={{ padding: '7px 6px', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.55)', textAlign: 'right' }}>{s.total}</td>
                    <td style={{ padding: '7px 6px', fontSize: 12, fontWeight: 700, color: s.open > 0 ? '#EF4444' : 'rgba(255,255,255,0.30)', textAlign: 'right' }}>{s.open}</td>
                    <td style={{ padding: '7px 6px', textAlign: 'right' }}>
                      {s.critical > 0
                        ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: '#EF4444', fontWeight: 700 }}>{s.critical}</span>
                        : <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '7px 6px', textAlign: 'right' }}>
                      {s.avg_age_days > 0
                        ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: s.avg_age_days > 7 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', color: s.avg_age_days > 7 ? '#EF4444' : '#F59E0B', fontWeight: 700 }}>{s.avg_age_days}d</span>
                        : <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)' }}>—</span>
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
                      <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, paddingRight: 8 }}>{issue}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,0.55)', flexShrink: 0 }}>{count}</span>
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
                          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)' }}>{BIN_LABEL[binType] ?? binType}</span>
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,0.55)' }}>{count}</span>
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
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)' }}>No critical unresolved jobs</span>
            </div>
          )}
          {kpi && kpi.critical_unresolved.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {kpi.critical_unresolved.slice(0, 10).map((job, i) => (
                <div key={job.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.address}</div>
                    <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.30)', marginTop: 1 }}>{job.suburb} · {job.issue_type}</div>
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

    </div>
  );
}
