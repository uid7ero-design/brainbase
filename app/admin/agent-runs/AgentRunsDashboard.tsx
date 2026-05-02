'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Org = { id: string; name: string };

type Stats = {
  total_runs: number;
  fallback_count: number;
  avg_confidence: number | null;
};

type ByAgent = { agent_name: string; count: number; avg_conf: number | null };
type ByRoute = { route_type: string; count: number };

type RecentRun = {
  id: string;
  agent_name: string;
  route_type: string;
  input_query: string | null;
  confidence: number | null;
  source_rows: number;
  created_at: string;
  org_name: string | null;
};

type DashData = {
  stats:    Stats;
  byAgent:  ByAgent[];
  byRoute:  ByRoute[];
  recent:   RecentRun[];
  topRoute: string | null;
  orgs:     Org[];
};

type Filters = {
  orgId:     string;
  from:      string;
  to:        string;
  agentName: string;
  routeType: string;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

const AGENT_NAMES = ['InsightAgent', 'ActionAgent', 'BriefingAgent', 'DataIntakeAgent', 'HLNAChatAgent'];
const ROUTE_TYPES = ['insight', 'action', 'briefing', 'dataIntake', 'chat'];

const AGENT_COLOR: Record<string, string> = {
  InsightAgent:    '#38BDF8',
  ActionAgent:     '#A78BFA',
  BriefingAgent:   '#34D399',
  DataIntakeAgent: '#FBBF24',
  HLNAChatAgent:   '#6366F1',
};
const ROUTE_COLOR: Record<string, string> = {
  insight:    '#38BDF8',
  action:     '#A78BFA',
  briefing:   '#34D399',
  dataIntake: '#FBBF24',
  chat:       '#6366F1',
};

function confColor(c: number | null): string {
  if (c == null) return '#6b7280';
  if (c >= 0.8) return '#34D399';
  if (c >= 0.5) return '#FBBF24';
  return '#F87171';
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function isoDate(offset = 0): string {
  return new Date(Date.now() + offset * 86400000).toISOString().split('T')[0];
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: '#0f1117', border: '1px solid #1f2433', borderRadius: 10, padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#4b5563' }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color ?? '#f9fafb', letterSpacing: '-0.01em' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#6b7280' }}>{sub}</div>}
    </div>
  );
}

function MiniBarTable({
  title, rows, colorMap,
}: {
  title: string;
  rows: { label: string; count: number; sub?: string }[];
  colorMap: Record<string, string>;
}) {
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div style={{ background: '#0f1117', border: '1px solid #1f2433', borderRadius: 10, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#4b5563', marginBottom: 14 }}>
        {title}
      </div>
      {rows.length === 0 && (
        <div style={{ fontSize: 13, color: '#374151', textAlign: 'center', padding: '20px 0' }}>No data</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(row => {
          const color = colorMap[row.label] ?? '#6366F1';
          const pct   = (row.count / max) * 100;
          return (
            <div key={row.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#e5e7eb' }}>
                  {row.label.replace(/Agent$/, ' Agent')}
                </span>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {row.sub && <span style={{ fontSize: 11, color: '#6b7280' }}>{row.sub}</span>}
                  <span style={{ fontSize: 13, fontWeight: 700, color, minWidth: 28, textAlign: 'right' }}>
                    {row.count}
                  </span>
                </div>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: '#1f2433', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${pct}%`,
                  background: color,
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterBar({
  filters, orgs, onChange, onReset, loading,
}: {
  filters: Filters;
  orgs: Org[];
  onChange: (k: keyof Filters, v: string) => void;
  onReset: () => void;
  loading: boolean;
}) {
  const selectStyle: React.CSSProperties = {
    background: '#0f1117', border: '1px solid #1f2433', borderRadius: 7,
    color: '#e5e7eb', fontSize: 13, padding: '7px 10px', outline: 'none',
    cursor: 'pointer', fontFamily: 'inherit',
  };
  const inputStyle: React.CSSProperties = {
    ...selectStyle, cursor: 'text',
  };

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
      padding: '14px 20px', background: '#0b0d13',
      border: '1px solid #1f2433', borderRadius: 10, marginBottom: 24,
    }}>
      <select value={filters.orgId} onChange={e => onChange('orgId', e.target.value)} style={selectStyle}>
        <option value="">All organisations</option>
        {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: '#6b7280' }}>From</span>
        <input type="date" value={filters.from} onChange={e => onChange('from', e.target.value)} style={inputStyle} />
        <span style={{ fontSize: 12, color: '#6b7280' }}>to</span>
        <input type="date" value={filters.to}   onChange={e => onChange('to',   e.target.value)} style={inputStyle} />
      </div>

      <select value={filters.agentName} onChange={e => onChange('agentName', e.target.value)} style={selectStyle}>
        <option value="">All agents</option>
        {AGENT_NAMES.map(a => <option key={a} value={a}>{a.replace(/Agent$/, ' Agent')}</option>)}
      </select>

      <select value={filters.routeType} onChange={e => onChange('routeType', e.target.value)} style={selectStyle}>
        <option value="">All routes</option>
        {ROUTE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>

      <button
        onClick={onReset}
        style={{
          padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
          background: 'transparent', border: '1px solid #374151', color: '#6b7280',
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        Reset
      </button>

      {loading && (
        <span style={{ fontSize: 11, color: '#4b5563', marginLeft: 4 }}>Refreshing…</span>
      )}
    </div>
  );
}

// ─── Main dashboard ────────────────────────────────────────────────────────────

export default function AgentRunsDashboard({ orgs }: { orgs: Org[] }) {
  const [filters, setFilters] = useState<Filters>({
    orgId:     '',
    from:      isoDate(-7),
    to:        isoDate(0),
    agentName: '',
    routeType: '',
  });
  const [data, setData]       = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (filters.orgId)     p.set('orgId',     filters.orgId);
      if (filters.from)      p.set('from',      filters.from);
      if (filters.to)        p.set('to',        filters.to);
      if (filters.agentName) p.set('agentName', filters.agentName);
      if (filters.routeType) p.set('routeType', filters.routeType);
      const res = await fetch(`/api/admin/agent-runs?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function setFilter(k: keyof Filters, v: string) {
    setFilters(prev => ({ ...prev, [k]: v }));
  }

  function resetFilters() {
    setFilters({ orgId: '', from: isoDate(-7), to: isoDate(0), agentName: '', routeType: '' });
  }

  const stats       = data?.stats   ?? { total_runs: 0, fallback_count: 0, avg_confidence: null };
  const fallbackPct = stats.total_runs > 0
    ? Math.round((stats.fallback_count / stats.total_runs) * 100)
    : 0;
  const avgConfPct  = stats.avg_confidence != null
    ? Math.round(stats.avg_confidence * 100)
    : null;

  return (
    <div style={{ maxWidth: 1100, fontFamily: 'var(--font-inter), Inter, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb', marginBottom: 6 }}>Agent Runs</h1>
        <p style={{ fontSize: 14, color: '#6b7280' }}>
          Audit log of every specialist agent invocation — routing decisions, confidence, and query history.
        </p>
      </div>

      {/* Filters */}
      <FilterBar
        filters={filters}
        orgs={data?.orgs ?? orgs}
        onChange={setFilter}
        onReset={resetFilters}
        loading={loading}
      />

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#1a0a0a', border: '1px solid #7f1d1d', color: '#fca5a5', marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard label="Total Runs"     value={stats.total_runs.toLocaleString()} />
        <StatCard
          label="Avg Confidence"
          value={avgConfPct != null ? `${avgConfPct}%` : '—'}
          color={avgConfPct != null ? confColor(stats.avg_confidence) : undefined}
        />
        <StatCard
          label="Fallback Rate"
          value={`${fallbackPct}%`}
          sub={`${stats.fallback_count} chat fallbacks`}
          color={fallbackPct > 30 ? '#F87171' : fallbackPct > 15 ? '#FBBF24' : '#34D399'}
        />
        <StatCard
          label="Top Route"
          value={data?.topRoute ?? '—'}
          color={data?.topRoute ? ROUTE_COLOR[data.topRoute] : undefined}
        />
        <StatCard
          label="Agents Used"
          value={String(data?.byAgent?.length ?? 0)}
          sub="distinct agents"
        />
      </div>

      {/* Bar charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <MiniBarTable
          title="Runs by Agent"
          rows={(data?.byAgent ?? []).map(r => ({
            label: r.agent_name,
            count: r.count,
            sub:   r.avg_conf != null ? `avg ${Math.round(r.avg_conf * 100)}%` : undefined,
          }))}
          colorMap={AGENT_COLOR}
        />
        <MiniBarTable
          title="Runs by Route Type"
          rows={(data?.byRoute ?? []).map(r => ({
            label: r.route_type,
            count: r.count,
          }))}
          colorMap={ROUTE_COLOR}
        />
      </div>

      {/* Recent runs table */}
      <div style={{ background: '#0f1117', border: '1px solid #1f2433', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid #1f2433',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#4b5563' }}>
            Recent Runs
          </span>
          <span style={{ fontSize: 11, color: '#374151' }}>
            {data?.recent?.length ?? 0} shown
          </span>
        </div>

        {(data?.recent?.length ?? 0) === 0 && !loading && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#374151', fontSize: 13 }}>
            No agent runs found for the selected filters.
          </div>
        )}

        {(data?.recent?.length ?? 0) > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1f2433' }}>
                  {['Time', 'Org', 'Agent', 'Route', 'Query', 'Confidence', 'Rows'].map(h => (
                    <th key={h} style={{
                      padding: '8px 14px', textAlign: 'left',
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
                      textTransform: 'uppercase', color: '#4b5563',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.recent ?? []).map((row, i) => (
                  <tr
                    key={row.id}
                    style={{ borderBottom: i < (data?.recent?.length ?? 0) - 1 ? '1px solid #141720' : undefined }}
                  >
                    <td style={{ padding: '9px 14px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {timeAgo(row.created_at)}
                    </td>
                    <td style={{ padding: '9px 14px', color: '#9ca3af', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.org_name ?? '—'}
                    </td>
                    <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
                        padding: '2px 7px', borderRadius: 12,
                        background: `${AGENT_COLOR[row.agent_name] ?? '#6366F1'}18`,
                        color: AGENT_COLOR[row.agent_name] ?? '#6366F1',
                        border: `1px solid ${AGENT_COLOR[row.agent_name] ?? '#6366F1'}30`,
                      }}>
                        {row.agent_name.replace(/Agent$/, '')}
                      </span>
                    </td>
                    <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        fontSize: 11, color: ROUTE_COLOR[row.route_type] ?? '#6b7280',
                        fontWeight: 600,
                      }}>
                        {row.route_type}
                      </span>
                    </td>
                    <td style={{ padding: '9px 14px', color: '#9ca3af', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.input_query
                        ? row.input_query.length > 55
                          ? row.input_query.slice(0, 55) + '…'
                          : row.input_query
                        : <span style={{ color: '#374151' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                      {row.confidence != null ? (
                        <span style={{ color: confColor(row.confidence), fontWeight: 700 }}>
                          {Math.round(row.confidence * 100)}%
                        </span>
                      ) : <span style={{ color: '#374151' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 14px', color: '#6b7280', textAlign: 'right' }}>
                      {row.source_rows > 0 ? row.source_rows.toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
