'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import type { BinMaintenanceAdditionalCancel } from '@/modules/bin-maintenance/calculations';
import { BIN_LABEL, INFO_NOTE, TRACK, binColor, type SeriesKey } from './constants';

// Status → palette key (done = green, open/escalated = red, waiting = amber,
// scheduled = cyan, in progress = accent).
const STATUS_TONE: Record<string, SeriesKey> = {
  COMPLETED:  'success',
  CLOSED:     'success',
  OPEN:       'danger',
  ASSIGNED:   'warning',
  SCHEDULED:  'info',
  IN_PROGRESS:'primary',
  ESCALATED:  'danger',
};

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Completed', CLOSED: 'Closed', OPEN: 'Open', ASSIGNED: 'Assigned',
  SCHEDULED: 'Scheduled', IN_PROGRESS: 'In Progress', ESCALATED: 'Escalated',
};

export default function AdditionalCancelTab({
  data, loading, empty,
}: {
  data: BinMaintenanceAdditionalCancel | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const chart = useDashboardChart();
  const pal = chart.palette;

  const statusRows = Object.entries(data?.by_status ?? {}).map(([status, count]) => ({
    name: STATUS_LABEL[status] ?? status, status, count,
  }));

  const streamRows = Object.entries(data?.by_bin_type ?? {})
    .map(([key, value]) => ({ key, name: BIN_LABEL[key] ?? key, value }))
    .filter(r => r.value > 0);

  const suburbRows = Object.entries(data?.by_suburb ?? {}).slice(0, 12);
  const maxSuburb = suburbRows[0]?.[1] ?? 1;

  const trendRows = (data?.daily_trend ?? []).map(d => ({
    label: new Date(`${d.date}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
    count: d.count,
  }));

  return (
    <>
      <div style={INFO_NOTE}>
        Additional Cancel requests are collection-run dependent, not maintenance work — they&rsquo;re excluded from every other tab&rsquo;s stats (compliance, categories, streams, patterns, projections) and tracked here separately.
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <KpiCard label="Total" value={loading ? '—' : (data?.total ?? 0).toLocaleString()} accentColor="var(--status-info)" loading={loading} />
        <KpiCard label="Open" value={loading ? '—' : (data?.open ?? 0)} accentColor="var(--status-danger)" status={data && data.open > 0 ? 'watch' : undefined} loading={loading} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Widget title="By Stream" loading={loading} empty={empty} emptyMessage="No Additional Cancel data">
          {streamRows.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={streamRows} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} stroke={pal.tooltipBg}>
                  {streamRows.map(r => <Cell key={r.key} fill={binColor(pal, r.key)} />)}
                </Pie>
                <Tooltip {...chart.tooltip} />
                <Legend wrapperStyle={chart.legend} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Widget>

        <Widget title="Status Breakdown" loading={loading} empty={empty} emptyMessage="No Additional Cancel data">
          {statusRows.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusRows} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tick={chart.tick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={90} tick={chart.tick} axisLine={false} tickLine={false} />
                <Tooltip {...chart.tooltip} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {statusRows.map(r => <Cell key={r.status} fill={pal[STATUS_TONE[r.status] ?? 'info']} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Widget title="Top Suburbs" loading={loading} empty={empty} emptyMessage="No Additional Cancel data">
          {suburbRows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {suburbRows.map(([suburb, count]) => (
                <div key={suburb}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{suburb}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{count}</span>
                  </div>
                  <div style={TRACK}>
                    <div style={{ height: '100%', width: `${Math.round((count / maxSuburb) * 100)}%`, background: pal.info, borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Widget>

        <Widget title="Daily Trend" loading={loading} empty={empty} emptyMessage="No Additional Cancel data">
          {trendRows.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ ...chart.tick, fontSize: 9 }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis tick={chart.tick} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...chart.tooltip} />
                <Bar dataKey="count" fill={pal.info} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>
      </div>

      <Widget title="Avg Turnaround by Status" loading={loading} empty={empty} emptyMessage="No closed Additional Cancel data">
        {(data?.avg_turnaround_by_status?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {data!.avg_turnaround_by_status.map(s => (
              <div key={s.status} style={{ background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '12px 16px', minWidth: 150 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{STATUS_LABEL[s.status] ?? s.status}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>{s.avg_hours}h</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.count} tickets</div>
              </div>
            ))}
          </div>
        )}
      </Widget>
    </>
  );
}
