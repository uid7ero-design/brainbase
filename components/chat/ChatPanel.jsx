'use client';
import { useState, useRef, useEffect } from "react";
import { CYAN } from "../../lib/utils/constants";
import { generateReportHTML } from "../../lib/evidence-report";

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const CONFIDENCE_COLOR = { High: '#34D399', Medium: '#FBBF24', Low: '#F87171' };

const AGENT_COLOR = {
  InsightAgent:    '#38BDF8',
  ActionAgent:     '#A78BFA',
  BriefingAgent:   '#34D399',
  DataIntakeAgent: '#FBBF24',
  HLNAChatAgent:   '#6366F1',
};
const AGENT_ICON = {
  InsightAgent:    '◎',
  ActionAgent:     '⚡',
  BriefingAgent:   '◈',
  DataIntakeAgent: '↑',
  HLNAChatAgent:   '◈',
};

function AgentBadge({ agentName, confidence, findings, warnings, hasEvidence, evidenceOpen, onViewEvidence }) {
  const color = AGENT_COLOR[agentName] ?? '#A78BFA';
  const icon  = AGENT_ICON[agentName]  ?? '◈';
  const pct   = confidence != null ? Math.round(confidence * 100) : null;
  const confColor = pct >= 80 ? '#34D399' : pct >= 50 ? '#FBBF24' : '#F87171';
  const hasMeta = (findings?.length > 0) || (warnings?.length > 0);

  return (
    <div style={{
      maxWidth: "84%", borderRadius: 8, overflow: "hidden",
      border: `1px solid ${color}20`,
      background: `${color}08`,
      fontSize: 10, color: "rgba(255,255,255,0.60)",
      marginTop: 2,
    }}>
      {/* header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 10px",
        borderBottom: hasMeta ? `1px solid rgba(255,255,255,0.05)` : undefined,
        background: `${color}06`,
      }}>
        <span style={{ color, fontWeight: 700, letterSpacing: "0.09em", fontSize: 8 }}>
          {icon} {agentName?.replace(/([A-Z])/g, ' $1').trim().toUpperCase() ?? 'AGENT'}
        </span>
        <span style={{ flex: 1 }} />
        {pct != null && (
          <span style={{ color: confColor, fontWeight: 700, fontSize: 8, letterSpacing: "0.06em" }}>
            {pct}% CONFIDENCE
          </span>
        )}
        {warnings?.length > 0 && (
          <span style={{ color: '#FBBF24', fontSize: 8, marginLeft: 6 }}>⚠ {warnings.length}</span>
        )}
        {hasEvidence && (
          <button
            onClick={onViewEvidence}
            style={{
              background: "none", border: `1px solid ${evidenceOpen ? color : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 4, cursor: "pointer", padding: "1px 6px",
              color: evidenceOpen ? color : "rgba(255,255,255,0.28)",
              fontSize: 8, fontWeight: 700, letterSpacing: "0.07em",
              fontFamily: FONT, marginLeft: 4, transition: "all 0.15s",
            }}
          >
            {evidenceOpen ? "▲ EVIDENCE" : "▼ EVIDENCE"}
          </button>
        )}
      </div>

      {/* findings */}
      {findings?.length > 0 && (
        <div style={{ padding: "6px 10px" }}>
          {findings.slice(0, 2).map((f, i) => (
            <div key={i} style={{ fontSize: 10, color: "rgba(255,255,255,0.50)", lineHeight: 1.4, marginBottom: i < findings.length - 1 ? 3 : 0 }}>
              · {f}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PIPELINE_STEPS = ['Routing…', 'Analysing data…', 'Generating response…'];

function EvidenceDrawer({ evidence, confidence, onExport, onCopy, copied, onSend, sendDone, onSave, saveDone }) {
  const pct    = confidence != null ? Math.round(confidence * 100) : null;
  const cColor = pct >= 80 ? '#34D399' : pct >= 50 ? '#FBBF24' : '#F87171';

  const sampleHeaders = evidence?.sampleRows?.length > 0
    ? Object.keys(evidence.sampleRows[0]).slice(0, 5)
    : [];

  const row = (label, content, mono = false) => (
    <div style={{ padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ color: "rgba(255,255,255,0.22)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ color: mono ? "#38BDF8" : "rgba(255,255,255,0.62)", fontSize: 10, lineHeight: 1.55, fontFamily: mono ? "monospace" : FONT }}>
        {content}
      </div>
    </div>
  );

  return (
    <div style={{
      maxWidth: "84%", borderRadius: 8, overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(8,10,18,0.97)",
      fontSize: 10,
      animation: "chatSlideUp 0.18s ease",
    }}>

      {/* Datasets + columns */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "rgba(255,255,255,0.22)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Datasets</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(evidence?.sourceDataset ?? []).map(d => (
              <span key={d} style={{
                fontSize: 9, padding: "2px 6px", borderRadius: 4,
                background: "rgba(56,189,248,0.10)", border: "1px solid rgba(56,189,248,0.22)",
                color: "#38BDF8", fontWeight: 600, letterSpacing: "0.03em",
              }}>{d}</span>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "rgba(255,255,255,0.22)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Columns queried</div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {(evidence?.sourceColumns ?? []).slice(0, 10).map(c => (
              <span key={c} style={{
                fontSize: 9, padding: "1px 5px", borderRadius: 3,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.50)",
              }}>{c}</span>
            ))}
          </div>
        </div>
      </div>

      {row("Evidence", evidence?.evidenceSummary ?? "—")}
      {row("Calculation", evidence?.calculationUsed ?? "—", true)}

      {/* Confidence reason with % badge */}
      <div style={{ padding: "7px 10px", borderBottom: sampleHeaders.length > 0 ? "1px solid rgba(255,255,255,0.04)" : undefined, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: "rgba(255,255,255,0.22)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Confidence reason</div>
          <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 10, lineHeight: 1.55 }}>{evidence?.confidenceReason ?? "—"}</div>
        </div>
        {pct != null && (
          <div style={{ fontSize: 18, fontWeight: 800, color: cColor, flexShrink: 0, lineHeight: 1, paddingTop: 2 }}>{pct}%</div>
        )}
      </div>

      {/* Sample rows */}
      {sampleHeaders.length > 0 && evidence?.sampleRows?.length > 0 && (
        <div style={{ padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ color: "rgba(255,255,255,0.22)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
            Sample data ({Math.min(evidence.sampleRows.length, 3)} of {evidence.sampleRows.length} rows)
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 9, width: "100%" }}>
              <thead>
                <tr>
                  {sampleHeaders.map(h => (
                    <th key={h} style={{ padding: "2px 8px 4px", textAlign: "left", color: "rgba(255,255,255,0.28)", borderBottom: "1px solid rgba(255,255,255,0.07)", whiteSpace: "nowrap", fontWeight: 700, letterSpacing: "0.05em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evidence.sampleRows.slice(0, 3).map((r, ri) => (
                  <tr key={ri}>
                    {sampleHeaders.map(h => (
                      <td key={h} style={{ padding: "3px 8px", color: "rgba(255,255,255,0.52)", borderBottom: ri < 2 ? "1px solid rgba(255,255,255,0.04)" : undefined, whiteSpace: "nowrap" }}>
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

      {/* Action buttons */}
      <div style={{ padding: "8px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { label: "↗ Export report",                          key: "export", onClick: onExport, active: false },
          { label: copied  ? "✓ Copied"  : "⎘ Copy summary",  key: "copy",   onClick: onCopy,   active: copied },
          { label: saveDone ? "✓ Saved"  : "☁ Save briefing", key: "save",   onClick: onSave,   active: saveDone },
          { label: sendDone ? "✓ Sent"   : "↪ Send to manager", key: "send", onClick: onSend,   active: sendDone },
        ].map(btn => (
          <button
            key={btn.key}
            onClick={btn.onClick}
            style={{
              background: btn.active ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${btn.active ? "rgba(52,211,153,0.35)" : "rgba(255,255,255,0.10)"}`,
              borderRadius: 5, cursor: "pointer",
              padding: "4px 9px",
              color: btn.active ? "#34D399" : "rgba(255,255,255,0.45)",
              fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
              fontFamily: FONT, transition: "all 0.15s",
            }}
            onMouseEnter={e => { if (!btn.active) { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}}
            onMouseLeave={e => { if (!btn.active) { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(255,255,255,0.45)"; }}}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AnalysisCard({ analysis }) {
  const { dataSources, rowsQueried, trend, anomaly, confidence, timestamp } = analysis;
  const ts = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div style={{
      maxWidth: "84%", borderRadius: 8, overflow: "hidden",
      border: "1px solid rgba(56,189,248,0.18)",
      background: "rgba(14,22,38,0.70)",
      fontSize: 10, color: "rgba(255,255,255,0.60)",
      marginTop: 2,
    }}>
      {/* header row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 10px", borderBottom: "1px solid rgba(56,189,248,0.10)",
        background: "rgba(56,189,248,0.05)",
      }}>
        <span style={{ color: "rgba(56,189,248,0.75)", fontWeight: 700, letterSpacing: "0.09em", fontSize: 8 }}>◈ ANALYSIS</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: CONFIDENCE_COLOR[confidence], fontWeight: 700, letterSpacing: "0.06em", fontSize: 8 }}>
          {confidence.toUpperCase()} CONFIDENCE
        </span>
        <span style={{ color: "rgba(255,255,255,0.20)", fontSize: 8 }}>{ts}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        {/* data source */}
        <div style={{ padding: "6px 10px", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ color: "rgba(255,255,255,0.30)", letterSpacing: "0.07em", marginBottom: 2, fontSize: 8 }}>SOURCE</div>
          <div style={{ color: "rgba(255,255,255,0.70)", lineHeight: 1.4 }}>
            {dataSources.length ? dataSources.join(', ') : '—'}
          </div>
        </div>
        {/* rows */}
        <div style={{ padding: "6px 10px" }}>
          <div style={{ color: "rgba(255,255,255,0.30)", letterSpacing: "0.07em", marginBottom: 2, fontSize: 8 }}>ROWS ANALYSED</div>
          <div style={{ color: "rgba(255,255,255,0.70)" }}>{rowsQueried.toLocaleString()}</div>
        </div>
      </div>

      {(trend || anomaly) && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {trend && (
            <div style={{ padding: "6px 10px", display: "flex", gap: 6, alignItems: "flex-start", borderBottom: anomaly ? "1px solid rgba(255,255,255,0.05)" : undefined }}>
              <span style={{ color: "#34D399", fontWeight: 700, fontSize: 8, letterSpacing: "0.07em", flexShrink: 0, paddingTop: 1 }}>TREND</span>
              <span style={{ color: "rgba(255,255,255,0.65)", lineHeight: 1.4 }}>{trend}</span>
            </div>
          )}
          {anomaly && (
            <div style={{ padding: "6px 10px", display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ color: "#FBBF24", fontWeight: 700, fontSize: 8, letterSpacing: "0.07em", flexShrink: 0, paddingTop: 1 }}>ANOMALY</span>
              <span style={{ color: "rgba(255,255,255,0.65)", lineHeight: 1.4 }}>{anomaly}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatPanel({ messages, responding, transcript, onSend, onClose }) {
  const [input, setInput]                 = useState('');
  const [pipelineStep, setPipelineStep]   = useState(0);
  const [openEvidence, setOpenEvidence]   = useState(() => new Set());
  const [copiedStates, setCopiedStates]   = useState({});
  const [sendStates, setSendStates]       = useState({});
  const [savedStates, setSavedStates]     = useState({});
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  function toggleEvidence(i) {
    setOpenEvidence(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  function exportReport(m) {
    const html = generateReportHTML({
      content:    m.content,
      agentName:  m.meta?.agentName,
      routeType:  m.meta?.routeType,
      confidence: m.meta?.confidence,
      evidence:   m.meta?.evidence,
      orgName:    null,
      timestamp:  new Date().toISOString(),
    });
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  function copyEvidenceSummary(i, text) {
    navigator.clipboard.writeText(text ?? '').then(() => {
      setCopiedStates(p => ({ ...p, [i]: true }));
      setTimeout(() => setCopiedStates(p => ({ ...p, [i]: false })), 2000);
    });
  }

  function activateSend(i) {
    setSendStates(p => ({ ...p, [i]: true }));
    setTimeout(() => setSendStates(p => ({ ...p, [i]: false })), 3000);
  }

  async function saveBriefing(i, m) {
    const title = (m.content ?? '').slice(0, 72).trim() || 'HLNA Briefing';
    await fetch('/api/briefings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        briefingType: m.meta?.routeType ?? null,
        agentName:    m.meta?.agentName  ?? null,
        responseText: m.content,
        evidenceJson: m.meta?.evidence   ?? null,
      }),
    });
    setSavedStates(p => ({ ...p, [i]: true }));
    setTimeout(() => setSavedStates(p => ({ ...p, [i]: false })), 3000);
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, transcript]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Pipeline animation: routing → analysing → generating
  useEffect(() => {
    if (!responding) { setPipelineStep(0); return; }
    const t1 = setTimeout(() => setPipelineStep(1), 700);
    const t2 = setTimeout(() => setPipelineStep(2), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [responding]);

  const submit = () => {
    const t = input.trim();
    if (!t) return;
    setInput('');
    onSend(t);
  };

  return (
    <div style={{
      position: "fixed", bottom: 86, left: "50%", transform: "translateX(-50%)",
      width: "min(580px, 92vw)", zIndex: 60,
      display: "flex", flexDirection: "column",
      animation: "chatSlideUp 0.28s cubic-bezier(0.16,1,0.3,1)",
      borderRadius: 14, overflow: "hidden",
      background: "rgba(7, 7, 16, 0.97)",
      border: "1px solid rgba(124,58,237,0.18)",
      boxShadow: "0 0 0 1px rgba(124,58,237,0.05), 0 28px 70px rgba(0,0,0,0.90), 0 0 100px rgba(124,58,237,0.06)",
      backdropFilter: "blur(32px)",
      WebkitBackdropFilter: "blur(32px)",
      fontFamily: FONT,
    }}>

      {/* Top accent gradient */}
      <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(124,58,237,0.6), rgba(56,189,248,0.3), transparent)" }} />

      {/* Header */}
      <div style={{
        padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(124,58,237,0.04)",
      }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: responding ? "#A78BFA" : CYAN,
            boxShadow: `0 0 8px ${responding ? "#A78BFA" : CYAN}`,
            animation: "agentPulse 2s ease-in-out infinite",
          }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.80)", textTransform: "uppercase" }}>
            HLNΛ
          </span>
          <span style={{ fontSize: 9, letterSpacing: "0.06em", color: "rgba(255,255,255,0.22)", textTransform: "uppercase" }}>
            · Hyper Learning Neural Agent
          </span>
        </div>
        <a
          href="/briefings"
          style={{
            fontSize: 9, color: "rgba(167,139,250,0.55)", letterSpacing: "0.06em",
            textDecoration: "none", fontWeight: 700,
            border: "1px solid rgba(167,139,250,0.15)", borderRadius: 4,
            padding: "2px 7px", transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "#C4B5FD"; e.currentTarget.style.borderColor = "rgba(167,139,250,0.40)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "rgba(167,139,250,0.55)"; e.currentTarget.style.borderColor = "rgba(167,139,250,0.15)"; }}
        >
          SAVED BRIEFINGS
        </a>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.18)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          ESC TO CLOSE
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24, height: 24, borderRadius: 6,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.38)", fontSize: 11, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s", fontFamily: FONT,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(255,255,255,0.38)"; }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div style={{ maxHeight: 340, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && !responding && (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <div style={{ fontSize: 22, color: "rgba(124,58,237,0.45)", marginBottom: 8, letterSpacing: "0.1em" }}>◈</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", letterSpacing: "0.04em" }}>
              Ask HLNΛ about your dashboards, data, or operations.
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 6 }}>
              Try: "What are our top cost drivers?" or "Explain the waste contamination trend"
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 3 }}>
            <div style={{
              fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
              color: m.role === "user" ? "rgba(255,255,255,0.22)" : "rgba(167,139,250,0.70)",
              paddingLeft: m.role === "user" ? 0 : 2, paddingRight: m.role === "user" ? 2 : 0,
            }}>
              {m.role === "user" ? "YOU" : "◈ HLNΛ"}
            </div>
            <div style={{
              maxWidth: "84%", padding: "9px 12px", borderRadius: m.role === "user" ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
              background: m.role === "user"
                ? "rgba(255,255,255,0.06)"
                : "rgba(99,102,241,0.14)",
              border: m.role === "user"
                ? "1px solid rgba(255,255,255,0.08)"
                : "1px solid rgba(99,102,241,0.25)",
              fontSize: 12, color: "rgba(255,255,255,0.88)", lineHeight: 1.65,
            }}>
              {m.content}
            </div>
            {m.meta?.analysis && <AnalysisCard analysis={m.meta.analysis} />}
            {m.role === 'assistant' && m.meta?.agentName && (
              <>
                <AgentBadge
                  agentName={m.meta.agentName}
                  confidence={m.meta.confidence}
                  findings={m.meta.findings}
                  warnings={m.meta.warnings}
                  hasEvidence={!!m.meta.evidence}
                  evidenceOpen={openEvidence.has(i)}
                  onViewEvidence={() => toggleEvidence(i)}
                />
                {openEvidence.has(i) && m.meta.evidence && (
                  <EvidenceDrawer
                    evidence={m.meta.evidence}
                    confidence={m.meta.confidence}
                    onExport={() => exportReport(m)}
                    onCopy={() => copyEvidenceSummary(i, m.meta.evidence?.evidenceSummary)}
                    copied={!!copiedStates[i]}
                    onSave={() => saveBriefing(i, m)}
                    saveDone={!!savedStates[i]}
                    onSend={() => activateSend(i)}
                    sendDone={!!sendStates[i]}
                  />
                )}
              </>
            )}
          </div>
        ))}

        {/* Live transcript */}
        {transcript && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.18)", paddingRight: 2 }}>YOU</div>
            <div style={{
              maxWidth: "84%", padding: "9px 12px", borderRadius: "10px 10px 3px 10px",
              background: "rgba(0,207,234,0.05)", border: "1px dashed rgba(0,207,234,0.18)",
              fontSize: 12, color: "rgba(255,255,255,0.50)", lineHeight: 1.65, fontStyle: "italic",
            }}>
              {transcript}
            </div>
          </div>
        )}

        {/* Thinking indicator */}
        {responding && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(167,139,250,0.70)" }}>◈ HLNΛ</div>
            <div style={{
              padding: "10px 14px", borderRadius: "10px 10px 10px 3px",
              background: "rgba(99,102,241,0.10)", border: "1px solid rgba(99,102,241,0.22)",
              display: "flex", gap: 6, alignItems: "center",
            }}>
              {[0, 0.2, 0.4].map(d => (
                <div key={d} style={{ width: 4, height: 4, borderRadius: "50%", background: "#8B5CF6", animation: `agentPulse 1s ${d}s ease-in-out infinite` }} />
              ))}
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.30)", letterSpacing: "0.04em", marginLeft: 4 }}>
                {PIPELINE_STEPS[pipelineStep]}
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.015)",
        padding: "9px 14px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 13, color: "rgba(124,58,237,0.60)", fontWeight: 700, flexShrink: 0, lineHeight: 1 }}>›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && submit()}
          placeholder="Ask HLNΛ anything…"
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "rgba(255,255,255,0.88)", fontSize: 12, lineHeight: 1.5,
            caretColor: CYAN, padding: "2px 0", fontFamily: FONT,
          }}
        />
        <button
          onClick={submit}
          disabled={!input.trim() || responding}
          style={{
            padding: "5px 14px", borderRadius: 7, flexShrink: 0,
            background: (!input.trim() || responding) ? "rgba(99,102,241,0.06)" : "rgba(124,58,237,0.25)",
            border: `1px solid ${(!input.trim() || responding) ? "rgba(99,102,241,0.10)" : "rgba(124,58,237,0.40)"}`,
            color: (!input.trim() || responding) ? "rgba(163,163,240,0.28)" : "#C4B5FD",
            fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
            cursor: (!input.trim() || responding) ? "default" : "pointer",
            transition: "all 0.2s", fontFamily: FONT,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
