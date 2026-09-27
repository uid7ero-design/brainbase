'use client';

import styles from './HelenaVoice.module.css';

// Primary microphone control for the dedicated /hlna workspace (Phase
// C.2B.1). This is a presentation-only wrapper — the actual voice logic
// (SpeechRecognition, conversational-mode timers, transcript capture) all
// lives in hooks/useHelena.js, completely unchanged. This component calls
// the exact same helena.startConversation()/stopConversation() methods
// components/voice/MicButton.jsx's handleMic() already calls — no second
// voice engine, no duplicate SpeechRecognition, no getUserMedia.
//
// micError display is left to the caller's main status text (see
// HelenaWorkspace's statusText) rather than duplicated here.
//
// Visual (authenticated visual-completion pass): token surfaces in both
// themes; the listening state is a thin pulsing ring (HelenaVoice.module
// .css), not a glow, and is static under prefers-reduced-motion.
export function HelenaMic({ helena, size = 64 }) {
  const { listening, conversational } = helena;
  const active = listening || conversational;

  function handleClick() {
    if (conversational) { helena.stopConversation(); return; }
    helena.startConversation();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={active ? 'Stop listening' : 'Start listening'}
      aria-pressed={active}
      title={active ? 'Stop listening' : 'Start listening'}
      className={styles.mic}
      data-active={active ? 'true' : 'false'}
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.36} height={size * 0.36} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    </button>
  );
}
