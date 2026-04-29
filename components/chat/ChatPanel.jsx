'use client';
import { useState, useRef, useEffect } from "react";
import { CYAN } from "../../lib/utils/constants";

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const CONFIDENCE_COLOR = { High: '#34D399', Medium: '#FBBF24', Low: '#F87171' };

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
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, transcript]);
  useEffect(() => { inputRef.current?.focus(); }, []);

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
                analysing…
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
