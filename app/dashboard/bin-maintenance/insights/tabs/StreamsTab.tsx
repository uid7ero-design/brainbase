'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Widget from '@/components/ops/widgets/Widget';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import type { CategoryStreamCrossTab } from '@/modules/bin-maintenance/calculations';
import { BIN_LABEL, TRACK, binColor } from './constants';

const STREAM_KEYS = ['GENERAL_WASTE', 'RECYCLING', 'ORGANICS', 'BULK_WASTE'] as const;

export default function StreamsTab({
  by_bin_type, category_stream, loading, empty,
}: {
  by_bin_type: Record<string, number>;
  category_stream: CategoryStreamCrossTab | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const chart = useDashboardChart();
  const pal = chart.palette;

  const pieData = STREAM_KEYS
    .map(k => ({ key: k, name: BIN_LABEL[k], value: by_bin_type[k] ?? 0 }))
    .filter(r => r.value > 0);

  const total = pieData.reduce((s, r) => s + r.value, 0) || 1;

  const perStream = STREAM_KEYS.map(k => {
    const entries = Object.entries(category_stream ?? {})
      .map(([issue, counts]) => [issue, counts[k]] as [string, number])
      .filter(([, c]) => c > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6);
    const streamTotal = entries.reduce((s, [, c]) => s + c, 0) || 1;
    return { key: k, label: BIN_LABEL[k], color: binColor(pal, k), entries, streamTotal };
  });

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Widget title="Requests by Stream" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
          {pieData.length > 0 && (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2} stroke={pal.tooltipBg}>
                  {pieData.map(r => <Cell key={r.key} fill={binColor(pal, r.key)} />)}
                </Pie>
                <Tooltip {...chart.tooltip} formatter={v => [`${Number(v)} (${Math.round((Number(v) / total) * 100)}%)`, 'Jobs']} />
                <Legend wrapperStyle={chart.legend} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Widget>

        <Widget title="Stream Totals" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data to get started">
          {pieData.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pieData.map(r => (
                <div key={r.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: binColor(pal, r.key), flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{r.name}</span>
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{r.value.toLocaleString()} · {Math.round((r.value / total) * 100)}%</span>
                  </div>
                  <div style={{ ...TRACK, height: 5, borderRadius: 3 }}>
                    <div style={{ height: '100%', width: `${Math.round((r.value / total) * 100)}%`, background: binColor(pal, r.key), borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Widget>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {perStream.map(s => (
          <Widget key={s.key} title={s.label} subtitle="Top issue types" loading={loading} empty={empty} emptyMessage="No data">
            {s.entries.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 60 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No requests in this stream</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {s.entries.map(([issue, count]) => (
                  <div key={issue}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, paddingRight: 6 }}>{issue}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>{count}</span>
                    </div>
                    <div style={TRACK}>
                      <div style={{ height: '100%', width: `${Math.round((count / s.streamTotal) * 100)}%`, background: s.color, borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Widget>
        ))}
      </div>
    </>
  );
}
