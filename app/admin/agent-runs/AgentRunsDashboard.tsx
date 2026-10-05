'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import {
  PageHeader,
  WorkToolbar,
  toolbarControlClassName,
  MetricStrip,
  Metric,
  Panel,
  StateMessage,
  TableContainer,
  tableStyles,
  buttonProps,
  type MetricTone,
} from '@/components/ui/app';
import styles from './AgentRuns.module.css';

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

// Agent / route identity hues (data encoding). Resolved per theme from
// AgentRuns.module.css; used on dots and bars only, labels stay on text
// tokens (the raw hues failed text contrast in light).
const AGENT_COLOR: Record<string, string> = {
  InsightAgent:    'var(--agent-insight)',
  ActionAgent:     'var(--agent-action)',
  BriefingAgent:   'var(--agent-briefing)',
  DataIntakeAgent: 'var(--agent-intake)',
  HLNAChatAgent:   'var(--agent-chat)',
};
const ROUTE_COLOR: Record<string, string> = {
  insight:    'var(--agent-insight)',
  action:     'var(--agent-action)',
  briefing:   'var(--agent-briefing)',
  dataIntake: 'var(--agent-intake)',
  chat:       'var(--agent-chat)',
};

/** Inline custom property carrying an identity hue into the CSS module. */
function hueVar(color: string): React.CSSProperties {
  return { ['--hue' as string]: color } as React.CSSProperties;
}

function confColor(c: number | null): string {
  if (c == null) return 'var(--text-muted)';
  if (c >= 0.8) return 'var(--status-success)';
  if (c >= 0.5) return 'var(--status-warning)';
  return 'var(--status-danger)';
}

