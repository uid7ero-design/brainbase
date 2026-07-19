'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import type { BinMaintenanceAdditionalCancel } from '@/modules/bin-maintenance/calculations';
import { BIN_COLOR, BIN_LABEL, GRID, TICK, TOOLTIP_STYLE } from './constants';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED:  '#10b981',
  CLOSED:     '#10b981',
  OPEN:       '#EF4444',
  ASSIGNED:   '#F59E0B',
  SCHEDULED:  '#60A5FA',
  IN_PROGRESS:'#A78BFA',
  ESCALATED:  '#F97316',
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
      <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'rgba(255,255,255,0.72)', marginBottom: 20 }}>
        Additional Cancel requests are collection-run dependent, not maintenance work — they&rsquo;re excluded from every other tab&rsquo;s stats (compliance, categories, streams, patterns, projections) and tracked here separately.
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <KpiCard label="Total" value={loading ? '—' : (data?.total ?? 0).toLocaleString()} accentColor="#60A5FA" theme="dark" loading={loading} />
        <KpiCard label="Open" value={loading ? '—' : (data?.open ?? 0)} accentColor="#EF4444" status={data && data.open > 0 ? 'watch' : undefined} theme="dark" loading={loading} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Widget title="By Stream" loading={loading} empty={empty} emptyMessage="No Additional Cancel data">
          {streamRows.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={streamRows} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {streamRows.map(r => <Cell key={r.key} fill={BIN_COLOR[r.key]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11.5, color: 'rgba(255,255,255,0.72)' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Widget>

        <Widget title="Status Breakdown" loading={loading} empty={empty} emptyMessage="No Additional Cancel data">
          {statusRows.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusRows} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={90} tick={TICK} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {statusRows.map(r => <Cell key={r.status} fill={STATUS_COLORS[r.status] ?? '#60A5FA'} />)}
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
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>{suburb}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.72)' }}>{count}</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((count / maxSuburb) * 100)}%`, background: '#60A5FA', borderRadius: 2 }} />
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
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ ...TICK, fontSize: 9 }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#60A5FA" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>
      </div>

      <Widget title="Avg Turnaround by Status" loading={loading} empty={empty} emptyMessage="No closed Additional Cancel data">
        {(data?.avg_turnaround_by_status?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {data!.avg_turnaround_by_status.map(s => (
              <div key={s.status} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 16px', minWidth: 150 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.72)', marginBottom: 4 }}>{STATUS_LABEL[s.status] ?? s.status}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#A78BFA', letterSpacing: '-0.02em' }}>{s.avg_hours}h</div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{s.count} tickets</div>
              </div>
            ))}
          </div>
        )}
      </Widget>
    </>
  );
}
