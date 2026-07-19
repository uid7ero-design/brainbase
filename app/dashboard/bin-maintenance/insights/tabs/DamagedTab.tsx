'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import type { BinMaintenanceDamagedParts } from '@/modules/bin-maintenance/calculations';
import { BIN_COLOR, BIN_LABEL, CAT_COLORS, GRID, TICK, TOOLTIP_STYLE } from './constants';

const PART_ORDER = ['Missing Lid', 'Cracked Bin Body', 'Missing Lid Pin', 'Missing Wheel'] as const;

export default function DamagedTab({
  data, loading, empty,
}: {
  data: BinMaintenanceDamagedParts | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const streamRows = Object.entries(data?.by_stream ?? {})
    .map(([key, value]) => ({ key, name: BIN_LABEL[key] ?? key, value }))
    .filter(r => r.value > 0);

  const partRows = PART_ORDER.map((part, i) => ({
    part, count: data?.by_part[part] ?? 0, color: CAT_COLORS[i % CAT_COLORS.length],
  }));

  return (
    <>
      <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'rgba(255,255,255,0.72)', marginBottom: 20 }}>
        Part counts are parsed from the inspection Q&amp;A recorded in each Damaged Bin request&rsquo;s notes. A single bin can have multiple faults, so part counts won&rsquo;t sum to the total damaged count.
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <KpiCard
          label="Total Damaged"
          value={loading ? '—' : (data?.total_damaged ?? 0).toLocaleString()}
          accentColor="#EF4444"
          theme="dark"
          loading={loading}
        />
        <KpiCard
          label="% of All Requests"
          value={loading ? '—' : `${data?.pct_of_total ?? 0}%`}
          accentColor="#F59E0B"
          theme="dark"
          loading={loading}
        />
        <KpiCard
          label="Top Issue"
          value={loading ? '—' : (data?.top_part?.part ?? '—')}
          accentColor="#A78BFA"
          theme="dark"
          loading={loading}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Widget title="By Stream" loading={loading} empty={empty} emptyMessage="No damaged bin data">
          {streamRows.length > 0 && (
            <ResponsiveContainer width="100%" height={240}>
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

        <Widget title="Damaged Part Breakdown" loading={loading} empty={empty} emptyMessage="No damaged bin data">
          {partRows.some(r => r.count > 0) && (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={partRows} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="part" width={110} tick={TICK} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
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
