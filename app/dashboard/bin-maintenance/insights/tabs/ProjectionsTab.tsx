'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import type { BinMaintenanceProjections } from '@/modules/bin-maintenance/calculations';

export default function ProjectionsTab({
  projections, loading, empty,
}: {
  projections: BinMaintenanceProjections | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const chart = useDashboardChart();
  const pal = chart.palette;
  const p = projections;

  const dailyRows = (p?.daily ?? []).map(d => ({
    label: new Date(`${d.date}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
    count: d.count,
  }));

  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <KpiCard label="Avg per Day" value={loading ? '—' : (p?.avg_per_day ?? 0)} sub={p ? `across ${p.daily.length} days loaded` : undefined} accentColor="var(--brand-brainbase-accent)" loading={loading} />
        <KpiCard label="Avg per Weekday" value={loading ? '—' : (p?.avg_per_weekday ?? 0)} sub="Mon–Fri only" accentColor="var(--status-info)" loading={loading} />
        <KpiCard label="Projected Annual" value={loading ? '—' : (p?.projected_annual ?? 0).toLocaleString()} sub="if current rate holds" accentColor="var(--status-success)" loading={loading} />
      </div>

      <Widget title="Daily Volume" subtitle="With average line" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
        {dailyRows.length > 0 && (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyRows}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ ...chart.tick, fontSize: 9 }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
              <YAxis tick={chart.tick} axisLine={false} tickLine={false} allowDecimals={false} />
              <ReferenceLine y={p?.avg_per_day ?? 0} stroke={pal.danger} strokeDasharray="5 4" label={{ value: 'Avg', position: 'insideTopRight', fill: pal.danger, fontSize: 10 }} />
              <Tooltip {...chart.tooltip} />
              <Bar dataKey="count" fill={pal.primary} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Widget>
    </>
  );
}
