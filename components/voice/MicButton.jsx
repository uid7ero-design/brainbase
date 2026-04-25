'use client';
import { CYAN } from "../../lib/utils/constants";

export function MicButton({ helena, chatOpen, onChatToggle, llmSource }) {
  const { listening, responding, conversational, micError, wakeActive } = helena;
  const active = listening || conversational;

  const statusLabel = micError         ? micError
    : responding                       ? "HLNA RESPONDING"
    : listening                        ? "HLNA LISTENING"
    : conversational                   ? "HLNA CONVERSATION ACTIVE"
    : wakeActive                       ? `STANDBY · "HEY HLNA"`
    : "VOICE COMMAND";

  const statusColor = micError
    ? "#ef6464"
    : responding || listening || conversational
    ? CYAN
    : "rgba(255,255,255,.28)";

  const dotColor = micError ? "#ef6464" : CYAN;

  function handleMic() {
    if (conversational) { helena.stopConversation(); return; }
    helena.startConversation();
  }

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      display: "flex", justifyContent: "center",
      paddingBottom: 20, zIndex: 50, pointerEvents: "none",
    }}>
      {/* Command bar */}
      <div style={{
        width: "min(560px, 86vw)",
        background: "rgba(5,7,14,0.58)",
        border: `1px solid ${active ? "rgba(124,58,237,.16)" : "rgba(255,255,255,.05)"}`,
        borderRadius: 12,
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        boxShadow: active
          ? `0 0 0 1px rgba(124,58,237,.05), 0 8px 32px rgba(0,0,0,.40)`
          : "0 8px 32px rgba(0,0,0,.35)",
        pointerEvents: "auto",
        transition: "border .35s, box-shadow .35s",
        overflow: "hidden",
      }}>

        {/* Top accent line */}
        <div style={{
          height: 1,
          background: active
            ? `linear-gradient(90deg, transparent, ${CYAN}, transparent)`
            : "linear-gradient(90deg, transparent, rgba(255,255,255,.06), transparent)",
          transition: "background .5s",
        }} />

        <div style={{ padding: "6px 10px", display: "flex", alignItems: "center", gap: 10 }}>

          {/* Mic trigger button */}
          <button onClick={handleMic} style={{
            flexShrink: 0,
            width: 40, height: 40, borderRadius: 8,
            background: active ? "rgba(124,58,237,.10)" : "rgba(255,255,255,.04)",
            border: active ? `1px solid rgba(124,58,237,.35)` : "1px solid rgba(255,255,255,.09)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: "all .25s",
            boxShadow: active ? "0 0 18px rgba(124,58,237,.18)" : "none",
            position: "relative",
          }}>
            {active && (
              <div style={{
                position: "absolute", inset: -5, borderRadius: 11,
                border: `1px solid rgba(124,58,237,.25)`,
                animation: "micRipple 1.6s cubic-bezier(0.16,1,0.3,1) infinite",
                pointerEvents: "none",
              }} />
            )}
            {responding
              ? <div style={{ display: "flex", gap: 3 }}>
                  {[0, .18, .36].map(d => (
                    <div key={d} style={{ width: 4, height: 4, borderRadius: "50%", background: CYAN, animation: `agentPulse .85s ${d}s ease-in-out infinite` }} />
                  ))}
                </div>
              : active
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill={CYAN}><rect x="5" y="5" width="14" height="14" rx="3"/></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3"/>
                  <path d="M5 10a7 7 0 0 0 14 0"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="8" y1="22" x2="16" y2="22"/>
                </svg>
            }
          </button>

          {/* Status block */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <div style={{
                width: 5, height: 5, borderRadius: "50%",
                background: dotColor,
                boxShadow: `0 0 6px ${dotColor}`,
                animation: (active || responding) ? "agentPulse 1.2s ease-in-out infinite" : "none",
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
                color: statusColor, textTransform: "uppercase",
                transition: "color .3s",
              }}>
                {statusLabel}
              </span>
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,.22)", letterSpacing: ".07em", textTransform: "uppercase" }}>
              HOLD SPACE · TAP TO TOGGLE CONVO
            </div>
          </div>

          {/* LLM badge */}
          {llmSource && llmSource !== 'error' && (
            <div style={{
              padding: "3px 8px", borderRadius: 4,
              background: llmSource === 'ollama' ? "rgba(134,239,172,.06)" : "rgba(99,102,241,.10)",
              border: `1px solid ${llmSource === 'ollama' ? "rgba(134,239,172,.18)" : "rgba(99,102,241,.25)"}`,
              color: llmSource === 'ollama' ? "rgba(134,239,172,.80)" : "rgba(163,163,240,.90)",
              fontSize: 9, fontWeight: 700, letterSpacing: ".08em",
              flexShrink: 0,
            }}>
              {llmSource === 'ollama' ? '⬡ LOCAL' : '◈ CLOUD'}
            </div>
          )}

          {/* Divider */}
          <div style={{ width: 1, height: 28, background: "rgba(255,255,255,.07)", flexShrink: 0 }} />

          {/* Chat toggle */}
          <button onClick={onChatToggle} style={{
            padding: "5px 12px", borderRadius: 6, flexShrink: 0,
            background: chatOpen ? "rgba(124,58,237,.12)" : "rgba(255,255,255,.04)",
            border: chatOpen ? `1px solid rgba(124,58,237,.32)` : "1px solid rgba(255,255,255,.09)",
            color: chatOpen ? CYAN : "rgba(255,255,255,.38)",
            fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase",
            cursor: "pointer", transition: "all .25s",
          }}>
            {chatOpen ? "✕ Chat" : "⌘K Chat"}
          </button>
        </div>
      </div>
    </div>
  );
}
