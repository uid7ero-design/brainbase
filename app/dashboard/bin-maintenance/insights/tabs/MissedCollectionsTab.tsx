'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import type { BinMaintenanceMissedCollections } from '@/modules/bin-maintenance/calculations';
import { BIN_COLOR, BIN_LABEL, GRID, TICK, TOOLTIP_STYLE } from './constants';

export default function MissedCollectionsTab({
  data, loading, empty,
}: {
  data: BinMaintenanceMissedCollections | undefined;
  loading: boolean;
  empty: boolean;
}) {
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
      <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'rgba(255,255,255,0.72)', marginBottom: 20 }}>
        General Waste missed collections are run by the internal team; Organics and Recycling are run by the contractor
        &mdash; split out below.{contractor && contractor.total === 0 && ' No Organics/Recycling missed-collection records are present in this system yet, so the contractor side reads zero until that data is imported.'}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <KpiCard label="Total" value={loading ? '—' : (data?.total ?? 0).toLocaleString()} accentColor="#60A5FA" theme="dark" loading={loading} />
        <KpiCard label="Open" value={loading ? '—' : (data?.open ?? 0)} accentColor="#EF4444" status={data && data.open > 0 ? 'watch' : undefined} theme="dark" loading={loading} />
        <KpiCard label="Internal (Waste)" value={loading ? '—' : (internal?.total ?? 0)} accentColor="#6B7280" theme="dark" loading={loading} />
        <KpiCard label="Contractor (Organics/Recycling)" value={loading ? '—' : (contractor?.total ?? 0)} accentColor="#22C55E" theme="dark" loading={loading} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Widget title="By Stream" loading={loading} empty={empty} emptyMessage="No missed collection data">
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

        <Widget title="Top Suburbs" loading={loading} empty={empty} emptyMessage="No missed collection data">
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
      </div>

      <Widget title="Daily Trend" loading={loading} empty={empty} emptyMessage="No missed collection data">
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
    </>
  );
}
