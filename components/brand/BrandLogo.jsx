'use client';

/**
 * BRΛINBASE wordmark — placeholder until /assets/brand/brainbase-wordmark.svg is ready.
 *
 * SWAP TO FINAL ASSET:
 *   import { BrandLogo } from './BrandLogo';
 *   // Replace component body with:
 *   return <img src="/assets/brand/brainbase-wordmark.svg" alt="BRΛINBASE" height={height} style={style} />;
 *
 * Props are forward-compatible — height + style will still apply to the img tag.
 */
export function BrandLogo({ size = 'md', style }) {
  const fontSizes = { xs: 11, sm: 13, md: 15, lg: 20, xl: 26 };
  const fs = fontSizes[size] ?? fontSizes.md;

  return (
    <span
      aria-label="BRAINBASE"
      style={{
        fontSize: fs,
        fontWeight: 600,
        letterSpacing: '.05em',
        lineHeight: 1,
        color: '#F5F7FA',
        userSelect: 'none',
        display: 'inline-flex',
        alignItems: 'baseline',
        fontFamily: 'var(--font-inter), "Inter", "Space Grotesk", -apple-system, sans-serif',
        ...style,
      }}
    >
      BR
      {/* Λ receives a subtle violet accent — the single identity signal */}
      <span style={{ color: '#A78BFA', fontWeight: 700 }}>Λ</span>
      INBASE
    </span>
  );
}
