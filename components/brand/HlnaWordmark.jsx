'use client';

/**
 * HLNΛ wordmark — placeholder until /assets/brand/hlna-wordmark.svg is ready.
 *
 * SWAP TO FINAL ASSET:
 *   // Replace component body with:
 *   return <img src="/assets/brand/hlna-wordmark.svg" alt="HLNΛ" height={height} style={style} />;
 */
export function HlnaWordmark({ size = 'md', showSubtext = false, style }) {
  const fontSizes = { xs: 10, sm: 12, md: 14, lg: 18, xl: 24 };
  const fs = fontSizes[size] ?? fontSizes.md;
  const subFs = Math.max(7, Math.round(fs * 0.52));

  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        userSelect: 'none',
        ...style,
      }}
    >
      <span
        aria-label="HLNA"
        style={{
          fontSize: fs,
          fontWeight: 700,
          letterSpacing: '.18em',
          lineHeight: 1,
          color: '#F5F7FA',
          fontFamily: 'var(--font-inter), "Inter", "Space Grotesk", -apple-system, sans-serif',
          display: 'inline-flex',
          alignItems: 'baseline',
        }}
      >
        HLN
        <span style={{ color: '#A78BFA' }}>Λ</span>
      </span>

      {showSubtext && (
        <span
          style={{
            fontSize: subFs,
            fontWeight: 400,
            letterSpacing: '.14em',
            color: 'rgba(167,139,250,.45)',
            textTransform: 'uppercase',
            lineHeight: 1,
            fontFamily: 'var(--font-inter), "Inter", -apple-system, sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          Hyper Learning Neural Agent
        </span>
      )}
    </span>
  );
}
