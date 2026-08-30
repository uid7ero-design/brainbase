'use client';

import { useId } from 'react';

/**
 * HelenaOrbital — living Hybrid Orbit visual for the Helena assistant.
 *
 * Pure SVG + CSS keyframes, no rendering library or GPU-accelerated 3D
 * layer of any kind. Geometry and
 * palette are derived from the approved master mark
 * (BrainBase_Hybrid_Orbit_Brand_Kit_COMPLETE/logos/brainbase-mark-color.svg):
 * three concentric rings, one sphere per ring (outer=purple, middle=violet,
 * inner=cyan), compact luminous core. Idle motion timing follows
 * docs/Orbital_Motion_Spec.md (outer/middle 50-90s, inner 30-55s, core
 * pulse 8-12s). This component is purely presentational — it knows nothing
 * about any chat API, speech recognition, text-to-speech provider, or
 * tenant/account state — only a visual state and an optional audio-level
 * number.
 *
 * Phase B.1: the core's audio-driven scale and its ambient breathing
 * keyframe are split across separate wrapper elements using the individual
 * `scale`/`translate` transform properties (not the `transform` shorthand
 * on one element) — a single element can't cleanly mix a static/transition
 * -driven transform with a keyframe-animated one on the same property, the
 * animation just wins every frame. Layering them onto composable
 * scale/translate/transform properties across nested groups lets the
 * audio-driven scale, the thinking "shudder" translate, and the state
 * breathing pulse coexist without fighting each other.
 */

export type HelenaVisualState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface HelenaOrbitalProps {
  state?: HelenaVisualState;
  /** 0..1. Drives core/halo in 'speaking' (dominant) and lightly in 'listening'. */
  audioLevel?: number;
  size?: number;
  className?: string;
}

const PURPLE = '#A855F7';
const VIOLET = '#7C5CFF';
const CYAN = '#00D4FF';
const AMBER = '#F59E0B';

// viewBox is 0 0 200 200, center (100,100) — ratios below match the approved
// master mark (outer r=164/512, middle r=124/512, inner r=84/512, core r=34/512).
const CX = 100;
const CY = 100;
const R_OUTER = 64;
const R_MIDDLE = 48;
const R_INNER = 33;
const R_CORE = 13;

type RingSpeeds = { outer: number; middle: number; inner: number };

const RING_SPEED_S: Record<HelenaVisualState, RingSpeeds> = {
  // idle: master Orbital_Motion_Spec.md (outer/middle 50-90s, inner 30-55s).
  idle: { outer: 78, middle: 60, inner: 40 },
  // listening: moderately faster — "leaning in", still controlled.
  listening: { outer: 32, middle: 24, inner: 17 },
  // thinking: visibly differentiated, faster than listening.
  thinking: { outer: 21, middle: 13.5, inner: 9 },
  // speaking: the most active orbital motion — inner fastest, outer still clearly moving.
  speaking: { outer: 19, middle: 13, inner: 8 },
  // error: motion slows substantially versus idle.
  error: { outer: 150, middle: 120, inner: 90 },
};

const CORE_PULSE_S: Record<HelenaVisualState, number> = {
  idle: 10,
  listening: 5,
  thinking: 4,
  speaking: 2.2,
  error: 14,
};

const GLOW_BY_STATE: Record<HelenaVisualState, { color: string; opacity: number }> = {
  idle: { color: 'rgba(124,92,255,.45)', opacity: 0.55 },
  listening: { color: 'rgba(0,212,255,.55)', opacity: 0.75 },
  thinking: { color: 'rgba(168,85,247,.60)', opacity: 0.85 },
  speaking: { color: 'rgba(124,92,255,.70)', opacity: 0.95 },
  error: { color: 'rgba(245,158,11,.30)', opacity: 0.35 },
};

const TRACE_OPACITY: Record<HelenaVisualState, number> = {
  idle: 0,
  listening: 0,
  // thinking traces now flicker intermittently (hloThinkTraceFlicker) rather
  // than sitting at one constant level — this is their resting baseline.
  thinking: 0.32,
  speaking: 0,
  error: 0,
};

const STATE_DESCRIPTION: Record<HelenaVisualState, string> = {
  idle: 'Calm baseline — slow independent orbits, low glow, gentle core breathing.',
  listening: 'Attentive — rings tighten inward, core brightens, an outward pulse marks focus.',
  thinking: 'Active and computational — faster differentiated orbits with brief, intermittent processing shudders.',
  speaking: 'The most alive state — fast orbital motion, a strong voice-reactive core pulse, and a soft expanding halo.',
  error: 'Subdued — motion slows substantially, glow and core intensity drop, a restrained amber accent marks degradation.',
};

