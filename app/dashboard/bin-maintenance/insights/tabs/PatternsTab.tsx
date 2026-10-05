'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import Widget from '@/components/ops/widgets/Widget';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import type { BinMaintenancePatterns } from '@/modules/bin-maintenance/calculations';
import { DOW_LABELS } from './constants';

// Weekend days / out-of-hours bars are the same series drawn at reduced
// opacity (the business-hours shading is explained in the widget subtitle).
const DIM = 0.35;

export default function PatternsTab({
  patterns, loading, empty,
}: {
  patterns: BinMaintenancePatterns | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const chart = useDashboardChart();
  const pal = chart.palette;

  const dowRows = DOW_LABELS.map((label, i) => ({ label, count: patterns?.by_dow[i] ?? 0, weekend: i >= 5 }));

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourRows = hours.map(h => ({ label: `${h}:00`, count: patterns?.by_hour[h] ?? 0, business: h >= 8 && h <= 17 }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <Widget title="Requests by Day of Week" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
        {patterns && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dowRows}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" tick={chart.tick} axisLine={false} tickLine={false} />
              <YAxis tick={chart.tick} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...chart.tooltip} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {dowRows.map((r, i) => <Cell key={i} fill={pal.primary} fillOpacity={r.weekend ? DIM : 1} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Widget>

      <Widget title="Requests by Hour of Day" subtitle="Shaded = business hours (8am–5pm)" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
        {patterns && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={hourRows}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ ...chart.tick, fontSize: 9 }} interval={1} axisLine={false} tickLine={false} />
              <YAxis tick={chart.tick} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...chart.tooltip} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {hourRows.map((r, i) => <Cell key={i} fill={pal.primary} fillOpacity={r.business ? 1 : DIM} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Widget>
    </div>
  );
}
