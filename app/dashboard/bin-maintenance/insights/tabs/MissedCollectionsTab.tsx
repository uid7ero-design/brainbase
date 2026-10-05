'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import type { BinMaintenanceMissedCollections } from '@/modules/bin-maintenance/calculations';
import { BIN_LABEL, INFO_NOTE, TRACK, binColor } from './constants';

export default function MissedCollectionsTab({
  data, loading, empty,
}: {
  data: BinMaintenanceMissedCollections | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const chart = useDashboardChart();
  const pal = chart.palette;

  const streamRows = Object.entries(data?.by_stream ?? {})
    .map(([key, value]) => ({ key, name: BIN_LABEL[key] ?? key, value }))
    .filter(r => r.value > 0);

  const suburbRows = Object.entries(data?.by_suburb ?? {}).slice(0, 12);
  const maxSuburb = suburbRows[0]?.[1] ?? 1;

  const trendRows = (data?.daily_trend ?? []).map(d => ({
    label: new Date(`${d.date}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
    count: d.count,
  }));

  const internal = data?.teams.internal;
  const contractor = data?.teams.contractor;

  return (
    <>
      <div style={INFO_NOTE}>
        General Waste missed collections are run by the internal team; Organics and Recycling are run by the contractor
        &mdash; split out below.{contractor && contractor.total === 0 && ' No Organics/Recycling missed-collection records are present in this system yet, so the contractor side reads zero until that data is imported.'}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <KpiCard label="Total" value={loading ? '—' : (data?.total ?? 0).toLocaleString()} accentColor="var(--status-info)" loading={loading} />
        <KpiCard label="Open" value={loading ? '—' : (data?.open ?? 0)} accentColor="var(--status-danger)" status={data && data.open > 0 ? 'watch' : undefined} loading={loading} />
        <KpiCard label="Internal (Waste)" value={loading ? '—' : (internal?.total ?? 0)} accentColor="var(--border-strong)" loading={loading} />
        <KpiCard label="Contractor (Organics/Recycling)" value={loading ? '—' : (contractor?.total ?? 0)} accentColor="var(--status-success)" loading={loading} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Widget title="By Stream" loading={loading} empty={empty} emptyMessage="No missed collection data">
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

        <Widget title="Top Suburbs" loading={loading} empty={empty} emptyMessage="No missed collection data">
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
      </div>

      <Widget title="Daily Trend" loading={loading} empty={empty} emptyMessage="No missed collection data">
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
    </>
  );
}
