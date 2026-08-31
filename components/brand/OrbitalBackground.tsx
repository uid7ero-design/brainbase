import type { CSSProperties } from 'react';

// Phase D.3 — reusable atmospheric background treatment. This is the THIRD
// of three distinct Hybrid Orbit visual concepts, and must never be confused
// with the other two:
//   A. Static corporate brand    — BrainBaseWordmark (components/brand/BrainBaseWordmark.tsx)
//   B. Living Helena visual      — HelenaOrbital (components/brand/HelenaOrbital.tsx) — stateful, reacts to listening/thinking/speaking
//   C. Atmospheric background    — OrbitalBackground (this file) — decorative, non-interactive, never stateful
//
// Deliberately built to read as clearly DIFFERENT from HelenaOrbital rather
// than a bigger/duller copy of it: HelenaOrbital is a compact, centered,
// crisp-cored logomark that dominates its frame; this is a large,
// off-center, cropped field with a soft DIFFUSE glow (no crisp bright
// "core" sphere) sitting behind content, never in front of or competing
// with a living assistant visual.
//
// 'field' variant renders the actual approved brand-kit asset
// (public/Brand/backgrounds/brainbase-orbital-field.svg, copied read-only
// from BrainBase_Hybrid_Orbit_Brand_Kit_COMPLETE/backgrounds/ — pixel-exact
// to the approved art direction) as a static base layer, with a thin
// separate SVG overlay of independently-animated outer rings for motion —
// see docs/Orbital_Motion_Spec.md's own explicit "avoid continuously
// rotating the entire composition as a single object" rule, which is why
// motion is layered on top of the static asset rather than applied to it as
// a whole. 'veil' is pure CSS gradient wash — no asset, no rings, no
// animation surface at all — for pages that want brand atmosphere without
// any of the orbital motif's visual weight.
//
// Purely decorative: aria-hidden, pointer-events:none, never part of the
// reading/tab order, never intercepts clicks/selection. Caller is
// responsible for giving its own wrapper `position: relative` and its own
// content a higher `zIndex` — this component absolutely-positions itself
// to `inset:0` at zIndex 0 and expects to be the first child.

export type OrbitalVariant = 'field' | 'veil';
export type OrbitalIntensity = 'low' | 'medium' | 'high';
export type OrbitalPlacement = 'center' | 'top-right' | 'top-left';

export interface OrbitalBackgroundProps {
  /** 'field' = full treatment (asset + animated ring overlay + nebula wash). 'veil' = nebula wash only, no asset/rings/animation. */
  variant?: OrbitalVariant;
  /** Overall opacity multiplier for every layer. */
  intensity?: OrbitalIntensity;
  /** Where the orbital system's optical centre sits. */
  placement?: OrbitalPlacement;
  className?: string;
  style?: CSSProperties;
}

const INTENSITY_SCALE: Record<OrbitalIntensity, number> = {
  low: 0.4,
  medium: 1,
  high: 1.4,
};

const PLACEMENT_ORIGIN: Record<OrbitalPlacement, { x: string; y: string }> = {
  center: { x: '50%', y: '46%' },
  'top-right': { x: '76%', y: '30%' },
  'top-left': { x: '24%', y: '30%' },
};

export function OrbitalBackground({
  variant = 'field',
  intensity = 'medium',
  placement = 'center',
  className,
  style,
}: OrbitalBackgroundProps) {
  const scale = INTENSITY_SCALE[intensity];
  const origin = PLACEMENT_ORIGIN[placement];

  return (
    <div
      aria-hidden="true"
      className={`bb-orbital-bg${className ? ` ${className}` : ''}`}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
        ...style,
      }}
    >
      <style>{`
        @keyframes bbOrbitalRingSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes bbOrbitalRingSpinReverse {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
        @keyframes bbOrbitalBreathe {
          0%, 100% { opacity: .55; }
          50%      { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .bb-orbital-ring-outer, .bb-orbital-ring-mid, .bb-orbital-wash {
            animation: none !important;
          }
        }
      `}</style>

      {/* Nebula wash — present in both variants, the only layer 'veil' renders. */}
      <div
        className="bb-orbital-wash"
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 68% 52% at ${origin.x} ${origin.y}, rgba(124,58,237,${(0.15 * scale).toFixed(3)}) 0%, rgba(49,46,129,${(0.06 * scale).toFixed(3)}) 42%, transparent 72%)`,
          animation: 'bbOrbitalBreathe 11s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 46% 36% at calc(${origin.x} + 8%) calc(${origin.y} + 14%), rgba(0,212,255,${(0.09 * scale).toFixed(3)}) 0%, transparent 66%)`,
        }}
      />

      {variant === 'field' && (
        <>
          {/* Approved static brand-kit asset — pixel-exact art direction. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.85 * scale,
              backgroundImage: "url('/Brand/backgrounds/brainbase-orbital-field.svg')",
              backgroundRepeat: 'no-repeat',
              backgroundSize: 'cover',
              backgroundPosition: `${origin.x} ${origin.y}`,
            }}
          />

          {/* Thin animated ring overlay — motion lives here, never on the
              static asset above, so nothing rotates as a single object.
              Two rings only, differential very-slow speeds/directions per
              Orbital_Motion_Spec.md (50-90s outer cycles). */}
          <svg
            width="100%"
            height="100%"
            style={{ position: 'absolute', inset: 0 }}
            preserveAspectRatio="xMidYMid slice"
            viewBox="0 0 1920 1080"
          >
            <defs>
              <linearGradient id="bbOrbitalRingGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#A855F7" />
                <stop offset=".55" stopColor="#6B63FF" />
                <stop offset="1" stopColor="#00D4FF" />
              </linearGradient>
            </defs>
            <g
              className="bb-orbital-ring-outer"
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animation: 'bbOrbitalRingSpin 150s linear infinite',
              }}
            >
              <ellipse
                cx={`${parseFloat(origin.x) * 19.2}`}
                cy={`${parseFloat(origin.y) * 10.8}`}
                rx="760"
                ry="290"
                fill="none"
                stroke="url(#bbOrbitalRingGrad)"
                strokeWidth="1"
                opacity={0.16 * scale}
                strokeDasharray="1 14"
              />
            </g>
            <g
              className="bb-orbital-ring-mid"
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animation: 'bbOrbitalRingSpinReverse 95s linear infinite',
              }}
            >
              <ellipse
                cx={`${parseFloat(origin.x) * 19.2}`}
                cy={`${parseFloat(origin.y) * 10.8}`}
                rx="520"
                ry="195"
                fill="none"
                stroke="#8B5CF6"
                strokeWidth="1.2"
                opacity={0.14 * scale}
              />
            </g>
          </svg>
        </>
      )}
    </div>
  );
}
