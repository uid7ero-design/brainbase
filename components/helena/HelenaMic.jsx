'use client';

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
export function HelenaMic({ helena, size = 64 }) {
  const { listening, conversational } = helena;
  const active = listening || conversational;

  function handleClick() {
    if (conversational) { helena.stopConversation(); return; }
    helena.startConversation();
  }

  return (
    <button
      onClick={handleClick}
      aria-label={active ? 'Stop listening' : 'Start listening'}
      aria-pressed={active}
      title={active ? 'Stop listening' : 'Start listening'}
      style={{
        width: size, height: size, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'rgba(56,189,248,.16)' : 'rgba(124,58,237,.14)',
        border: `1px solid ${active ? 'rgba(56,189,248,.45)' : 'rgba(124,58,237,.32)'}`,
        boxShadow: active ? '0 0 24px rgba(56,189,248,.22)' : '0 0 14px rgba(124,58,237,.10)',
        cursor: 'pointer', flexShrink: 0, transition: 'all .25s',
        animation: active ? 'agentPulse 1.4s ease-in-out infinite' : undefined,
      }}
    >
      <svg width={size * 0.36} height={size * 0.36} viewBox="0 0 24 24" fill="none" stroke={active ? '#38BDF8' : '#C4B5FD'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    </button>
  );
}
