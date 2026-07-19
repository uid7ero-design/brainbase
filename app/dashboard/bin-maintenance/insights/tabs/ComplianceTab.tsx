'use client';

import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, ReferenceLine,
} from 'recharts';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import Widget from '@/components/ops/widgets/Widget';
import type { BinMaintenanceCompliance } from '@/modules/bin-maintenance/calculations';
import { BIN_LABEL, GRID, TICK, TOOLTIP_STYLE, TARGET_PCT } from './constants';

function pctColor(pct: number): string {
  return pct >= TARGET_PCT ? '#10b981' : pct >= 70 ? '#F59E0B' : '#EF4444';
}

const AGE_LABELS: Record<string, string> = {
  sameDay: 'Same day',
  oneToTwo: '1–2 days',
  threeToSeven: '3–7 days',
  eightToFourteen: '8–14 days',
  fifteenPlus: '15+ days',
};

export default function ComplianceTab({
  compliance, loading, empty,
}: {
  compliance: BinMaintenanceCompliance | undefined;
  loading: boolean;
  empty: boolean;
}) {
  const c = compliance;

  const issueRows = (c?.by_issue_type ?? []).slice(0, 10).map(r => ({
    name: r.issue_type,
    pct: r.pct,
    within: r.within,
    total: r.total,
    targetDays: r.targetDays,
  }));

  const streamRows = (c?.by_bin_type ?? []).map(r => ({
    name: BIN_LABEL[r.bin_type] ?? r.bin_type,
    pct: r.pct,
    within: r.within,
    total: r.total,
  }));

  const trendRows = (c?.weekly_trend ?? []).map(r => ({ week: r.weekLabel, pct: r.pct, total: r.total }));

  const agingRows = c
    ? Object.entries(c.aging).map(([key, count]) => ({ name: AGE_LABELS[key] ?? key, count }))
    : [];

  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <KpiCard label="2/5BD Compliance" value={loading ? '—' : `${c?.pct ?? 0}%`} accentColor={c ? pctColor(c.pct) : '#A78BFA'} theme="dark" loading={loading} />
        <KpiCard label="Within Target" value={loading ? '—' : (c?.within ?? 0)} accentColor="#10b981" theme="dark" loading={loading} />
        <KpiCard label="Outside Target" value={loading ? '—' : (c?.outside ?? 0)} accentColor="#EF4444" status={c && c.outside > 0 ? 'watch' : undefined} theme="dark" loading={loading} />
        <KpiCard label="Overdue (Open)" value={loading ? '—' : (c?.overdue_open ?? 0)} accentColor="#F97316" status={c && c.overdue_open > 0 ? 'risk' : undefined} theme="dark" loading={loading} />
        <KpiCard label="Excluded" value={loading ? '—' : (c?.excluded_count ?? 0)} sub="Additional Cancel" accentColor="#60A5FA" theme="dark" loading={loading} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Widget title="Compliance by Issue Type" subtitle={`${TARGET_PCT}% target`} loading={loading} empty={empty} emptyMessage="Upload bin maintenance data with reported/closed dates to get started">
          {issueRows.length > 0 && (
            <ResponsiveContainer width="100%" height={Math.max(220, issueRows.length * 30)}>
              <BarChart data={issueRows} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={TICK} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={140} tick={{ ...TICK, fontSize: 10.5 }} axisLine={false} tickLine={false} />
                <ReferenceLine x={TARGET_PCT} stroke="#F59E0B" strokeDasharray="5 5" />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v, _n, p) => [`${Number(v)}% (${p.payload.within}/${p.payload.total}) · target ${p.payload.targetDays}BD`, 'Compliance']}
                />
                <Bar dataKey="pct" radius={[0, 3, 3, 0]}>
                  {issueRows.map((r, i) => <Cell key={i} fill={pctColor(r.pct)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>

        <Widget title="Compliance by Stream" subtitle={`${TARGET_PCT}% target`} loading={loading} empty={empty} emptyMessage="Upload bin maintenance data with reported/closed dates to get started">
          {streamRows.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={streamRows}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={TICK} axisLine={false} tickLine={false} />
                <ReferenceLine y={TARGET_PCT} stroke="#F59E0B" strokeDasharray="5 5" />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, _n, p) => [`${Number(v)}% (${p.payload.within}/${p.payload.total})`, 'Compliance']} />
                <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
                  {streamRows.map((r, i) => <Cell key={i} fill={pctColor(r.pct)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Widget title="Weekly Compliance Trend" loading={loading} empty={empty} emptyMessage="Upload bin maintenance data with reported/closed dates to get started">
          {trendRows.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="week" tick={{ ...TICK, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={TICK} axisLine={false} tickLine={false} />
                <ReferenceLine y={TARGET_PCT} stroke="#F59E0B" strokeDasharray="5 5" />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, _n, p) => [`${Number(v)}% (${p.payload.total} closed)`, 'Compliance']} />
                <Line type="monotone" dataKey="pct" stroke="#A78BFA" strokeWidth={2.5} dot={{ r: 3, fill: '#A78BFA' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Widget>

        <Widget title="Open Request Aging" loading={loading} empty={empty} emptyMessage="No open requests">
          {agingRows.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={agingRows}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ ...TICK, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {agingRows.map((_, i) => <Cell key={i} fill={['#10b981', '#10b981', '#F59E0B', '#F97316', '#EF4444'][i] ?? '#EF4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>
      </div>
    </>
  );
}
