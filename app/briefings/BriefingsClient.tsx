'use client';
import { useState, useEffect, useCallback } from 'react';
import { generateReportHTML } from '../../lib/evidence-report';

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const AGENT_COLOR: Record<string, string> = {
  InsightAgent:    '#38BDF8',
  ActionAgent:     '#A78BFA',
  BriefingAgent:   '#34D399',
  DataIntakeAgent: '#FBBF24',
  HLNAChatAgent:   '#6366F1',
};
const AGENT_ICON: Record<string, string> = {
  InsightAgent:    '◎',
  ActionAgent:     '⚡',
  BriefingAgent:   '◈',
  DataIntakeAgent: '↑',
  HLNAChatAgent:   '◈',
};

const TYPE_LABELS: Record<string, string> = {
  insight:    'Insight',
  action:     'Action',
  briefing:   'Briefing',
  chat:       'Chat',
  dataIntake: 'Data Intake',
};

const FILTERS = [
  { key: null,         label: 'All' },
  { key: 'briefing',  label: 'Briefing' },
  { key: 'insight',   label: 'Insight' },
  { key: 'action',    label: 'Action' },
  { key: 'chat',      label: 'Chat' },
];

type Evidence = {
  sourceDataset: string[];
  sourceColumns: string[];
  evidenceSummary: string;
  calculationUsed: string;
  confidenceReason: string;
  sampleRows: Record<string, unknown>[];
};

