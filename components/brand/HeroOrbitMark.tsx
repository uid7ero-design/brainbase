// Phase D.3.1 — dedicated, static/presentational Hybrid Orbit hero visual.
//
// Deliberately NOT HelenaOrbital: this replaces the old raster lens-style
// hero image (public/hlna-orb-only.webp, a camera-aperture-looking asset
// that predates and now conflicts with Hybrid Orbit) on the marketing
// homepage, where a large "Helena" presence would risk implying the
// assistant is actively listening/present — this component carries no
// state, no speechRef, no audioLevel, and can never enter listening/
// thinking/speaking. It exists purely as decoration.
//
// Not a fourth visual system either: the geometry below is copied directly
// from the approved master mark (public/Brand/brainbase-mark-color.svg,
// itself copied read-only from BrainBase_Hybrid_Orbit_Brand_Kit_COMPLETE/
// logos/brainbase-mark-color.svg) — three concentric rings at the exact
// same radii ratios HelenaOrbital documents deriving from that same master
// mark (outer r=164/512, middle r=124/512, inner r=84/512, core r=34/512),
// one node per ring in the same purple/violet/cyan palette, restructured
// into per-ring <g> groups (the master mark's own markup is one flat
// group) so each ring+node pair can carry independent slow rotation —
// reusing HelenaOrbital's own idle-state timings (78s/60s/40s, see that
// file's RING_SPEED_S.idle) rather than inventing new values, so motion
// language stays consistent across both components.
//
// Motion is entirely decorative and non-essential: prefers-reduced-motion
// disables it and the static frame (three rings + three nodes + core) is
// already a complete, readable composition without it.

const PURPLE = '#A855F7';
const VIOLET = '#7C5CFF';
const CYAN = '#00D4FF';

export interface HeroOrbitMarkProps {
  size?: number;
  className?: string;
}

export function HeroOrbitMark({ size = 420, className }: HeroOrbitMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      className={className}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <style>{`
        @keyframes bbHeroRingSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes bbHeroRingSpinReverse {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
        @keyframes bbHeroCorePulse {
          0%, 100% { opacity: .88; }
          50%      { opacity: 1; }
        }
        .bb-hero-ring-outer { animation: bbHeroRingSpin 78s linear infinite; }
        .bb-hero-ring-mid   { animation: bbHeroRingSpinReverse 60s linear infinite; }
        .bb-hero-ring-inner { animation: bbHeroRingSpin 40s linear infinite; }
        .bb-hero-core       { animation: bbHeroCorePulse 10s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .bb-hero-ring-outer, .bb-hero-ring-mid, .bb-hero-ring-inner, .bb-hero-core {
            animation: none !important;
          }
        }
      `}</style>

      <defs>
        <linearGradient id="bbHeroOrbitGrad" x1="8%" y1="8%" x2="92%" y2="92%">
          <stop offset="0" stopColor={PURPLE} />
          <stop offset="0.48" stopColor={VIOLET} />
          <stop offset="1" stopColor={CYAN} />
        </linearGradient>
        <radialGradient id="bbHeroCoreGrad" cx="34%" cy="27%" r="78%">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.18" stopColor="#F2EDFF" />
          <stop offset="0.42" stopColor="#B56CFF" />
          <stop offset="0.72" stopColor="#6576FF" />
          <stop offset="1" stopColor={CYAN} />
        </radialGradient>
        <filter id="bbHeroCoreGlow" x="-220%" y="-220%" width="540%" height="540%">
          <feGaussianBlur stdDeviation="8" result="b1" />
          <feGaussianBlur stdDeviation="2.2" result="b2" />
          <feMerge>
            <feMergeNode in="b1" />
            <feMergeNode in="b2" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="bbHeroNodeGlow" x="-180%" y="-180%" width="460%" height="460%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer ring — full circle, plain stroke, purple node. */}
      <g className="bb-hero-ring-outer" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        <circle cx="256" cy="256" r="164" fill="none" stroke="url(#bbHeroOrbitGrad)" strokeWidth="3" />
        <circle cx="134.12" cy="146.26" r="10.5" fill={PURPLE} filter="url(#bbHeroNodeGlow)" />
      </g>

      {/* Middle ring — dashed arc, violet node. */}
      <g className="bb-hero-ring-mid" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        <circle
          cx="256" cy="256" r="124" fill="none" stroke="url(#bbHeroOrbitGrad)" strokeWidth="3"
          strokeLinecap="round" strokeDasharray="615.50 163.61" transform="rotate(-74 256 256)"
        />
        <circle cx="132.30" cy="247.35" r="8.5" fill={VIOLET} filter="url(#bbHeroNodeGlow)" />
      </g>

      {/* Inner ring — dashed arc, cyan node. */}
      <g className="bb-hero-ring-inner" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        <circle
          cx="256" cy="256" r="84" fill="none" stroke="url(#bbHeroOrbitGrad)" strokeWidth="3"
          strokeLinecap="round" strokeDasharray="432.79 95.00" transform="rotate(18 256 256)"
        />
        <circle cx="318.42" cy="312.21" r="9.5" fill={CYAN} filter="url(#bbHeroNodeGlow)" />
      </g>

      {/* Luminous core — restrained breathing pulse, never a face/eye. */}
      <circle className="bb-hero-core" cx="256" cy="256" r="34" fill="url(#bbHeroCoreGrad)" filter="url(#bbHeroCoreGlow)" />
    </svg>
  );
}
