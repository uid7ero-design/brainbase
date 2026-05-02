'use client';

import { useState } from 'react';

type RouteResult = { agent: string; confidence: number; reason: string };
type AgentOutput = {
  agentName: string;
  summary: string;
  findings: string[];
  confidence: number;
  recommendedActions: string[];
  sourceRows: unknown[];
  warnings: string[];
};
type TestResult = {
  route: RouteResult;
  agentOutput: AgentOutput | null;
  agentError: string | null;
  timing: { routeMs: number; agentMs: number; totalMs: number };
  fallbackUsed: boolean;
};

const PRESETS = [
  'Why are missed bin collections increasing?',
  'What should we do about the fleet maintenance backlog?',
  'Give me a morning briefing',
  'What changed this month?',
  'Why did contamination rates spike in Heathpool?',
  'What are our top cost drivers right now?',
  'Summarise performance across all modules',
  'How can we reduce fuel spend?',
];

const AGENT_COLORS: Record<string, string> = {
  dataIntake: '#FBBF24',
  insight:    '#38BDF8',
  action:     '#A78BFA',
  briefing:   '#34D399',
  chat:       '#6366F1',
};

const CONFIDENCE_COLOR = (c: number) =>
  c >= 0.8 ? '#34D399' : c >= 0.5 ? '#FBBF24' : '#F87171';

const cell: React.CSSProperties = {
  background: '#0f1117',
  border: '1px solid #1f2433',
  borderRadius: 10,
  padding: '18px 20px',
};

const label: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: '#4b5563',
  marginBottom: 6,
};

const value: React.CSSProperties = {
  fontSize: 13,
  color: '#e5e7eb',
  lineHeight: 1.5,
};

