'use client';
import { useState, useRef, useEffect, useId } from "react";
import { generateReportHTML } from "../../lib/evidence-report";
import { buttonProps } from "../ui/app/Button";
import styles from "../helena/HelenaChat.module.css";

// Visual (authenticated visual-completion pass): every surface, border and
// text colour here is an app token (app/globals.css), so the conversation
// reads in light and dark. No backdrop blur, glow shadows, gradient accent
// lines or legacy violet literals; the floating panel keeps a single
// --shadow-popover. Semantic encodings (confidence, agent kind, trend /
// anomaly, the Organiser confirmation card's warning framing) map onto the
// --status-* tokens rather than raw hues.

const CONFIDENCE_COLOR = { High: 'var(--status-success)', Medium: 'var(--status-warning)', Low: 'var(--status-danger)' };

function confidenceColor(pct) {
  return pct >= 80 ? 'var(--status-success)' : pct >= 50 ? 'var(--status-warning)' : 'var(--status-danger)';
}

const AGENT_COLOR = {
  InsightAgent:    'var(--status-info)',
  ActionAgent:     'var(--brand-brainbase-accent)',
  BriefingAgent:   'var(--status-success)',
  DataIntakeAgent: 'var(--status-warning)',
  HLNAChatAgent:   'var(--brand-brainbase-accent)',
};
const AGENT_ICON = {
  InsightAgent:    '◎',
  ActionAgent:     '⚡',
  BriefingAgent:   '◈',
  DataIntakeAgent: '↑',
  HLNAChatAgent:   '◈',
};