/** Same thresholds as confColor, as a MetricStrip tone. */
function confTone(c: number | null): MetricTone | undefined {
  if (c == null) return undefined;
  if (c >= 0.8) return 'success';
  if (c >= 0.5) return 'warning';
  return 'danger';
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

function MiniBarTable({
  title, rows, colorMap,
}: {
  title: string;
  rows: { label: string; count: number; sub?: string }[];
  colorMap: Record<string, string>;
}) {
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <Panel title={title}>
      {rows.length === 0 && (
        <div className={styles.noData}>No data</div>
      )}
      <ul className={styles.bars}>
        {rows.map(row => {
          const color = colorMap[row.label] ?? 'var(--text-muted)';
          const pct   = (row.count / max) * 100;
          return (
            <li key={row.label} style={hueVar(color)}>
              <div className={styles.barHead}>
                <span className={styles.barLabel}>
                  <span className={styles.dot} aria-hidden="true" />
                  {row.label.replace(/Agent$/, ' Agent')}
                </span>
                <div className={styles.barMeta}>
                  {row.sub && <span className={styles.barSub}>{row.sub}</span>}
                  <span className={styles.barCount}>
                    {row.count}
                  </span>
                </div>
              </div>
              <div className={styles.track} aria-hidden="true">
                <div className={styles.fill} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
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
  const fromId = useId();
  const toId   = useId();

  return (
    <WorkToolbar
      count={loading ? <span className={styles.refreshing}>Refreshing…</span> : undefined}
      actions={
        <button type="button" onClick={onReset} {...buttonProps('secondary', 'sm')}>
          Reset
        </button>
      }
    >
      <select aria-label="Organisation" value={filters.orgId} onChange={e => onChange('orgId', e.target.value)} className={toolbarControlClassName}>
        <option value="">All organisations</option>
        {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>

      <div className={styles.dates}>
        <label htmlFor={fromId} className={styles.dateLabel}>From</label>
        <input id={fromId} type="date" value={filters.from} onChange={e => onChange('from', e.target.value)} className={toolbarControlClassName} />
        <label htmlFor={toId} className={styles.dateLabel}>to</label>
        <input id={toId} type="date" value={filters.to}   onChange={e => onChange('to',   e.target.value)} className={toolbarControlClassName} />
      </div>

      <select aria-label="Agent" value={filters.agentName} onChange={e => onChange('agentName', e.target.value)} className={toolbarControlClassName}>
        <option value="">All agents</option>
        {AGENT_NAMES.map(a => <option key={a} value={a}>{a.replace(/Agent$/, ' Agent')}</option>)}
      </select>

      <select aria-label="Route type" value={filters.routeType} onChange={e => onChange('routeType', e.target.value)} className={toolbarControlClassName}>
        <option value="">All routes</option>
        {ROUTE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
    </WorkToolbar>
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
    <div className={styles.root}>

      {/* Header */}
      <PageHeader
        title="Agent Runs"
        description="Audit log of every specialist agent invocation — routing decisions, confidence, and query history."
      />

      {/* Filters */}
      <FilterBar
        filters={filters}
        orgs={data?.orgs ?? orgs}
        onChange={setFilter}
        onReset={resetFilters}
        loading={loading}
      />

      {error && (
        <StateMessage kind="error" title={error} className={styles.error} />
      )}

      {/* Stat cards */}
      <div className={styles.metrics}>
        <MetricStrip>
          <Metric label="Total Runs" value={stats.total_runs.toLocaleString()} />
          <Metric
            label="Avg Confidence"
            value={avgConfPct != null ? `${avgConfPct}%` : '—'}
            tone={avgConfPct != null ? confTone(stats.avg_confidence) : undefined}
          />
          <Metric
            label="Fallback Rate"
            value={`${fallbackPct}%`}
            sub={`${stats.fallback_count} chat fallbacks`}
            tone={fallbackPct > 30 ? 'danger' : fallbackPct > 15 ? 'warning' : 'success'}
          />
          <Metric
            label="Top Route"
            value={data?.topRoute ? (
              <span className={styles.tag} style={hueVar(ROUTE_COLOR[data.topRoute] ?? 'var(--text-muted)')}>
                <span className={styles.dot} aria-hidden="true" />
                {data.topRoute}
              </span>
            ) : '—'}
          />
          <Metric
            label="Agents Used"
            value={String(data?.byAgent?.length ?? 0)}
            sub="distinct agents"
          />
        </MetricStrip>
      </div>

      {/* Bar charts */}
      <div className={styles.charts}>
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
      <div>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            Recent Runs
          </h2>
          <span className={styles.shown}>
            {data?.recent?.length ?? 0} shown
          </span>
        </div>

        {(data?.recent?.length ?? 0) === 0 && !loading && (
          <StateMessage kind="empty" title="No agent runs found for the selected filters." />
        )}

        {(data?.recent?.length ?? 0) > 0 && (
          <TableContainer label="Recent runs" minWidth={760}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  {['Time', 'Org', 'Agent', 'Route', 'Query', 'Confidence', 'Rows'].map(h => (
                    <th key={h} scope="col" className={h === 'Confidence' || h === 'Rows' ? tableStyles.num : undefined}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.recent ?? []).map(row => (
                  <tr key={row.id}>
                    <td className={styles.nowrap}>
                      {timeAgo(row.created_at)}
                    </td>
                    <td>
                      <span className={`${styles.truncate} ${styles.org}`}>{row.org_name ?? '—'}</span>
                    </td>
                    <td>
                      <span className={styles.tag} style={hueVar(AGENT_COLOR[row.agent_name] ?? 'var(--text-muted)')}>
                        <span className={styles.dot} aria-hidden="true" />
                        {row.agent_name.replace(/Agent$/, '')}
                      </span>
                    </td>
                    <td>
                      <span className={styles.tag} style={hueVar(ROUTE_COLOR[row.route_type] ?? 'var(--text-muted)')}>
                        <span className={styles.dot} aria-hidden="true" />
                        {row.route_type}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.truncate} ${styles.query}`}>
                        {row.input_query
                          ? row.input_query.length > 55
                            ? row.input_query.slice(0, 55) + '…'
                            : row.input_query
                          : <span className={tableStyles.muted}>—</span>}
                      </span>
                    </td>
                    <td className={tableStyles.num}>
                      {row.confidence != null ? (
                        <span style={{ color: confColor(row.confidence), fontWeight: 700 }}>
                          {Math.round(row.confidence * 100)}%
                        </span>
                      ) : <span className={tableStyles.muted}>—</span>}
                    </td>
                    <td className={tableStyles.num}>
                      {row.source_rows > 0 ? row.source_rows.toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableContainer>
        )}
      </div>
    </div>
  );
}