export default function AgentTestPage() {
  const [query, setQuery]   = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<TestResult | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function run(q = query) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setShowRaw(false);
    try {
      const res = await fetch('/api/agents/route-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data as TestResult);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 920, fontFamily: 'var(--font-inter), Inter, sans-serif' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb', marginBottom: 6 }}>Agent Test</h1>
        <p style={{ fontSize: 14, color: '#6b7280' }}>
          Type a query and see exactly which agent HLNA selects, the routing decision, full payload, and timing.
        </p>
      </div>

      {/* Presets */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {PRESETS.map(p => (
          <button
            key={p}
            onClick={() => { setQuery(p); run(p); }}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12,
              background: '#0f1117', border: '1px solid #1f2433',
              color: '#9ca3af', cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = '#38BDF8'; (e.target as HTMLElement).style.color = '#e5e7eb'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = '#1f2433'; (e.target as HTMLElement).style.color = '#9ca3af'; }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
          placeholder="Type any query…"
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 8,
            background: '#0f1117', border: '1px solid #1f2433',
            color: '#f9fafb', fontSize: 14, outline: 'none',
          }}
        />
        <button
          onClick={() => run()}
          disabled={loading || !query.trim()}
          style={{
            padding: '10px 24px', borderRadius: 8,
            background: loading ? '#1f2433' : '#1d4ed8',
            border: 'none', color: loading ? '#6b7280' : '#fff',
            fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
            transition: 'all 0.15s', whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Analysing…' : 'Analyse Query'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#1a0a0a', border: '1px solid #7f1d1d', color: '#fca5a5', marginBottom: 24 }}>
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Top row — route + timing */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Route card */}
            <div style={{ ...cell, borderColor: `${AGENT_COLORS[result.route.agent] ?? '#6366F1'}44` }}>
              <div style={label}>Route Detected</div>
              <div style={{
                fontSize: 20, fontWeight: 800,
                color: AGENT_COLORS[result.route.agent] ?? '#6366F1',
                marginBottom: 10, letterSpacing: '0.04em',
              }}>
                {result.route.agent}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div>
                  <span style={{ ...label, display: 'inline', marginBottom: 0 }}>Confidence </span>
                  <span style={{ color: CONFIDENCE_COLOR(result.route.confidence), fontWeight: 700, fontSize: 13 }}>
                    {Math.round(result.route.confidence * 100)}%
                  </span>
                </div>
                <div>
                  <span style={{ ...label, display: 'inline', marginBottom: 0 }}>Reason </span>
                  <span style={{ ...value, fontSize: 12 }}>{result.route.reason}</span>
                </div>
                <div>
                  <span style={{ ...label, display: 'inline', marginBottom: 0 }}>Method </span>
                  <span style={{ ...value, fontSize: 12 }}>
                    {result.route.reason === 'keyword match' ? 'keyword heuristic' : 'LLM classification'}
                  </span>
                </div>
              </div>
            </div>

            {/* Processing status */}
            <div style={cell}>
              <div style={label}>Processing Status</div>
              {['Routing', 'Analysing data', 'Generating response'].map((step, i) => (
                <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: '#34D39922',
                    border: '1px solid #34D399',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#34D399', fontWeight: 700, flexShrink: 0,
                  }}>✓</div>
                  <span style={{ fontSize: 12, color: i === 2 ? '#e5e7eb' : '#9ca3af' }}>{step}</span>
                  {i < 2 && <div style={{ flex: 1, height: 1, background: '#1f2433' }} />}
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                {result.fallbackUsed ? '↩ Chat fallback' : `→ ${result.route.agent} agent`}
              </div>
            </div>

            {/* Timing */}
            <div style={cell}>
              <div style={label}>Timing</div>
              {[
                { k: 'Route decision', v: result.timing.routeMs },
                { k: 'Agent run', v: result.timing.agentMs },
                { k: 'Total', v: result.timing.totalMs },
              ].map(({ k, v: ms }) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{k}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: ms > 3000 ? '#F87171' : ms > 1000 ? '#FBBF24' : '#34D399' }}>
                    {ms > 0 ? `${ms}ms` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Agent output */}
          {result.agentError && (
            <div style={{ padding: '12px 16px', borderRadius: 8, background: '#1a0a0a', border: '1px solid #7f1d1d', color: '#fca5a5', marginBottom: 16 }}>
              Agent error: {result.agentError}
            </div>
          )}

          {result.agentOutput && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              {/* Summary + agent name */}
              <div style={cell}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={label}>Agent Output</div>
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
                    padding: '2px 8px', borderRadius: 20,
                    background: `${AGENT_COLORS[result.route.agent] ?? '#6366F1'}22`,
                    color: AGENT_COLORS[result.route.agent] ?? '#6366F1',
                    border: `1px solid ${AGENT_COLORS[result.route.agent] ?? '#6366F1'}44`,
                  }}>
                    {result.agentOutput.agentName}
                  </div>
                </div>
                <div style={{ ...value, fontSize: 13, marginBottom: 10 }}>{result.agentOutput.summary}</div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div>
                    <div style={label}>Confidence</div>
                    <div style={{ color: CONFIDENCE_COLOR(result.agentOutput.confidence), fontWeight: 700 }}>
                      {Math.round(result.agentOutput.confidence * 100)}%
                    </div>
                  </div>
                  <div>
                    <div style={label}>Source rows</div>
                    <div style={value}>{result.agentOutput.sourceRows?.length ?? 0}</div>
                  </div>
                </div>
              </div>

              {/* Findings + actions */}
              <div style={cell}>
                {result.agentOutput.findings?.length > 0 && (
                  <>
                    <div style={label}>Findings</div>
                    <ul style={{ margin: '0 0 14px 0', padding: '0 0 0 16px' }}>
                      {result.agentOutput.findings.map((f, i) => (
                        <li key={i} style={{ ...value, fontSize: 12, marginBottom: 4 }}>{f}</li>
                      ))}
                    </ul>
                  </>
                )}
                {result.agentOutput.recommendedActions?.length > 0 && (
                  <>
                    <div style={label}>Recommended Actions</div>
                    <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                      {result.agentOutput.recommendedActions.map((a, i) => (
                        <li key={i} style={{ ...value, fontSize: 12, marginBottom: 4, color: '#A78BFA' }}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {result.agentOutput.warnings?.length > 0 && (
                  <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: '#1a1200', border: '1px solid #7a4a0022' }}>
                    <div style={{ ...label, color: '#FBBF24' }}>Warnings</div>
                    {result.agentOutput.warnings.map((w, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#FBBF24' }}>⚠ {w}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Raw JSON toggle */}
          <div style={cell}>
            <button
              onClick={() => setShowRaw(v => !v)}
              style={{
                background: 'none', border: 'none', color: '#6b7280',
                fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit',
              }}
            >
              {showRaw ? '▼' : '▶'} Raw JSON
            </button>
            {showRaw && (
              <pre style={{
                marginTop: 12, padding: 14, borderRadius: 6,
                background: '#080a0f', border: '1px solid #1f2433',
                fontSize: 11, color: '#9ca3af', overflow: 'auto',
                maxHeight: 400, lineHeight: 1.6,
              }}>
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}
