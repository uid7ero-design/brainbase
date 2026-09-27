'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import type { BinMaintenanceDamagedParts } from '@/modules/bin-maintenance/calculations';
import { BIN_LABEL, INFO_NOTE, binColor } from './constants';

const PART_ORDER = ['Missing Lid', 'Cracked Bin Body', 'Missing Lid Pin', 'Missing Wheel'] as const;

export default function DamagedTab({
  data, loading, empty,
}: {
  data: BinMaintenanceDamagedParts | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const chart = useDashboardChart();
  const pal = chart.palette;

  const streamRows = Object.entries(data?.by_stream ?? {})
    .map(([key, value]) => ({ key, name: BIN_LABEL[key] ?? key, value }))
    .filter(r => r.value > 0);

  const partRows = PART_ORDER.map((part, i) => ({
    part, count: data?.by_part[part] ?? 0, color: chart.series[i % chart.series.length],
  }));

  return (
    <>
      <div style={INFO_NOTE}>
        Part counts are parsed from the inspection Q&amp;A recorded in each Damaged Bin request&rsquo;s notes. A single bin can have multiple faults, so part counts won&rsquo;t sum to the total damaged count.
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <KpiCard
          label="Total Damaged"
          value={loading ? '—' : (data?.total_damaged ?? 0).toLocaleString()}
          accentColor="var(--status-danger)"
          loading={loading}
        />
        <KpiCard
          label="% of All Requests"
          value={loading ? '—' : `${data?.pct_of_total ?? 0}%`}
          accentColor="var(--status-warning)"
          loading={loading}
        />
        <KpiCard
          label="Top Issue"
          value={loading ? '—' : (data?.top_part?.part ?? '—')}
          accentColor="var(--brand-brainbase-accent)"
          loading={loading}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Widget title="By Stream" loading={loading} empty={empty} emptyMessage="No damaged bin data">
          {streamRows.length > 0 && (
            <ResponsiveContainer width="100%" height={240}>
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

        <Widget title="Damaged Part Breakdown" loading={loading} empty={empty} emptyMessage="No damaged bin data">
          {partRows.some(r => r.count > 0) && (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={partRows} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tick={chart.tick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="part" width={110} tick={chart.tick} axisLine={false} tickLine={false} />
                <Tooltip {...chart.tooltip} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {partRows.map(r => <Cell key={r.part} fill={r.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>
      </div>
    </>
  );
}