const ORBITAL_CSS = `
  @keyframes hloSpinCW  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes hloSpinCCW { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
  @keyframes hloCorePulse {
    0%, 100% { transform: scale(1);     opacity: .86; }
    50%      { transform: scale(1.045); opacity: 1;   }
  }
  @keyframes hloAttentionPulse {
    0%   { transform: scale(0.92); opacity: .32; }
    70%  { transform: scale(1.18); opacity: 0;    }
    100% { transform: scale(1.18); opacity: 0;    }
  }

  /* Whole-system breathing — speaking (outward) and listening (inward). Kept
     as one continuous ambient loop, independent of audioLevel, so speaking
     never fully freezes at audioLevel 0. */
  @keyframes hloSystemBreatheOut {
    0%, 100% { transform: scale(1);     }
    50%      { transform: scale(1.015); }
  }
  @keyframes hloSystemBreatheIn {
    0%, 100% { transform: scale(1);     }
    50%      { transform: scale(0.986); }
  }

  /* Thinking "computational shudder" — two short (~100-150ms) bursts per
     3.6s cycle, long calm stretches between. translate is an individual
     transform property so it composes with the scale/transform keyframes
     on neighbouring elements without either one overriding the other.
     Values are in viewBox units, so they scale down proportionally at
     small render sizes automatically (no separate small-size handling
     needed). */
  @keyframes hloThinkShudder {
    0%, 82%   { translate: 0px 0px; }
    83.5%     { translate: 1.4px -1px; }
    85%       { translate: -0.6px 0.7px; }
    86.5%, 93% { translate: 0px 0px; }
    94.3%     { translate: -1.1px -0.9px; }
    95.6%     { translate: 0.5px 0.6px; }
    97%, 100% { translate: 0px 0px; }
  }
  @keyframes hloThinkGlowSpike {
    0%, 82%   { opacity: .8; }
    84%       { opacity: 1;  }
    87%, 93%  { opacity: .8; }
    95%       { opacity: .98; }
    98%, 100% { opacity: .8; }
  }
  @keyframes hloThinkTraceFlicker {
    0%, 82%   { opacity: .30; }
    84%       { opacity: .78; }
    87%, 93%  { opacity: .30; }
    95%       { opacity: .62; }
    98%, 100% { opacity: .30; }
  }

  .hlo-ring-group, .hlo-trace-group {
    transform-box: view-box;
    transform-origin: 100px 100px;
  }
  .hlo-spin-cw  { animation-name: hloSpinCW;  animation-timing-function: linear; animation-iteration-count: infinite; }
  .hlo-spin-ccw { animation-name: hloSpinCCW; animation-timing-function: linear; animation-iteration-count: infinite; }
  .hlo-core-pulse {
    transform-box: view-box;
    transform-origin: 100px 100px;
    animation-name: hloCorePulse;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }
  .hlo-attention {
    transform-box: view-box;
    transform-origin: 100px 100px;
    animation: hloAttentionPulse 2.4s ease-out infinite;
  }
  .hlo-system {
    transform-box: view-box;
    transform-origin: 100px 100px;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }
  .hlo-audio-scale {
    transform-box: view-box;
    transform-origin: 100px 100px;
  }
  .hlo-shudder {
    transform-box: view-box;
    transform-origin: 100px 100px;
  }
  .hlo-shudder-active {
    animation: hloThinkShudder 3.6s ease-in-out infinite;
  }
  .hlo-glow-spike-active {
    animation: hloThinkGlowSpike 3.6s ease-in-out infinite;
  }
  .hlo-trace-flicker-active {
    animation: hloThinkTraceFlicker 3.6s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .hlo-spin-cw, .hlo-spin-ccw, .hlo-core-pulse, .hlo-attention, .hlo-system,
    .hlo-shudder-active, .hlo-glow-spike-active, .hlo-trace-flicker-active {
      animation: none !important;
    }
    .hlo-shudder-active { translate: none !important; }
    .hlo-root [data-hlo-state-transition] {
      transition: opacity .5s ease, filter .5s ease;
    }
  }
`;

