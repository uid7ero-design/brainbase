'use client';
import { useRef } from 'react';
import { CYAN } from "../../lib/utils/constants";
import { HlnaOrb } from "../brand/HlnaOrb";

export function MicButton({ helena, chatOpen, onChatToggle, llmSource, orbAlert = false }) {
  const { listening, responding, conversational, micError, wakeActive, orbPhase } = helena;
  const active = listening || conversational;
  const speechRef = useRef(null);

  const statusLabel = micError
    ? micError
    : responding     ? "RESPONDING"
    : listening      ? "LISTENING"
    : conversational ? "CONVERSATION ACTIVE"
    : wakeActive     ? `STANDBY  ·  "HEY HLNA"`
    : "VOICE READY";

  const statusColor = micError
    ? "#EF4444"
    : (responding || listening || conversational)
    ? CYAN
    : "rgba(255,255,255,0.32)";

  function handleMic() {
    if (conversational) { helena.stopConversation(); return; }
    helena.startConversation();
  }

  const orbState = orbPhase ?? (
    responding ? 'responding'
    : listening ? 'listening'
    : orbAlert  ? 'alert'
    : 'idle'
  );

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      display: "flex", justifyContent: "center",
      paddingBottom: 18, zIndex: 50, pointerEvents: "none",
    }}>
      <div style={{
        width: "min(520px, 88vw)",
        background: "rgba(6, 6, 14, 0.72)",
        border: `1px solid ${active ? "rgba(124,58,237,0.22)" : "rgba(255,255,255,0.06)"}`,
        borderRadius: 14,
        backdropFilter: "blur(32px)",
        WebkitBackdropFilter: "blur(32px)",
        boxShadow: active
          ? "0 0 0 1px rgba(124,58,237,0.08), 0 12px 40px rgba(0,0,0,0.55), 0 0 60px rgba(124,58,237,0.06)"
          : "0 8px 32px rgba(0,0,0,0.45)",
        pointerEvents: "auto",
        transition: "border 0.4s, box-shadow 0.4s",
        overflow: "hidden",
      }}>

        {/* Accent line — animates colour with state */}
        <div style={{
          height: 1,
          background: active
            ? `linear-gradient(90deg, transparent, ${CYAN}, rgba(139,92,246,0.8), transparent)`
            : "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)",
          transition: "background 0.6s",
        }} />

        <div style={{ padding: "8px 12px 10px", display: "flex", alignItems: "center", gap: 10 }}>

          {/* HLNA Orb — clickable trigger */}
          <button
            onClick={handleMic}
            title={active ? "Stop listening" : "Start listening"}
            style={{
              flexShrink: 0,
              width: 48, height: 48,
              background: "none", border: "none", padding: 0,
              cursor: "pointer", position: "relative",
              borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <HlnaOrb size={44} state={orbState} speechRef={speechRef} />
          </button>

          {/* Status */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
              <div style={{
                width: 5, height: 5, borderRadius: "50%",
                background: statusColor,
                boxShadow: `0 0 6px ${statusColor}`,
                animation: (active || responding) ? "agentPulse 1.2s ease-in-out infinite" : "none",
                flexShrink: 0,
                transition: "background 0.3s, box-shadow 0.3s",
              }} />
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.10em",
                color: statusColor, textTransform: "uppercase",
                transition: "color 0.3s",
              }}>
                HLNΛ &nbsp;·&nbsp; {statusLabel}
              </span>
            </div>
            <div style={{
              fontSize: 9, color: "rgba(255,255,255,0.20)",
              letterSpacing: "0.07em", textTransform: "uppercase",
            }}>
              HOLD SPACE · TAP TO TOGGLE · ⌘K CHAT
            </div>
          </div>

          {/* LLM source badge */}
          {llmSource && llmSource !== 'error' && (
            <div style={{
              padding: "3px 8px", borderRadius: 4,
              background: llmSource === 'ollama'
                ? "rgba(134,239,172,0.06)"
                : "rgba(99,102,241,0.10)",
              border: `1px solid ${llmSource === 'ollama'
                ? "rgba(134,239,172,0.18)"
                : "rgba(99,102,241,0.28)"}`,
              color: llmSource === 'ollama'
                ? "rgba(134,239,172,0.80)"
                : "rgba(163,163,240,0.90)",
              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
              flexShrink: 0,
            }}>
              {llmSource === 'ollama' ? '⬡ LOCAL' : '◈ CLOUD'}
            </div>
          )}

          {/* Divider */}
          <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />

          {/* Chat toggle */}
          <button
            onClick={onChatToggle}
            style={{
              padding: "5px 12px", borderRadius: 6, flexShrink: 0,
              background: chatOpen ? "rgba(124,58,237,0.14)" : "rgba(255,255,255,0.04)",
              border: chatOpen
                ? "1px solid rgba(124,58,237,0.35)"
                : "1px solid rgba(255,255,255,0.09)",
              color: chatOpen ? CYAN : "rgba(255,255,255,0.38)",
              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer", transition: "all 0.25s",
            }}
          >
            {chatOpen ? "✕ Close" : "⌘K Chat"}
          </button>
        </div>
      </div>
    </div>
  );
}