type Briefing = {
  id: string;
  title: string;
  briefing_type: string | null;
  agent_name: string | null;
  response_text: string | null;
  evidence_json: Evidence | null;
  created_at: string;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function EvidencePanel({ evidence }: { evidence: Evidence }) {
  const sampleHeaders = evidence.sampleRows?.length > 0
    ? Object.keys(evidence.sampleRows[0]).slice(0, 6)
    : [];

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Datasets + columns */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Datasets</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(evidence.sourceDataset ?? []).map(d => (
              <span key={d} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.22)', color: '#38BDF8', fontWeight: 600 }}>{d}</span>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Columns</div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {(evidence.sourceColumns ?? []).slice(0, 10).map(c => (
              <span key={c} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.45)' }}>{c}</span>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Evidence</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.60)', lineHeight: 1.55 }}>{evidence.evidenceSummary}</div>
      </div>

      <div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Calculation</div>
        <div style={{ fontSize: 11, color: '#38BDF8', fontFamily: 'monospace', lineHeight: 1.55, background: 'rgba(56,189,248,0.05)', borderRadius: 6, padding: '6px 10px' }}>{evidence.calculationUsed}</div>
      </div>

      <div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Confidence reason</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.60)', lineHeight: 1.55 }}>{evidence.confidenceReason}</div>
      </div>

      {sampleHeaders.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
            Sample data ({Math.min(evidence.sampleRows.length, 3)} rows)
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 10, width: '100%' }}>
              <thead>
                <tr>
                  {sampleHeaders.map(h => (
                    <th key={h} style={{ padding: '3px 8px 5px', textAlign: 'left', color: 'rgba(255,255,255,0.28)', borderBottom: '1px solid rgba(255,255,255,0.07)', whiteSpace: 'nowrap', fontWeight: 700, letterSpacing: '0.05em', fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evidence.sampleRows.slice(0, 3).map((r, ri) => (
                  <tr key={ri}>
                    {sampleHeaders.map(h => (
                      <td key={h} style={{ padding: '4px 8px', color: 'rgba(255,255,255,0.50)', borderBottom: ri < 2 ? '1px solid rgba(255,255,255,0.04)' : undefined, whiteSpace: 'nowrap' }}>
                        {String(r[h] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function BriefingCard({ b, onDelete }: { b: Briefing; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const color = AGENT_COLOR[b.agent_name ?? ''] ?? '#6366F1';
  const icon  = AGENT_ICON[b.agent_name ?? '']  ?? '◈';
  const typeLabel = TYPE_LABELS[b.briefing_type ?? ''] ?? b.briefing_type ?? 'Agent';

  function exportReport() {
    const html = generateReportHTML({
      content:    b.response_text,
      agentName:  b.agent_name,
      routeType:  b.briefing_type,
      confidence: null,
      evidence:   b.evidence_json,
      orgName:    null,
      timestamp:  b.created_at,
    });
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      border: `1px solid ${open ? color + '30' : 'rgba(255,255,255,0.07)'}`,
      background: open ? `${color}06` : 'rgba(255,255,255,0.02)',
      transition: 'border-color 0.2s, background 0.2s',
    }}>
      {/* Card header — always visible */}
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', fontFamily: FONT,
        }}
      >
        <span style={{ fontSize: 14, color, flexShrink: 0 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.88)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {b.title}
          </div>
          <div style={{ marginTop: 3, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: `${color}18`, color, fontWeight: 700, letterSpacing: '0.06em' }}>
              {typeLabel}
            </span>
            {b.agent_name && (
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.04em' }}>
                {b.agent_name.replace(/([A-Z])/g, ' $1').trim()}
              </span>
            )}
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.22)' }}>{timeAgo(b.created_at)}</span>
          </div>
        </div>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : undefined }}>▼</span>
      </button>

      {/* Expanded body */}
      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          {b.response_text && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'rgba(255,255,255,0.78)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {b.response_text}
            </div>
          )}

          {b.evidence_json && (
            <>
              <button
                onClick={() => setEvidenceOpen(p => !p)}
                style={{
                  marginTop: 12, background: 'none',
                  border: `1px solid ${evidenceOpen ? color : 'rgba(255,255,255,0.10)'}`,
                  borderRadius: 5, cursor: 'pointer', padding: '3px 10px',
                  color: evidenceOpen ? color : 'rgba(255,255,255,0.35)',
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', fontFamily: FONT,
                }}
              >
                {evidenceOpen ? '▲ HIDE EVIDENCE' : '▼ VIEW EVIDENCE'}
              </button>
              {evidenceOpen && <EvidencePanel evidence={b.evidence_json} />}
            </>
          )}

          {/* Action row */}
          <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
            <button
              onClick={exportReport}
              style={actionBtn}
            >
              ↗ Export report
            </button>
            <button
              onClick={() => onDelete(b.id)}
              style={{ ...actionBtn, color: 'rgba(248,113,113,0.55)', borderColor: 'rgba(248,113,113,0.18)' }}
            >
              ✕ Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const actionBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 5, cursor: 'pointer',
  padding: '4px 10px',
  color: 'rgba(255,255,255,0.45)',
  fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
  fontFamily: FONT,
};

export default function BriefingsClient() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [filter, setFilter]       = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = filter ? `?type=${filter}` : '';
    const res = await fetch(`/api/briefings${params}`);
    if (res.ok) {
      const data = await res.json();
      setBriefings(data.briefings ?? []);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function deleteBriefing(id: string) {
    await fetch(`/api/briefings?id=${id}`, { method: 'DELETE' });
    setBriefings(prev => prev.filter(b => b.id !== id));
  }

  return (
    <div style={{ minHeight: '100vh', background: '#06070F', color: '#f9fafb', fontFamily: FONT, padding: '0 0 60px' }}>

      {/* Top accent */}
      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(124,58,237,0.6), rgba(56,189,248,0.3), transparent)' }} />

      {/* Header */}
      <div style={{ padding: '32px 40px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <a href="/dashboard" style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textDecoration: 'none', letterSpacing: '0.06em' }}>← DASHBOARD</a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 10, color: 'rgba(124,58,237,0.70)', fontWeight: 700, letterSpacing: '0.12em' }}>◈</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.01em', margin: 0 }}>Saved Briefings</h1>
          {briefings.length > 0 && (
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)', color: '#A78BFA', fontWeight: 700 }}>
              {briefings.length}
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 6, marginBottom: 0 }}>
          HLNA agent responses saved for reference and reporting.
        </p>
      </div>

      <div style={{ padding: '24px 40px 0' }}>
        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
          {FILTERS.map(f => {
            const active = filter === f.key;
            return (
              <button
                key={String(f.key)}
                onClick={() => setFilter(f.key)}
                style={{
                  padding: '5px 14px', borderRadius: 6,
                  background: active ? 'rgba(124,58,237,0.20)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${active ? 'rgba(124,58,237,0.45)' : 'rgba(255,255,255,0.08)'}`,
                  color: active ? '#C4B5FD' : 'rgba(255,255,255,0.45)',
                  fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer', fontFamily: FONT,
                  letterSpacing: '0.04em', transition: 'all 0.15s',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
            Loading briefings…
          </div>
        ) : briefings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 32, color: 'rgba(124,58,237,0.30)', marginBottom: 12, letterSpacing: '0.1em' }}>◈</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.30)', marginBottom: 6 }}>No saved briefings yet</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)' }}>
              Open HLNA and save any response using the &ldquo;Save briefing&rdquo; button in the evidence panel.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 760 }}>
            {briefings.map(b => (
              <BriefingCard key={b.id} b={b} onDelete={deleteBriefing} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