export function HelenaOrbital({
  state = 'idle',
  audioLevel = 0,
  size = 96,
  className,
}: HelenaOrbitalProps) {
  const speeds = RING_SPEED_S[state] ?? RING_SPEED_S.idle;
  const corePulseS = CORE_PULSE_S[state] ?? CORE_PULSE_S.idle;
  const glow = GLOW_BY_STATE[state] ?? GLOW_BY_STATE.idle;
  const traceOpacity = TRACE_OPACITY[state] ?? 0;
  const level = Math.max(0, Math.min(1, audioLevel));
  const isThinking = state === 'thinking';

  // Ring rotation speed is state-driven only (never touched by audioLevel).
  // Core/halo are audio-driven, smoothed via CSS transition (not a rAF
  // loop) so jitter in the source signal is absorbed visually rather than
  // producing per-frame jumps.
  const speakingBoost = state === 'speaking' ? level : 0;
  const listeningBoost = state === 'listening' ? level * 0.35 : 0;
  // Suggested mapping: low ~1.00, medium ~1.05-1.08, high ~1.10-1.14.
  const coreExtraScale = 1 + speakingBoost * 0.12 + listeningBoost * 0.03;
  const haloOpacity = state === 'speaking' ? 0.25 + speakingBoost * 0.55 : 0;
  const haloScale = 1 + speakingBoost * 0.28;
  const glowOpacity = Math.min(1, glow.opacity + speakingBoost * 0.05);

  const glowExt = Math.round(size * 0.4);
  const blurPx = Math.max(6, Math.round(size * 0.18));

  // useId (not Math.random) — must stay a pure, idempotent value per render.
  const uid = `hlo${useId().replace(/:/g, '')}`;

  const systemAnim =
    state === 'speaking'
      ? { animationName: 'hloSystemBreatheOut', animationDuration: '5s' }
      : state === 'listening'
        ? { animationName: 'hloSystemBreatheIn', animationDuration: '4.2s' }
        : undefined;

  return (
    <div
      className={['hlo-root', className].filter(Boolean).join(' ')}
      data-hlo-state={state}
      style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
    >
      <style>{ORBITAL_CSS}</style>

      {/* Ambient glow layer behind the mark — restrained, state-tinted. */}
      <div
        aria-hidden="true"
        data-hlo-state-transition
        className={isThinking ? 'hlo-glow-spike-active' : undefined}
        style={{
          position: 'absolute',
          inset: -glowExt,
          borderRadius: '50%',
          background: `radial-gradient(circle at 50% 50%, ${glow.color} 0%, transparent 70%)`,
          filter: `blur(${blurPx}px)`,
          opacity: isThinking ? undefined : glowOpacity,
          transition: 'opacity .6s ease, background .6s ease',
          pointerEvents: 'none',
        }}
      />

      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        role="img"
        aria-label={`Helena — ${state}`}
        style={{ position: 'relative', display: 'block' }}
      >
        <defs>
          <linearGradient id={`${uid}-orbit`} x1="8%" y1="8%" x2="92%" y2="92%">
            <stop offset="0" stopColor={PURPLE} />
            <stop offset="0.48" stopColor={VIOLET} />
            <stop offset="1" stopColor={CYAN} />
          </linearGradient>
          <radialGradient id={`${uid}-core`} cx="34%" cy="27%" r="78%">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="0.18" stopColor="#F2EDFF" />
            <stop offset="0.42" stopColor="#B56CFF" />
            <stop offset="0.72" stopColor="#6576FF" />
            <stop offset="1" stopColor={CYAN} />
          </radialGradient>
        </defs>

        {/* Whole-composition breathing (speaking/listening only). */}
        <g className="hlo-system" style={systemAnim}>
          {/* ── 3 primary orbital rings, each carrying exactly 1 primary sphere ── */}
          <g
            className="hlo-ring-group hlo-spin-cw"
            style={{ animationDuration: `${speeds.outer}s` }}
            data-hlo-ring="outer"
          >
            <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke={`url(#${uid}-orbit)`} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.85} />
            <circle data-hlo-sphere="outer" cx={CX} cy={CY - R_OUTER} r={4.2} fill={PURPLE} opacity={0.95} />
          </g>

          <g
            className={`hlo-trace-group hlo-spin-ccw${isThinking ? ' hlo-trace-flicker-active' : ''}`}
            style={{ animationDuration: `${speeds.outer / 2}s`, opacity: isThinking ? undefined : traceOpacity, transition: 'opacity .5s ease' }}
            aria-hidden="true"
          >
            <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke={PURPLE} strokeWidth={1.6} strokeLinecap="round" strokeDasharray="16 386" vectorEffect="non-scaling-stroke" opacity={0.8} />
          </g>

          <g
            className="hlo-ring-group hlo-spin-ccw"
            style={{ animationDuration: `${speeds.middle}s` }}
            data-hlo-ring="middle"
          >
            <circle cx={CX} cy={CY} r={R_MIDDLE} fill="none" stroke={`url(#${uid}-orbit)`} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.85} />
            <circle data-hlo-sphere="middle" cx={CX + R_MIDDLE} cy={CY} r={3.4} fill={VIOLET} opacity={0.95} />
          </g>

          <g
            className={`hlo-trace-group hlo-spin-cw${isThinking ? ' hlo-trace-flicker-active' : ''}`}
            style={{ animationDuration: `${speeds.middle / 2}s`, opacity: isThinking ? undefined : traceOpacity, transition: 'opacity .5s ease' }}
            aria-hidden="true"
          >
            <circle cx={CX} cy={CY} r={R_MIDDLE} fill="none" stroke={VIOLET} strokeWidth={1.6} strokeLinecap="round" strokeDasharray="14 288" vectorEffect="non-scaling-stroke" opacity={0.8} />
          </g>

          <g
            className="hlo-ring-group hlo-spin-cw"
            style={{ animationDuration: `${speeds.inner}s` }}
            data-hlo-ring="inner"
          >
            <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke={`url(#${uid}-orbit)`} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.85} />
            <circle data-hlo-sphere="inner" cx={CX} cy={CY + R_INNER} r={3.7} fill={CYAN} opacity={0.95} />
          </g>

          <g
            className={`hlo-trace-group hlo-spin-ccw${isThinking ? ' hlo-trace-flicker-active' : ''}`}
            style={{ animationDuration: `${speeds.inner / 2}s`, opacity: isThinking ? undefined : traceOpacity, transition: 'opacity .5s ease' }}
            aria-hidden="true"
          >
            <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke={CYAN} strokeWidth={1.6} strokeLinecap="round" strokeDasharray="12 195" vectorEffect="non-scaling-stroke" opacity={0.8} />
          </g>

          {/* Listening attention pulse — restrained, expands and fades. */}
          <circle
            className="hlo-attention"
            cx={CX}
            cy={CY}
            r={R_CORE + 3}
            fill="none"
            stroke={CYAN}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
            style={{ opacity: state === 'listening' ? 1 : 0, transition: 'opacity .4s ease' }}
          />

          {/* Speaking halo — audioLevel-driven, smoothed via CSS transition. */}
          <circle
            cx={CX}
            cy={CY}
            r={R_CORE + 10}
            fill="none"
            stroke={VIOLET}
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
            style={{
              opacity: haloOpacity,
              transform: `scale(${haloScale})`,
              transformBox: 'view-box',
              transformOrigin: '100px 100px',
              transition: 'opacity .22s ease-out, transform .22s ease-out',
            }}
          />

          {/* Error accent ring — restrained amber, not a full recolour. */}
          <circle
            cx={CX}
            cy={CY}
            r={R_CORE + 6}
            fill="none"
            stroke={AMBER}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
            style={{ opacity: state === 'error' ? 0.55 : 0, transition: 'opacity .5s ease' }}
          />

          {/* ── Compact luminous core ──
              Layered so audio-scale (transition), thinking shudder
              (translate) and the ambient breathing pulse (keyframe
              transform: scale) each own a different property/element and
              compose instead of overriding one another. */}
          <g
            className="hlo-audio-scale"
            style={{ transform: `scale(${coreExtraScale})`, transition: 'transform .22s ease-out' }}
          >
            <g className={`hlo-shudder${isThinking ? ' hlo-shudder-active' : ''}`}>
              <g
                className="hlo-core-pulse"
                style={{ animationDuration: `${corePulseS}s` }}
              >
                <circle
                  data-hlo-core="true"
                  cx={CX}
                  cy={CY}
                  r={R_CORE}
                  fill={`url(#${uid}-core)`}
                  opacity={state === 'error' ? 0.62 : 1}
                  style={{ transition: 'opacity .6s ease' }}
                />
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

export { STATE_DESCRIPTION };
export default HelenaOrbital;
