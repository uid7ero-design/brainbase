'use client';

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import Widget from '@/components/ops/widgets/Widget';
import type { CategoryStreamCrossTab } from '@/modules/bin-maintenance/calculations';
import { BIN_COLOR, BIN_LABEL, CAT_COLORS, GRID, TICK, TOOLTIP_STYLE } from './constants';

const TH = {
  label: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color:'rgba(255,255,255,0.57)' },
  row:   { borderBottom: '1px solid rgba(255,255,255,0.05)' },
};

export default function CategoriesTab({
  by_issue_type, category_stream, loading, empty,
}: {
  by_issue_type: Record<string, number>;
  category_stream: CategoryStreamCrossTab | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const sorted = Object.entries(by_issue_type).sort(([, a], [, b]) => b - a);
  const top10 = sorted.slice(0, 10).map(([name, count], i) => ({ name, count, fill: CAT_COLORS[i % CAT_COLORS.length] }));

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
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={150} tick={{ ...TICK, fontSize: 10.5 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => [`${Number(v)} (${Math.round((Number(v) / total) * 100)}%)`, 'Jobs']} />
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
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={150} tick={{ ...TICK, fontSize: 10.5 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                {streamKeys.map(k => (
                  <Bar key={k} dataKey={k} name={BIN_LABEL[k]} stackId="s" fill={BIN_COLOR[k]} />
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
                  <th key={h} style={{ ...TH.label, textAlign: h === 'Issue Type' ? 'left' : 'right', padding: '0 6px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(([issue, count], i) => (
                <tr key={issue} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', ...TH.row }}>
                  <td style={{ padding: '7px 6px', fontSize: 11, color:'rgba(255,255,255,0.52)' }}>{i + 1}</td>
                  <td style={{ padding: '7px 6px', fontSize: 12, color:'rgba(255,255,255,0.85)' }}>{issue}</td>
                  <td style={{ padding: '7px 6px', fontSize: 12, fontWeight: 700, color:'rgba(255,255,255,0.77)', textAlign: 'right' }}>{count}</td>
                  <td style={{ padding: '7px 6px', fontSize: 12, color:'rgba(255,255,255,0.62)', textAlign: 'right' }}>{Math.round((count / total) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Widget>
    </>
  );
}
