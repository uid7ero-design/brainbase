'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * HelenaOrbital — living Hybrid Orbit visual for the Helena assistant.
 *
 * Pure SVG + CSS keyframes, no rendering library or GPU-accelerated 3D
 * layer of any kind. Geometry and palette are derived from the approved
 * master mark (BrainBase_Hybrid_Orbit_Brand_Kit_COMPLETE/logos/brainbase-
 * mark-color.svg): three concentric rings, one sphere per ring (outer=
 * purple, middle=violet, inner=cyan), compact luminous core. Idle motion
 * timing follows docs/Orbital_Motion_Spec.md (outer/middle 50-90s, inner
 * 30-55s, core pulse 8-12s) — idle is deliberately left slow so the other,
 * much more active states read as dramatic by contrast. This component is
 * purely presentational: it knows nothing about any chat API, speech
 * recognition, text-to-speech provider, or tenant/account state — only a
 * visual state and an optional audio-level number.
 *
 * Motion is layered across separate composable transform-related
 * properties (`scale`, `translate`, `rotate` are independent CSS
 * properties from the `transform` shorthand) so audio-driven scale, the
 * thinking shudder/compression/wobble, one-shot transition flashes, and
 * the underlying breathing/rotation keyframes can all run on the same
 * element family without one silently overriding another.
 */

export type HelenaVisualState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface HelenaOrbitalProps {
  state?: HelenaVisualState;
  /** 0..1. Drives core/halo/sphere glow in 'speaking' (dominant) and lightly in 'listening'. */
  audioLevel?: number;
  size?: number;
  className?: string;
}

const PURPLE = '#A855F7';
const VIOLET = '#7C5CFF';
const CYAN = '#00D4FF';
const AMBER = '#F59E0B';
const PURPLE_GLOW = 'rgba(168,85,247,.65)';
const VIOLET_GLOW = 'rgba(124,92,255,.65)';
const CYAN_GLOW = 'rgba(0,212,255,.65)';

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
  // idle: master Orbital_Motion_Spec.md (outer/middle 50-90s, inner 30-55s) — kept slow deliberately, the baseline other states contrast against.
  idle: { outer: 78, middle: 60, inner: 40 },
  // listening: clearly more active than idle, less than thinking.
  listening: { outer: 26, middle: 18, inner: 13 },
  // thinking: unstable-in-a-controlled-way — faster than listening, differentiated.
  thinking: { outer: 15, middle: 10, inner: 6.5 },
  // speaking: the most active orbital motion by a wide margin — inner fastest.
  speaking: { outer: 12, middle: 7.5, inner: 4.5 },
  // error: motion slows substantially versus idle.
  error: { outer: 150, middle: 120, inner: 90 },
};

const CORE_PULSE_S: Record<HelenaVisualState, number> = {
  idle: 10,
  listening: 5,
  thinking: 3.5,
  speaking: 1.6,
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
  // baseline only — thinking fully hands opacity to hloThinkTraceFlicker while active.
  thinking: 0.38,
  speaking: 0,
  error: 0,
};

const SPHERE_GLOW_PX: Record<HelenaVisualState, number> = {
  idle: 1.2,
  listening: 2,
  thinking: 2.6,
  speaking: 3,
  error: 0.8,
};

const STATE_DESCRIPTION: Record<HelenaVisualState, string> = {
  idle: 'Calm baseline — slow independent orbits, low glow, gentle core breathing.',
  listening: 'Attentive — rings tighten inward, core brightens, an outward pulse marks focus.',
  thinking: 'Computational and unstable-in-a-controlled-way — fast differentiated orbits, an intermittent shudder, and flickering energy traces.',
  speaking: 'The most alive state — rapid orbital motion, a strong voice-reactive core pulse, an expanding halo, and glowing spheres.',
  error: 'Subdued — motion slows substantially, glow and core intensity drop, a restrained amber accent marks degradation.',
};

type TransitionFx = 'ignition' | 'focus' | 'burst' | null;

