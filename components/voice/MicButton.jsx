'use client';
import { useRef } from 'react';
import { HlnaOrb } from "../brand/HlnaOrb";
import styles from "../helena/HelenaVoice.module.css";

// Floating HLNA voice dock. Visual (authenticated visual-completion pass):
// a flat --bg-overlay panel with --shadow-popover — no backdrop blur, no
// gradient accent line, no glow shadows. The state communication is kept:
// the HlnaOrb state visual, the status dot + label (danger / info / muted
// tokens), and the LLM source badge.
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
    ? "var(--status-danger)"
    : (responding || listening || conversational)
    ? "var(--status-info)"
    : "var(--text-muted)";

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
    <div className={styles.dock}>
      <div className={styles.dockPanel} data-active={active ? 'true' : 'false'}>

        {/* HLNA Orb — clickable trigger */}
        <button
          type="button"
          onClick={handleMic}
          title={active ? "Stop listening" : "Start listening"}
          aria-label={active ? "Stop listening" : "Start listening"}
          aria-pressed={active}
          className={styles.orbButton}
        >
          <HlnaOrb size={44} state={orbState} speechRef={speechRef} />
        </button>

        {/* Status */}
        <div className={styles.status}>
          <div className={styles.statusRow} style={{ color: statusColor }}>
            <span
              className={styles.statusDot}
              data-pulse={(active || responding) ? 'true' : 'false'}
              aria-hidden="true"
            />
            <span className={styles.statusLabel} role="status">
              HLNΛ &nbsp;·&nbsp; {statusLabel}
            </span>
          </div>
          <div className={styles.hint}>
            HOLD SPACE · TAP TO TOGGLE · ⌘K CHAT
          </div>
        </div>

        {/* LLM source badge */}
        {llmSource && llmSource !== 'error' && (
          <div className={styles.sourceBadge} data-source={llmSource === 'ollama' ? 'ollama' : 'cloud'}>
            {llmSource === 'ollama' ? '⬡ LOCAL' : '◈ CLOUD'}
          </div>
        )}

        {/* Divider */}
        <div className={styles.divider} aria-hidden="true" />

        {/* Chat toggle */}
        <button
          type="button"
          onClick={onChatToggle}
          aria-expanded={!!chatOpen}
          className={styles.chatToggle}
        >
          {chatOpen ? "✕ Close" : "⌘K Chat"}
        </button>
      </div>
    </div>
  );
}
