'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import Widget from '@/components/ops/widgets/Widget';
import type { BinMaintenancePatterns } from '@/modules/bin-maintenance/calculations';
import { DOW_LABELS, GRID, TICK, TOOLTIP_STYLE } from './constants';

export default function PatternsTab({
  patterns, loading, empty,
}: {
  patterns: BinMaintenancePatterns | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const dowRows = DOW_LABELS.map((label, i) => ({ label, count: patterns?.by_dow[i] ?? 0, weekend: i >= 5 }));

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourRows = hours.map(h => ({ label: `${h}:00`, count: patterns?.by_hour[h] ?? 0, business: h >= 8 && h <= 17 }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <Widget title="Requests by Day of Week" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
        {patterns && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dowRows}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
              <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {dowRows.map((r, i) => <Cell key={i} fill={r.weekend ? 'rgba(167,139,250,0.35)' : '#A78BFA'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Widget>

      <Widget title="Requests by Hour of Day" subtitle="Shaded = business hours (8am–5pm)" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
        {patterns && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={hourRows}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ ...TICK, fontSize: 9 }} interval={1} axisLine={false} tickLine={false} />
              <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {hourRows.map((r, i) => <Cell key={i} fill={r.business ? '#A78BFA' : 'rgba(167,139,250,0.3)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Widget>
    </div>
  );
}
