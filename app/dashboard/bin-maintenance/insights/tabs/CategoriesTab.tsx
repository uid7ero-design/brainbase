'use client';

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import Widget from '@/components/ops/widgets/Widget';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import type { CategoryStreamCrossTab } from '@/modules/bin-maintenance/calculations';
import { BIN_LABEL, ROW_BORDER, TH_LABEL, binColor } from './constants';

export default function CategoriesTab({
  by_issue_type, category_stream, loading, empty,
}: {
  by_issue_type: Record<string, number>;
  category_stream: CategoryStreamCrossTab | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const chart = useDashboardChart();
  const pal = chart.palette;

  const sorted = Object.entries(by_issue_type).sort(([, a], [, b]) => b - a);
  const top10 = sorted.slice(0, 10).map(([name, count], i) => ({ name, count, fill: chart.series[i % chart.series.length] }));

  const streamKeys = ['GENERAL_WASTE', 'RECYCLING', 'ORGANICS', 'BULK_WASTE'] as const;
  const stackRows = sorted.slice(0, 8).map(([issue]) => {
    const cs = category_stream?.[issue];
    return {
      name: issue,
      GENERAL_WASTE: cs?.GENERAL_WASTE ?? 0,
      RECYCLING: cs?.RECYCLING ?? 0,
      ORGANICS: cs?.ORGANICS ?? 0,
      BULK_WASTE: cs?.BULK_WASTE ?? 0,
    };
  });

  const total = sorted.reduce((s, [, c]) => s + c, 0) || 1;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Widget title="Job Count by Issue Type" subtitle="Top 10" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
          {top10.length > 0 && (
            <ResponsiveContainer width="100%" height={Math.max(220, top10.length * 28)}>
              <BarChart data={top10} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tick={chart.tick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={150} tick={{ ...chart.tick, fontSize: 10.5 }} axisLine={false} tickLine={false} />
                <Tooltip {...chart.tooltip} formatter={v => [`${Number(v)} (${Math.round((Number(v) / total) * 100)}%)`, 'Jobs']} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {top10.map((r, i) => <Cell key={i} fill={r.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>

        <Widget title="Issue Type by Stream" subtitle="Top 8, stacked" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
          {stackRows.length > 0 && (
            <ResponsiveContainer width="100%" height={Math.max(220, stackRows.length * 32)}>
              <BarChart data={stackRows} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tick={chart.tick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={150} tick={{ ...chart.tick, fontSize: 10.5 }} axisLine={false} tickLine={false} />
                <Tooltip {...chart.tooltip} />
                {streamKeys.map(k => (
                  <Bar key={k} dataKey={k} name={BIN_LABEL[k]} stackId="s" fill={binColor(pal, k)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>
      </div>

      <Widget title="All Issue Types" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
        {sorted.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['#', 'Issue Type', 'Jobs', '% of Total'].map(h => (
                  <th key={h} scope="col" style={{ ...TH_LABEL, textAlign: h === 'Issue Type' ? 'left' : 'right', padding: '0 6px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(([issue, count], i) => (
                <tr key={issue} style={ROW_BORDER}>
                  <td style={{ padding: '7px 6px', fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                  <td style={{ padding: '7px 6px', fontSize: 12, color: 'var(--text-primary)' }}>{issue}</td>
                  <td style={{ padding: '7px 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{count}</td>
                  <td style={{ padding: '7px 6px', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round((count / total) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Widget>
    </>
  );
}
