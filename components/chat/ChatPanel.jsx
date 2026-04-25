'use client';
import { useState, useRef, useEffect } from "react";
import { CYAN } from "../../lib/utils/constants";

const INDIGO = "#6366f1";
const INDIGO_DIM = "rgba(99,102,241,.18)";
const INDIGO_BORDER = "rgba(99,102,241,.28)";

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
      width: "min(620px, 90vw)", zIndex: 60,
      display: "flex", flexDirection: "column",
      animation: "chatSlideUp .3s cubic-bezier(0.16,1,0.3,1)",
      borderRadius: 12, overflow: "hidden",
      background: "rgba(7,9,16,0.96)",
      border: "1px solid rgba(99,102,241,.20)",
      boxShadow: "0 0 0 1px rgba(99,102,241,.06), 0 24px 60px rgba(0,0,0,.85), 0 0 80px rgba(99,102,241,.06)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
    }}>

      {/* Top accent */}
      <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(99,102,241,.5), rgba(0,207,234,.3), transparent)" }} />

      {/* Header */}
      <div style={{
        padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid rgba(255,255,255,.05)",
        background: "rgba(99,102,241,.05)",
      }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flex: 1 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: CYAN, boxShadow: `0 0 8px ${CYAN}`, animation: "agentPulse 2s ease-in-out infinite" }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,.75)", textTransform: "uppercase" }}>HLNA</span>
          <span style={{ fontSize: 9, letterSpacing: ".08em", color: "rgba(255,255,255,.22)", textTransform: "uppercase" }}>· Hyper Learning Neural Agent</span>
        </div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,.18)", letterSpacing: ".07em", textTransform: "uppercase" }}>
          ESC TO CLOSE
        </div>
        <button onClick={onClose} style={{
          width: 24, height: 24, borderRadius: 5,
          background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
          color: "rgba(255,255,255,.40)", fontSize: 11, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .2s",
        }}>✕</button>
      </div>

      {/* Messages */}
      <div style={{ maxHeight: 360, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <div style={{ fontSize: 18, color: "rgba(99,102,241,.5)", marginBottom: 8, letterSpacing: ".1em" }}>◈</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.28)", letterSpacing: ".06em" }}>HLNA is ready. Upload data or ask a question to begin.</div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 4 }}>
            {/* Role label */}
            <div style={{
              fontSize: 8, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase",
              color: m.role === "user" ? "rgba(255,255,255,.25)" : CYAN,
              paddingLeft: m.role === "user" ? 0 : 2,
              paddingRight: m.role === "user" ? 2 : 0,
            }}>
              {m.role === "user" ? "YOU" : "◈ HLNA"}
            </div>
            {/* Bubble */}
            <div style={{
              maxWidth: "82%", padding: "9px 12px", borderRadius: 8,
              background: m.role === "user"
                ? "rgba(255,255,255,.05)"
                : INDIGO_DIM,
              border: m.role === "user"
                ? "1px solid rgba(255,255,255,.07)"
                : `1px solid ${INDIGO_BORDER}`,
              fontSize: 12, color: "rgba(255,255,255,.88)", lineHeight: 1.6,
            }}>
              {m.content}
            </div>
          </div>
        ))}

        {/* Live transcript */}
        {transcript && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,.20)", paddingRight: 2 }}>YOU</div>
            <div style={{
              maxWidth: "82%", padding: "9px 12px", borderRadius: 8,
              background: "rgba(0,207,234,.05)", border: "1px dashed rgba(0,207,234,.20)",
              fontSize: 12, color: "rgba(255,255,255,.55)", lineHeight: 1.6, fontStyle: "italic",
            }}>
              {transcript}
            </div>
          </div>
        )}

        {/* Thinking indicator */}
        {responding && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".12em", color: CYAN }}>◈ HLNA</div>
            <div style={{
              padding: "10px 14px", borderRadius: 8,
              background: INDIGO_DIM, border: `1px solid ${INDIGO_BORDER}`,
              display: "flex", gap: 8, alignItems: "center",
            }}>
              {[0, .2, .4].map(d => (
                <div key={d} style={{ width: 4, height: 4, borderRadius: "50%", background: INDIGO, animation: `agentPulse 1s ${d}s ease-in-out infinite` }} />
              ))}
              <span style={{ fontSize: 9, color: "rgba(255,255,255,.28)", letterSpacing: ".05em", marginLeft: 2 }}>HLNA is analysing your data…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,.05)",
        background: "rgba(255,255,255,.02)",
        padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 11, color: "rgba(99,102,241,.55)", fontWeight: 700, flexShrink: 0 }}>›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Enter command…"
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "rgba(255,255,255,.85)", fontSize: 12,
            caretColor: CYAN, padding: "2px 0",
          }}
        />
        <button onClick={submit} disabled={!input.trim() || responding} style={{
          padding: "5px 14px", borderRadius: 6, flexShrink: 0,
          background: (!input.trim() || responding) ? "rgba(99,102,241,.06)" : "rgba(99,102,241,.22)",
          border: `1px solid ${(!input.trim() || responding) ? "rgba(99,102,241,.12)" : INDIGO_BORDER}`,
          color: (!input.trim() || responding) ? "rgba(163,163,240,.30)" : "#a5b4fc",
          fontSize: 10, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase",
          cursor: (!input.trim() || responding) ? "default" : "pointer",
          transition: "all .2s",
        }}>
          Send
        </button>
      </div>
    </div>
  );
}
