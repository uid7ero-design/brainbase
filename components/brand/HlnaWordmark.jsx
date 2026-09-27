'use client';

/**
 * HLNΛ wordmark — placeholder until /assets/brand/hlna-wordmark.svg is ready.
 *
 * SWAP TO FINAL ASSET:
 *   // Replace component body with:
 *   return <img src="/assets/brand/hlna-wordmark.svg" alt="HLNΛ" height={height} style={style} />;
 *
 * Visual (authenticated visual-completion pass): theme tokens only — the
 * letters use --text-primary and, inside authenticated Brainbase/Helena UI,
 * the Λ uses the Brainbase product accent (purple) so the wordmark does not
 * introduce a second identity accent. HLNA Labs' own orange treatment
 * (--brand-hlna-accent) is unchanged for its parent-brand/public contexts.
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
          color: 'var(--text-primary)',
          fontFamily: 'var(--bb-font-sans)',
          display: 'inline-flex',
          alignItems: 'baseline',
        }}
      >
        HLN
        <span style={{ color: 'var(--brand-brainbase-accent)' }}>Λ</span>
      </span>

      {showSubtext && (
        <span
          style={{
            fontSize: subFs,
            fontWeight: 400,
            letterSpacing: '.14em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            lineHeight: 1,
            fontFamily: 'var(--bb-font-sans)',
            whiteSpace: 'nowrap',
          }}
        >
          Hyper Learning Neural Agent
        </span>
      )}
    </span>
  );
}
