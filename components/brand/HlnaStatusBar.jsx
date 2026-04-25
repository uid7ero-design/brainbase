'use client';

const KEYFRAMES = `
  @keyframes hlnaStatusPulse {
    0%, 100% { transform: scale(1); opacity: .7; }
    50%       { transform: scale(2.4); opacity: 0; }
  }
`;

export function HlnaStatusBar() {
  return (
    <>
      <style>{KEYFRAMES}</style>
      <div style={{
        position: 'fixed',
        bottom: 88,
        right: 24,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px 5px 9px',
        borderRadius: 999,
        background: '#1E1040',
        border: '1px solid rgba(124,58,237,.35)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#7C3AED' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#7C3AED', animation: 'hlnaStatusPulse 2s ease-in-out infinite' }} />
        </div>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '.10em',
          color: 'rgba(230,237,243,.75)',
          fontFamily: 'var(--font-inter), "Inter", -apple-system, sans-serif',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
          HLNA Active
        </span>
      </div>
    </>
  );
}