function tint(color, pct) {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

function AgentBadge({ agentName, confidence, findings, warnings, hasEvidence, evidenceOpen, onViewEvidence }) {
  const color = AGENT_COLOR[agentName] ?? 'var(--brand-brainbase-accent)';
  const icon  = AGENT_ICON[agentName]  ?? '◈';
  const pct   = confidence != null ? Math.round(confidence * 100) : null;
  const confColor = confidenceColor(pct);
  const hasMeta = (findings?.length > 0) || (warnings?.length > 0);

  return (
    <div className={styles.metaCard} style={{
      overflow: "hidden",
      borderColor: tint(color, 35),
    }}>
      {/* header */}
      <div className={styles.metaHeader} style={{
        borderBottom: hasMeta ? "1px solid var(--border)" : undefined,
        background: tint(color, 8),
      }}>
        <span className={styles.metaTag} style={{ color }}>
          {icon} {agentName?.replace(/([A-Z])/g, ' $1').trim().toUpperCase() ?? 'AGENT'}
        </span>
        <span style={{ flex: 1 }} />
        {pct != null && (
          <span className={styles.metaTag} style={{ color: confColor }}>
            {pct}% CONFIDENCE
          </span>
        )}
        {warnings?.length > 0 && (
          <span className={styles.metaTag} style={{ color: 'var(--status-warning)', marginLeft: 6 }}>⚠ {warnings.length}</span>
        )}
        {hasEvidence && (
          <button
            type="button"
            onClick={onViewEvidence}
            aria-expanded={!!evidenceOpen}
            className={styles.evidenceToggle}
          >
            {evidenceOpen ? "▲ EVIDENCE" : "▼ EVIDENCE"}
          </button>
        )}
      </div>

      {/* findings */}
      {findings?.length > 0 && (
        <div style={{ padding: "6px 10px" }}>
          {findings.slice(0, 2).map((f, i) => (
            <div key={i} style={{ lineHeight: 1.4, marginBottom: i < findings.length - 1 ? 3 : 0 }}>
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
  const cColor = confidenceColor(pct);

  const sampleHeaders = evidence?.sampleRows?.length > 0
    ? Object.keys(evidence.sampleRows[0]).slice(0, 5)
    : [];

  const row = (label, content, mono = false) => (
    <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--border-light)" }}>
      <div className={styles.metaLabel}>
        {label}
      </div>
      <div className={mono ? `${styles.metaValue} ${styles.mono}` : styles.metaValue}>
        {content}
      </div>
    </div>
  );

  const DONE_STYLE = {
    borderColor: "var(--status-success-border)",
    background: "var(--status-success-muted)",
    color: "var(--status-success)",
  };

  return (
    <div className={`${styles.metaCard} ${styles.enter}`} style={{ overflow: "hidden" }}>

      {/* Datasets + columns */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-light)", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className={styles.metaLabel}>Datasets</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(evidence?.sourceDataset ?? []).map(d => (
              <span key={d} className={styles.chip} data-kind="dataset">{d}</span>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={styles.metaLabel}>Columns queried</div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {(evidence?.sourceColumns ?? []).slice(0, 10).map(c => (
              <span key={c} className={`${styles.chip} ${styles.mono}`}>{c}</span>
            ))}
          </div>
        </div>
      </div>

      {row("Evidence", evidence?.evidenceSummary ?? "—")}
      {row("Calculation", evidence?.calculationUsed ?? "—", true)}

      {/* Confidence reason with % badge */}
      <div style={{ padding: "7px 10px", borderBottom: sampleHeaders.length > 0 ? "1px solid var(--border-light)" : undefined, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div className={styles.metaLabel}>Confidence reason</div>
          <div className={styles.metaValue}>{evidence?.confidenceReason ?? "—"}</div>
        </div>
        {pct != null && (
          <div style={{ fontSize: 18, fontWeight: 800, color: cColor, flexShrink: 0, lineHeight: 1, paddingTop: 2 }}>{pct}%</div>
        )}
      </div>

      {/* Sample rows */}
      {sampleHeaders.length > 0 && evidence?.sampleRows?.length > 0 && (
        <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--border-light)" }}>
          <div className={styles.metaLabel}>
            Sample data ({Math.min(evidence.sampleRows.length, 3)} of {evidence.sampleRows.length} rows)
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className={styles.sampleTable}>
              <thead>
                <tr>
                  {sampleHeaders.map(h => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evidence.sampleRows.slice(0, 3).map((r, ri) => (
                  <tr key={ri}>
                    {sampleHeaders.map(h => (
                      <td key={h}>
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
        ].map(b => (
          <button
            key={b.key}
            type="button"
            onClick={b.onClick}
            {...buttonProps('secondary', 'sm')}
            style={b.active ? DONE_STYLE : undefined}
          >
            {b.label}
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
    <div className={styles.metaCard} style={{
      overflow: "hidden",
      borderColor: "var(--status-info-border)",
    }}>
      {/* header row */}
      <div className={styles.metaHeader} style={{
        borderBottom: "1px solid var(--status-info-border)",
        background: "var(--status-info-muted)",
      }}>
        <span className={styles.metaTag} style={{ color: "var(--status-info)" }}>◈ ANALYSIS</span>
        <span style={{ flex: 1 }} />
        <span className={styles.metaTag} style={{ color: CONFIDENCE_COLOR[confidence] }}>
          {confidence.toUpperCase()} CONFIDENCE
        </span>
        <span className={styles.mono} style={{ color: "var(--text-muted)", fontSize: 10 }}>{ts}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        {/* data source */}
        <div style={{ padding: "6px 10px", borderRight: "1px solid var(--border-light)" }}>
          <div className={styles.metaLabel}>SOURCE</div>
          <div className={styles.metaValue}>
            {dataSources.length ? dataSources.join(', ') : '—'}
          </div>
        </div>
        {/* rows */}
        <div style={{ padding: "6px 10px" }}>
          <div className={styles.metaLabel}>ROWS ANALYSED</div>
          <div className={styles.metaValue}>{rowsQueried.toLocaleString()}</div>
        </div>
      </div>

      {(trend || anomaly) && (
        <div style={{ borderTop: "1px solid var(--border-light)" }}>
          {trend && (
            <div style={{ padding: "6px 10px", display: "flex", gap: 6, alignItems: "flex-start", borderBottom: anomaly ? "1px solid var(--border-light)" : undefined }}>
              <span className={styles.metaTag} style={{ color: "var(--status-success)", flexShrink: 0, paddingTop: 1 }}>TREND</span>
              <span className={styles.metaValue}>{trend}</span>
            </div>
          )}
          {anomaly && (
            <div style={{ padding: "6px 10px", display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span className={styles.metaTag} style={{ color: "var(--status-warning)", flexShrink: 0, paddingTop: 1 }}>ANOMALY</span>
              <span className={styles.metaValue}>{anomaly}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Phase D.4.6J — Organiser action confirmation card ─────────────────────
// A Helena write action must never execute merely because Helena proposes
// it (see D.4.6J's own mandatory product principle). This card is the ONLY
// UI element that can trigger execution — via onConfirm, wired by the
// caller straight to useHelena's confirmOrganiserAction(), which is itself
// the only place organiserActionConfirmation is ever sent. Nothing here
// reads or displays the raw confirmationToken; it is opaque display data
// passed straight back out through onConfirm's closure in useHelena.
const ORGANISER_ACTION_TTL_MS = 2 * 60 * 1000; // mirrors the server's own 2m token TTL — cosmetic only, never authoritative

function formatCountdown(msLeft) {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function OrganiserActionCard({ action, submitting, onConfirm, onCancel }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const receivedAt = action.receivedAt ?? now;
  const msLeft = receivedAt + ORGANISER_ACTION_TTL_MS - now;
  // Cosmetic only — a local clock estimate of the server's own token
  // expiry. Never used to skip the server round-trip: an expired-looking
  // token is still submitted to Confirm normally, and the server's own
  // rejection (invalid_confirmation) is what actually governs safety. This
  // only softens the UI so a very stale card doesn't invite a confirm click
  // that's near-certain to fail.
  const likelyExpired = msLeft <= 0;

  return (
    <div
      role="region"
      aria-label="Helena Organiser action awaiting your confirmation"
      className={styles.enter}
      style={{
        maxWidth: "84%", borderRadius: "var(--radius-lg)", overflow: "hidden",
        border: "1px solid var(--status-warning-border)",
        background: "var(--status-warning-muted)",
        marginTop: 2,
        // Phase D.4.6O-R1 — this card's own `overflow: hidden` (needed for
        // its rounded corners) makes the flexbox spec's "automatic minimum
        // size" resolve to 0 instead of the card's actual content height
        // (CSS Flexbox §4.5: a flex item's automatic min-size is 0 whenever
        // its own overflow is anything but visible). Combined with the
        // browser flex-shrink default of 1, that meant a long conversation
        // — once the message list's cumulative content exceeded the
        // scrollable region's flex-computed budget — could silently SHRINK
        // this card down to a sliver instead of the container simply
        // scrolling, while its children (Confirm/Cancel included) kept
        // their real layout size and rendered outside the collapsed,
        // clipped box: unreachable by wheel/scrollbar and invisible to
        // scrollHeight. flexShrink: 0 removes this card from the shrink
        // pool entirely, so the flex column can only ever grow past its
        // container and scroll — never crush this card away.
        flexShrink: 0,
      }}
    >
      <div className={styles.actionHeader}>
        <span className={styles.actionTitle}>
          ⚠ ACTION AWAITING YOUR CONFIRMATION
        </span>
        <span style={{ flex: 1 }} />
        <span className={styles.actionExpiry}>
          {likelyExpired ? 'may have expired' : `expires in ${formatCountdown(msLeft)}`}
        </span>
      </div>

      {/* Phase D.4.6O — the card now renders one of three known proposal
          shapes, chosen purely by action.tool (a value this component only
          ever receives verbatim from useHelena.js's own
          pendingOrganiserAction state, itself only ever set from the
          server's own tool_result — never model prose). No generic
          "field/value" rendering: adding a future action type means
          adding another explicit branch here, not a generic
          renderer. */}
      {action.tool === 'propose_organiser_status_change' ? (
        <div className={styles.actionBody}>
          <div>
            <div className={styles.fieldLabel}>
              Action
            </div>
            <div className={styles.fieldValue}>Change status</div>
          </div>

          <div>
            <div className={styles.fieldLabel}>
              Target
            </div>
            <div className={styles.fieldValue} data-emphasis="target">
              {action.proposal?.item_name || 'Untitled item'}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div className={styles.fieldLabel}>
                Current status
              </div>
              <div className={styles.fieldValue}>
                {action.proposal?.current_status || '—'}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className={styles.fieldLabel}>
                New status
              </div>
              <div className={styles.fieldValue} data-emphasis="new">
                {action.proposal?.desired_status || '—'}
              </div>
            </div>
          </div>

          <div className={styles.actionButtons}>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              aria-label="Confirm: change this item's status now"
              {...buttonProps('primary', 'sm')}
            >
              {submitting ? 'Changing…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              aria-label="Cancel: do not change this item's status"
              {...buttonProps('secondary', 'sm')}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : action.tool === 'propose_organiser_group_move' ? (
        <div className={styles.actionBody}>
          <div>
            <div className={styles.fieldLabel}>
              Action
            </div>
            <div className={styles.fieldValue}>Move item</div>
          </div>

          <div>
            <div className={styles.fieldLabel}>
              Target
            </div>
            <div className={styles.fieldValue} data-emphasis="target">
              {action.proposal?.item_name || 'Untitled item'}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div className={styles.fieldLabel}>
                From
              </div>
              <div className={styles.fieldValue}>
                {action.proposal?.source_group_name || 'No group'}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className={styles.fieldLabel}>
                To
              </div>
              <div className={styles.fieldValue} data-emphasis="new">
                {action.proposal?.destination_group_name || '—'}
              </div>
            </div>
          </div>

          <div className={styles.actionButtons}>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              aria-label="Confirm: move this item now"
              {...buttonProps('primary', 'sm')}
            >
              {submitting ? 'Moving…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              aria-label="Cancel: do not move this item"
              {...buttonProps('secondary', 'sm')}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : action.tool === 'propose_organiser_assignee_change' ? (
        <div className={styles.actionBody}>
          <div>
            <div className={styles.fieldLabel}>
              Action
            </div>
            <div className={styles.fieldValue}>Change assignee</div>
          </div>

          <div>
            <div className={styles.fieldLabel}>
              Target
            </div>
            <div className={styles.fieldValue} data-emphasis="target">
              {action.proposal?.item_name || 'Untitled item'}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div className={styles.fieldLabel}>
                Currently assigned
              </div>
              <div className={styles.fieldValue}>
                {action.proposal?.previous_assignee_name || 'Unassigned'}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className={styles.fieldLabel}>
                New assignee
              </div>
              <div className={styles.fieldValue} data-emphasis="new">
                {action.proposal?.new_assignee_name || '—'}
              </div>
            </div>
          </div>

          <div className={styles.actionButtons}>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              aria-label="Confirm: assign this item now"
              {...buttonProps('primary', 'sm')}
            >
              {submitting ? 'Assigning…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              aria-label="Cancel: do not change this item's assignee"
              {...buttonProps('secondary', 'sm')}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actionBody}>
          <div>
            <div className={styles.fieldLabel}>
              Action
            </div>
            <div className={styles.fieldValue}>Post comment</div>
          </div>

          <div>
            <div className={styles.fieldLabel}>
              Target
            </div>
            <div className={styles.fieldValue} data-emphasis="target">
              {action.proposal?.item_name || 'Untitled item'}
            </div>
          </div>

          <div>
            <div className={styles.fieldLabel}>
              Comment
            </div>
            <div className={`${styles.fieldValue} ${styles.commentQuote}`}>
              &ldquo;{action.proposal?.body || ''}&rdquo;
            </div>
          </div>

          <div className={styles.actionButtons}>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              aria-label="Confirm: post this exact comment now"
              {...buttonProps('primary', 'sm')}
            >
              {submitting ? 'Posting…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              aria-label="Cancel: do not post this comment"
              {...buttonProps('secondary', 'sm')}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({
  messages, responding, transcript, onSend, onClose,
  // Phase C.2B.1 — additive, backward-compatible: default 'floating' keeps
  // every existing call site (components/BrainBase.jsx) pixel-identical.
  // 'docked' is used only by components/helena/HelenaWorkspace.jsx's
  // always-visible right-column conversation panel.
  layout = 'floating',
  emptyStateTitle = 'Ask HLNΛ about your dashboards, data, or operations.',
  emptyStateHint = 'Try: "What are our top cost drivers?" or "Explain the waste contamination trend"',
  // Phase C.2B.2 — docked mode only. Bounds the panel to a deliberate
  // conversation card instead of filling the entire right column edge to
  // edge. Ignored in 'floating' mode (BrainBase.jsx unaffected).
  maxWidth = 860,
  maxHeight = '74vh',
  // Phase D.4.6J — all optional/undefined-safe so any existing ChatPanel
  // call site that doesn't pass them (there are none left after this
  // phase's own two call sites are updated, but this keeps the component
  // itself backward-compatible) simply never renders the card.
  pendingOrganiserAction = null,
  organiserActionSubmitting = false,
  onConfirmOrganiserAction,
  onCancelOrganiserAction,
}) {
  const [input, setInput]                 = useState('');
  const [pipelineStep, setPipelineStep]   = useState(0);
  const [openEvidence, setOpenEvidence]   = useState(() => new Set());
  const [copiedStates, setCopiedStates]   = useState({});
  const [sendStates, setSendStates]       = useState({});
  const [savedStates, setSavedStates]     = useState({});
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const inputId   = useId();

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

  const docked = layout === 'docked';
  const sendDisabled = !input.trim() || responding;

  return (
    <div className={docked ? styles.panel : `${styles.panel} ${styles.enter}`} style={docked ? {
      position: "relative", width: "100%", maxWidth, height: "100%", maxHeight,
      display: "flex", flexDirection: "column",
      borderRadius: "var(--radius-lg)", overflow: "hidden",
      background: "var(--bg-surface)",
      border: "1px solid var(--border)",
    } : {
      position: "fixed", bottom: 86, right: 20,
      width: "min(520px, calc(100vw - 40px))", zIndex: 60,
      // Phase D.4.6N-R1 — bounds the whole floating panel to the space
      // actually available above its own bottom:86 anchor (plus a small
      // top clearance) so the flex:1 message region below has a real
      // height to shrink within, instead of the panel being free to grow
      // past the viewport on short screens.
      maxHeight: "calc(100vh - 106px)",
      display: "flex", flexDirection: "column",
      borderRadius: "var(--radius-lg)", overflow: "hidden",
      background: "var(--bg-overlay)",
      border: "1px solid var(--border)",
      boxShadow: "var(--shadow-popover)",
    }}>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.stateDot} data-responding={responding ? 'true' : 'false'} aria-hidden="true" />
          <span className={styles.title}>
            HLNΛ
          </span>
          <span className={styles.subtitle}>
            · Hyper Learning Neural Agent
          </span>
        </div>
        <a href="/briefings" className={styles.headerLink}>
          SAVED BRIEFINGS
        </a>
        {!docked && (
          <div className={styles.escHint}>
            ESC TO CLOSE
          </div>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            {...buttonProps('ghost', 'sm')}
            style={{ width: 28, padding: 0 }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      {/* Phase D.4.6N-R1 — floating mode now sizes this region the same
          structural way docked mode always has (flex: 1 with minHeight: 0,
          inside a height-bounded parent) instead of a hardcoded maxHeight.
          A hardcoded, non-flex maxHeight left the input bar below it as a
          same-flow sibling with no reserved space, so taller content (e.g.
          the status-change confirmation card's extra Current/New Status
          row) could visually and pointer-interactively bleed into the
          input bar's hit area on short viewports. flex + minHeight: 0
          makes this region always shrink to exactly the space left after
          the fixed header/footer, so it scrolls correctly and never
          overlaps either sibling. */}
      {/* Messages */}
      <div role="region" aria-label="HLNA conversation" tabIndex={0} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && !responding && (
          <div className={styles.empty}>
            <div className={styles.emptyGlyph} aria-hidden="true">◈</div>
            <div className={styles.emptyTitle}>
              {emptyStateTitle}
            </div>
            <div className={styles.emptyHint}>
              {emptyStateHint}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 3 }}>
            <div className={styles.byline} data-role={m.role === "user" ? "user" : "assistant"}>
              {m.role === "user" ? "YOU" : "◈ HLNΛ"}
            </div>
            <div className={styles.bubble} data-role={m.role === "user" ? "user" : "assistant"}>
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

        {/* Organiser action confirmation card — Phase D.4.6J. Rendered
            outside the messages.map loop above (it is not a chat message
            and must never be visually confused with one — no YOU/HLNΛ
            byline, distinct warning-token framing) but inside the same
            scrolling thread so it appears at the natural point in the
            conversation. */}
        {pendingOrganiserAction && (
          <OrganiserActionCard
            action={pendingOrganiserAction}
            submitting={organiserActionSubmitting}
            onConfirm={onConfirmOrganiserAction}
            onCancel={onCancelOrganiserAction}
          />
        )}

        {/* Live transcript */}
        {transcript && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
            <div className={styles.byline} data-role="user">YOU</div>
            <div className={styles.bubble} data-role="transcript">
              {transcript}
            </div>
          </div>
        )}

        {/* Thinking indicator */}
        {responding && (
          <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
            <div className={styles.byline} data-role="assistant">◈ HLNΛ</div>
            <div className={styles.thinking}>
              {[0, 0.2, 0.4].map(d => (
                <span key={d} className={styles.thinkingDot} style={{ animationDelay: `${d}s` }} aria-hidden="true" />
              ))}
              <span className={styles.pipelineStep}>
                {PIPELINE_STEPS[pipelineStep]}
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className={styles.composer}>
        <label htmlFor={inputId} className={styles.srOnly}>Message HLNA</label>
        <input
          id={inputId}
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && submit()}
          placeholder="Ask HLNΛ anything…"
          className={styles.input}
        />
        <button
          type="button"
          onClick={submit}
          disabled={sendDisabled}
          {...buttonProps('primary', 'sm')}
        >
          Send
        </button>
      </div>
    </div>
  );
}