const ORBITAL_CSS = `
  @keyframes hloSpinCW  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes hloSpinCCW { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
  @keyframes hloCorePulse {
    0%, 100% { transform: scale(1);     opacity: .86; }
    50%      { transform: scale(1.045); opacity: 1;   }
  }
  @keyframes hloCorePulseStrong {
    0%, 100% { transform: scale(1);    opacity: .82; }
    50%      { transform: scale(1.09); opacity: 1;   }
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
    50%      { transform: scale(1.022); }
  }
  @keyframes hloSystemBreatheIn {
    0%, 100% { transform: scale(1);     }
    50%      { transform: scale(0.975); }
  }

  /* Thinking "computational shudder" family — two short (~100-200ms) burst
     windows per 3.0s cycle, long calm stretches between. translate/scale/
     rotate are individual transform properties, so they compose with the
     core's other scale/rotation layers instead of overriding them. Values
     are in viewBox units, so they scale down proportionally at small
     render sizes automatically. */
  @keyframes hloThinkShudder {
    0%, 73%   { translate: 0px 0px; }
    75%       { translate: 2.4px -1.8px; }
    77%       { translate: -1.2px 1.4px; }
    79%, 90%  { translate: 0px 0px; }
    92%       { translate: -2px -1.6px; }
    94%       { translate: 1px 1.2px; }
    96%, 100% { translate: 0px 0px; }
  }
  @keyframes hloThinkCompress {
    0%, 73%   { scale: 1; }
    75%       { scale: 0.93; }
    77%       { scale: 1.07; }
    79%, 90%  { scale: 1; }
    92%       { scale: 0.95; }
    94%       { scale: 1.05; }
    96%, 100% { scale: 1; }
  }
  @keyframes hloRingWobble {
    0%, 73%   { rotate: 0deg; }
    75%       { rotate: 2.2deg; }
    77%       { rotate: -1.4deg; }
    79%, 90%  { rotate: 0deg; }
    92%       { rotate: -1.8deg; }
    94%       { rotate: 1.1deg; }
    96%, 100% { rotate: 0deg; }
  }
  @keyframes hloThinkGlowSpike {
    0%, 73%   { opacity: .72; }
    75%       { opacity: 1;   }
    77%, 90%  { opacity: .72; }
    92%       { opacity: 1;   }
    94%, 100% { opacity: .72; }
  }
  @keyframes hloThinkTraceFlicker {
    0%, 73%   { opacity: .38; }
    75%       { opacity: .95; }
    77%, 90%  { opacity: .38; }
    92%       { opacity: .85; }
    94%, 100% { opacity: .38; }
  }

  /* One-shot state-transition choreography — animation-iteration-count: 1,
     never repeating, cleared from the DOM ~700ms after the triggering
     state change (see the component's transitionFx effect). */
  @keyframes hloIgnition {
    0%   { transform: scale(1);    opacity: 1; }
    18%  { transform: scale(0.90); opacity: .9; }
    45%  { transform: scale(1.38); opacity: 1; }
    100% { transform: scale(1);    opacity: 1; }
  }
  @keyframes hloIgnitionHalo {
    0%   { opacity: 0;   transform: scale(1);   }
    35%  { opacity: 1;   transform: scale(1.9); }
    100% { opacity: 0;   transform: scale(2.4); }
  }
  @keyframes hloFocusPulse {
    0%, 100% { transform: scale(1);     }
    50%      { transform: scale(0.965); }
  }
  @keyframes hloEnergyBurst {
    0%   { translate: 0px 0px; }
    30%  { translate: 2.6px -2px; }
    60%  { translate: -2.2px 1.8px; }
    100% { translate: 0px 0px; }
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
  .hlo-ring-wobble {
    transform-box: view-box;
    transform-origin: 100px 100px;
  }
  .hlo-ring-wobble-active {
    animation: hloRingWobble 3s ease-in-out infinite;
  }
  .hlo-think-pulse {
    transform-box: view-box;
    transform-origin: 100px 100px;
  }
  .hlo-think-pulse-active {
    animation: hloThinkCompress 3s ease-in-out infinite;
  }
  .hlo-shudder {
    transform-box: view-box;
    transform-origin: 100px 100px;
  }
  .hlo-shudder-active {
    animation-name: hloThinkShudder;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }
  .hlo-glow-spike-active {
    animation: hloThinkGlowSpike 3s ease-in-out infinite;
  }
  .hlo-trace-flicker-active {
    animation: hloThinkTraceFlicker 3s ease-in-out infinite;
  }
  .hlo-ignition-active {
    transform-box: view-box;
    transform-origin: 100px 100px;
    animation: hloIgnition .45s ease-out 1;
  }
  .hlo-ignition-halo-active {
    animation: hloIgnitionHalo .45s ease-out 1;
  }
  .hlo-focus-pulse-active {
    animation-name: hloFocusPulse;
    animation-duration: .4s;
    animation-timing-function: ease-in-out;
    animation-iteration-count: 1;
  }
  .hlo-energy-burst-active {
    transform-box: view-box;
    transform-origin: 100px 100px;
    animation-name: hloEnergyBurst;
    animation-duration: .35s;
    animation-timing-function: ease-out;
    animation-iteration-count: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .hlo-spin-cw, .hlo-spin-ccw, .hlo-core-pulse, .hlo-attention, .hlo-system,
    .hlo-ring-wobble-active, .hlo-think-pulse-active, .hlo-shudder-active,
    .hlo-glow-spike-active, .hlo-trace-flicker-active {
      animation: none !important;
    }
    .hlo-shudder-active { translate: none !important; }
    .hlo-think-pulse-active { scale: none !important; }
    .hlo-ring-wobble-active { rotate: none !important; }
    /* One-shot transition flashes are intentionally NOT suppressed here —
       each is a single, bounded, non-repeating state-change cue (≤450ms),
       which is exactly what reduced-motion guidance permits ("a minimal
       non-repeating state transition"). Only continuous/repeating motion
       is disabled above. */
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
  const isSpeaking = state === 'speaking';

  // Ring rotation speed is state-driven only (never touched by audioLevel).
  // Core/halo/sphere-glow are audio-driven, smoothed via CSS transition
  // (not a rAF loop) so jitter in the source signal is absorbed visually
  // rather than producing per-frame jumps.
  const speakingBoost = isSpeaking ? level : 0;
  const listeningBoost = state === 'listening' ? level * 0.35 : 0;
  // audioLevel 1 → core scale ~1.16 (within the 1.14-1.18 target band).
  const coreExtraScale = 1 + speakingBoost * 0.16 + listeningBoost * 0.03;
  const haloOpacity = isSpeaking ? 0.3 + speakingBoost * 0.65 : 0;
  const haloScale = 1 + speakingBoost * 0.55;
  const glowOpacity = Math.min(1, glow.opacity + speakingBoost * 0.08);
  const sphereGlowPx = (SPHERE_GLOW_PX[state] ?? SPHERE_GLOW_PX.idle) + speakingBoost * 3;

  const glowExt = Math.round(size * 0.4);
  const blurPx = Math.max(6, Math.round(size * 0.18));

  // useId (not Math.random) — must stay a pure, idempotent value per render.
  const uid = `hlo${useId().replace(/:/g, '')}`;

  // ── One-shot transition choreography ──────────────────────────────────
  // Lightweight, bounded, self-cleaning: a ref remembers the previous
  // state, a single timeout clears the effect flag after it has finished
  // playing. No global state, nothing that survives unmount.
  const prevStateRef = useRef(state);
  const [transitionFx, setTransitionFx] = useState<TransitionFx>(null);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (prev === state) return;
    let fx: TransitionFx = null;
    if (prev === 'thinking' && state === 'speaking') fx = 'ignition';
    else if (prev === 'idle' && state === 'listening') fx = 'focus';
    else if (prev === 'listening' && state === 'thinking') fx = 'burst';
    if (!fx) return;
    setTransitionFx(fx);
    // Matches each one-shot keyframe's own duration (ignition .45s, focus
    // .4s, burst .35s) with a small buffer — long enough that the keyframe
    // finishes cleanly, short enough that the underlying continuous
    // animation it temporarily replaces (e.g. the burst class fully
    // overriding hlo-shudder-active's animation-name via CSS cascade, not
    // composing with it) resumes with no visible gap.
    const fxDurationMs = fx === 'ignition' ? 500 : fx === 'focus' ? 450 : 400;
    const t = setTimeout(() => setTransitionFx(null), fxDurationMs);
    return () => clearTimeout(t);
  }, [state]);

  // NOTE: when animation-name is a comma-separated list, any of
  // animation-duration/timing-function/iteration-count that has FEWER
  // items than animation-name repeats its values to fill the list (per
  // the CSS animation shorthand-list algorithm) — so every combined
  // animation below must supply an explicit per-item iteration-count list,
  // or the continuous loop's `infinite` would leak onto the one-shot
  // transition keyframe and make it repeat forever instead of playing once.
  const systemAnim = isSpeaking
    ? { animationName: 'hloSystemBreatheOut', animationDuration: '4s' }
    : state === 'listening'
      ? transitionFx === 'focus'
        ? {
            animationName: 'hloSystemBreatheIn, hloFocusPulse',
            animationDuration: '4s, .4s',
            animationIterationCount: 'infinite, 1',
          }
        : { animationName: 'hloSystemBreatheIn', animationDuration: '4s' }
      : transitionFx === 'focus'
        ? { animationName: 'hloFocusPulse', animationDuration: '.4s', animationIterationCount: 1 }
        : undefined;

  const corePulseBase = isSpeaking ? 'hloCorePulseStrong' : 'hloCorePulse';
  const corePulseAnim =
    transitionFx === 'ignition'
      ? {
          animationName: `${corePulseBase}, hloIgnition`,
          animationDuration: `${corePulseS}s, .45s`,
          animationIterationCount: 'infinite, 1',
          animationTimingFunction: 'ease-in-out, ease-out',
        }
      : { animationName: corePulseBase, animationDuration: `${corePulseS}s`, animationIterationCount: undefined, animationTimingFunction: undefined };

  const shudderClass = `hlo-shudder${isThinking ? ' hlo-shudder-active' : ''}${transitionFx === 'burst' ? ' hlo-energy-burst-active' : ''}`;

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

        {/* Whole-composition breathing (speaking/listening; also carries
            the one-shot idle→listening focus pulse). */}
        <g className="hlo-system" style={systemAnim}>
          {/* ── 3 primary orbital rings, each carrying exactly 1 primary sphere ── */}
          <g className={isThinking ? 'hlo-ring-wobble hlo-ring-wobble-active' : 'hlo-ring-wobble'}>
            <g
              className="hlo-ring-group hlo-spin-cw"
              style={{ animationDuration: `${speeds.outer}s` }}
              data-hlo-ring="outer"
            >
              <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke={`url(#${uid}-orbit)`} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.85} />
              <circle
                data-hlo-sphere="outer"
                cx={CX}
                cy={CY - R_OUTER}
                r={4.2}
                fill={PURPLE}
                opacity={0.95}
                style={{ filter: `drop-shadow(0 0 ${sphereGlowPx}px ${PURPLE_GLOW})`, transition: 'filter .3s ease' }}
              />
            </g>
          </g>

          <g
            className={`hlo-trace-group hlo-spin-ccw${isThinking ? ' hlo-trace-flicker-active' : ''}`}
            style={{ animationDuration: `${speeds.outer / 2}s`, opacity: isThinking ? undefined : traceOpacity, transition: 'opacity .5s ease' }}
            aria-hidden="true"
          >
            <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke={PURPLE} strokeWidth={1.6} strokeLinecap="round" strokeDasharray="16 386" vectorEffect="non-scaling-stroke" opacity={0.8} />
          </g>

          <g className={isThinking ? 'hlo-ring-wobble hlo-ring-wobble-active' : 'hlo-ring-wobble'}>
            <g
              className="hlo-ring-group hlo-spin-ccw"
              style={{ animationDuration: `${speeds.middle}s` }}
              data-hlo-ring="middle"
            >
              <circle cx={CX} cy={CY} r={R_MIDDLE} fill="none" stroke={`url(#${uid}-orbit)`} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.85} />
              <circle
                data-hlo-sphere="middle"
                cx={CX + R_MIDDLE}
                cy={CY}
                r={3.4}
                fill={VIOLET}
                opacity={0.95}
                style={{ filter: `drop-shadow(0 0 ${sphereGlowPx}px ${VIOLET_GLOW})`, transition: 'filter .3s ease' }}
              />
            </g>
          </g>

          <g
            className={`hlo-trace-group hlo-spin-cw${isThinking ? ' hlo-trace-flicker-active' : ''}`}
            style={{ animationDuration: `${speeds.middle / 2}s`, opacity: isThinking ? undefined : traceOpacity, transition: 'opacity .5s ease' }}
            aria-hidden="true"
          >
            <circle cx={CX} cy={CY} r={R_MIDDLE} fill="none" stroke={VIOLET} strokeWidth={1.6} strokeLinecap="round" strokeDasharray="14 288" vectorEffect="non-scaling-stroke" opacity={0.8} />
          </g>

          <g className={isThinking ? 'hlo-ring-wobble hlo-ring-wobble-active' : 'hlo-ring-wobble'}>
            <g
              className="hlo-ring-group hlo-spin-cw"
              style={{ animationDuration: `${speeds.inner}s` }}
              data-hlo-ring="inner"
            >
              <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke={`url(#${uid}-orbit)`} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.85} />
              <circle
                data-hlo-sphere="inner"
                cx={CX}
                cy={CY + R_INNER}
                r={3.7}
                fill={CYAN}
                opacity={0.95}
                style={{ filter: `drop-shadow(0 0 ${sphereGlowPx}px ${CYAN_GLOW})`, transition: 'filter .3s ease' }}
              />
            </g>
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

          {/* Speaking halo — audioLevel-driven, smoothed via CSS transition,
              plus the one-shot thinking→speaking ignition expansion. */}
          <circle
            className={transitionFx === 'ignition' ? 'hlo-ignition-halo-active' : undefined}
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
              (translate), thinking compression (scale), the ambient
              breathing pulse (keyframe transform: scale), and the one-shot
              ignition flash each own a different property/element and
              compose instead of overriding one another. */}
          <g
            className="hlo-audio-scale"
            style={{ transform: `scale(${coreExtraScale})`, transition: 'transform .22s ease-out' }}
          >
            <g className={shudderClass}>
              <g className={isThinking ? 'hlo-think-pulse hlo-think-pulse-active' : 'hlo-think-pulse'}>
                <g
                  className="hlo-core-pulse"
                  style={{
                    animationName: corePulseAnim.animationName,
                    animationDuration: corePulseAnim.animationDuration,
                    animationIterationCount: corePulseAnim.animationIterationCount,
                    animationTimingFunction: corePulseAnim.animationTimingFunction,
                  }}
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
        </g>
      </svg>
    </div>
  );
}

export { STATE_DESCRIPTION };
export default HelenaOrbital;
