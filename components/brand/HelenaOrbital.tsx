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
 * thinking shudder/compression/wobble, ring/sphere energy response,
 * one-shot transition flashes, and the underlying breathing/rotation
 * keyframes can all run on the same element family without one silently
 * overriding another.
 *
 * Phase B.3 adds a coordinated core→ring→sphere energy-propagation
 * language: a dedicated `.hlo-ring-energy` wrapper per ring (individual
 * `scale` property) and a `scale` response on each sphere carry a small
 * staggered reaction — via `transition-delay` while speaking (audioLevel-
 * driven, no JS timers needed) and via per-ring keyframes/animation-delay
 * while thinking/listening/igniting — so energy reads as originating at
 * the core and moving outward (or, for listening, moving inward) rather
 * than "rings rotating + glow changing" in isolation.
 */

export type HelenaVisualState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface HelenaOrbitalProps {
  state?: HelenaVisualState;
  /** 0..1. Drives core/halo/ring-energy/sphere response in 'speaking' (dominant) and lightly in 'listening'. */
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
type RingName = 'inner' | 'middle' | 'outer';

const RING_SPEED_S: Record<HelenaVisualState, RingSpeeds> = {
  // idle: master Orbital_Motion_Spec.md (outer/middle 50-90s, inner 30-55s) — kept slow deliberately, the baseline other states contrast against.
  idle: { outer: 78, middle: 60, inner: 40 },
  // listening: clearly more active than idle, less than thinking.
  listening: { outer: 26, middle: 18, inner: 13 },
  // thinking: unstable-in-a-controlled-way — faster than listening, differentiated.
  thinking: { outer: 15, middle: 10, inner: 6.5 },
  // speaking: the most active orbital motion by a wide margin — inner fastest.
  // Kept at B.2 values per B.3's brief — energy propagation, not more speed.
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
  listening: 'Attentive — an inward-focus pull moves outer→middle→inner toward the core, which brightens.',
  thinking: 'Computational — intermittent impulses move core→ring→sphere outward: a shudder, a small ring squeeze, a brief sphere glow spike.',
  speaking: 'The most alive state — energy visibly originates at the core and propagates outward through the rings to the spheres, in sync with audioLevel.',
  error: 'Subdued — motion slows substantially, glow and core intensity drop, a restrained amber accent marks degradation.',
};

// Energy-propagation timing shared by the speaking audio-wave (transition
// delays) and the ignition burst (animation delays) — core fires at 0ms,
// then inner/middle/outer follow in sequence, per Phase B.3 §14.
const PROPAGATION_DELAY_MS: Record<RingName, number> = { inner: 60, middle: 110, outer: 160 };
const SPHERE_PROPAGATION_DELAY_MS: Record<RingName, number> = { inner: 70, middle: 120, outer: 180 };

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
     render sizes automatically. Amplitude trimmed in B.3 (was up to 2.4px)
     so more of the perceived "impulse" comes from the coordinated
     ring-squeeze/sphere-spike response below, not raw translation alone. */
  @keyframes hloThinkShudder {
    0%, 73%   { translate: 0px 0px; }
    75%       { translate: 1.8px -1.3px; }
    77%       { translate: -0.9px 1px; }
    79%, 90%  { translate: 0px 0px; }
    92%       { translate: -1.5px -1.2px; }
    94%       { translate: 0.7px 0.9px; }
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

  /* Thinking ring "squeeze" — the computational impulse propagating from
     core toward the rings. Same 3s cycle/burst timing as the shudder
     above, amplitude decreasing outward (processing impulse, not rubber
     rings). Separate keyframe per ring because the amplitude differs. */
  @keyframes hloThinkSqueezeInner {
    0%, 73%   { scale: 1; }
    75%       { scale: 0.982; }
    77%       { scale: 1.015; }
    79%, 90%  { scale: 1; }
    92%       { scale: 0.985; }
    94%       { scale: 1.012; }
    96%, 100% { scale: 1; }
  }
  @keyframes hloThinkSqueezeMiddle {
    0%, 73%   { scale: 1; }
    75%       { scale: 0.988; }
    77%       { scale: 1.010; }
    79%, 90%  { scale: 1; }
    92%       { scale: 0.990; }
    94%       { scale: 1.008; }
    96%, 100% { scale: 1; }
  }
  @keyframes hloThinkSqueezeOuter {
    0%, 73%   { scale: 1; }
    75%       { scale: 0.994; }
    77%       { scale: 1.006; }
    79%, 90%  { scale: 1; }
    92%       { scale: 0.995; }
    94%       { scale: 1.005; }
    96%, 100% { scale: 1; }
  }
  /* Thinking sphere response — a brief scale spike synced to the same
     bursts, staggered inner→middle→outer via animation-delay so the
     impulse visibly continues past the rings to the spheres. */
  @keyframes hloThinkSphereSpike {
    0%, 73%   { scale: 1; }
    75%       { scale: 1.2; }
    77%, 90%  { scale: 1; }
    92%       { scale: 1.15; }
    94%, 100% { scale: 1; }
  }

  /* Listening inward-focus response — energy moving toward the core
     (outer contracts first, then middle, then inner), synced to the same
     2.4s cycle as the attention pulse via animation-delay. Amplitude
     decreases toward the centre (a gathering motion), opposite in both
     direction and character to speaking's outward wave. */
  @keyframes hloListenContractOuter  { 0%, 100% { scale: 1; } 45% { scale: 0.987; } }
  @keyframes hloListenContractMiddle { 0%, 100% { scale: 1; } 45% { scale: 0.990; } }
  @keyframes hloListenContractInner  { 0%, 100% { scale: 1; } 45% { scale: 0.993; } }

  /* One-shot state-transition choreography — animation-iteration-count: 1,
     never repeating, cleared from the DOM shortly after the triggering
     state change (see the component's transitionFx effect). Ignition is
     the refined B.3 sequence: brief central contraction → bright core
     ignition → outward ring pressure-wave → sphere glow burst → settle,
     using the same core→inner→middle→outer→sphere propagation delays as
     the ongoing speaking energy-wave, so the one-shot event and the
     steady-state motion it hands off to feel like the same system. */
  @keyframes hloIgnition {
    0%   { transform: scale(1);    opacity: 1;  }
    15%  { transform: scale(0.90); opacity: .92; }
    42%  { transform: scale(1.32); opacity: 1;   }
    100% { transform: scale(1);    opacity: 1;   }
  }
  @keyframes hloIgnitionHalo {
    0%   { opacity: 0;   transform: scale(1);   }
    35%  { opacity: 1;   transform: scale(1.9); }
    100% { opacity: 0;   transform: scale(2.4); }
  }
  @keyframes hloIgnitionRingWave {
    0%   { scale: 1;     }
    50%  { scale: 1.035; }
    100% { scale: 1;     }
  }
  @keyframes hloIgnitionSphereBurst {
    0%   { scale: 1;    }
    45%  { scale: 1.3;  }
    100% { scale: 1;    }
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
  /* Dedicated per-ring radial-response layer — individual 'scale' property,
     sits between the wobble wrapper (rotate) and the spinning ring group
     (transform: rotate via keyframe) so none of the three compete. Drives
     the speaking energy-wave (inline style, audioLevel+transition-delay),
     the thinking squeeze (keyframe class), the listening inward pull
     (keyframe class), and the ignition ring-wave (keyframe class) —
     mutually exclusive by state, so only one ever applies at a time. */
  .hlo-ring-energy {
    transform-box: view-box;
    transform-origin: 100px 100px;
  }
  .hlo-think-squeeze-inner-active  { animation: hloThinkSqueezeInner  3s ease-in-out infinite; }
  .hlo-think-squeeze-middle-active { animation: hloThinkSqueezeMiddle 3s ease-in-out infinite; }
  .hlo-think-squeeze-outer-active  { animation: hloThinkSqueezeOuter  3s ease-in-out infinite; }
  .hlo-listen-contract-outer-active  { animation: hloListenContractOuter  2.4s ease-in-out infinite; }
  .hlo-listen-contract-middle-active { animation: hloListenContractMiddle 2.4s ease-in-out infinite; animation-delay: .04s; }
  .hlo-listen-contract-inner-active  { animation: hloListenContractInner  2.4s ease-in-out infinite; animation-delay: .08s; }
  .hlo-ignition-wave-inner  { animation: hloIgnitionRingWave .35s ease-out 1; animation-delay: ${PROPAGATION_DELAY_MS.inner}ms; }
  .hlo-ignition-wave-middle { animation: hloIgnitionRingWave .35s ease-out 1; animation-delay: ${PROPAGATION_DELAY_MS.middle}ms; }
  .hlo-ignition-wave-outer  { animation: hloIgnitionRingWave .35s ease-out 1; animation-delay: ${PROPAGATION_DELAY_MS.outer}ms; }
  .hlo-think-sphere-spike-inner  { animation: hloThinkSphereSpike 3s ease-in-out infinite; }
  .hlo-think-sphere-spike-middle { animation: hloThinkSphereSpike 3s ease-in-out infinite; animation-delay: .015s; }
  .hlo-think-sphere-spike-outer  { animation: hloThinkSphereSpike 3s ease-in-out infinite; animation-delay: .03s; }
  .hlo-ignition-sphere-inner  { animation: hloIgnitionSphereBurst .3s ease-out 1; animation-delay: ${SPHERE_PROPAGATION_DELAY_MS.inner}ms; }
  .hlo-ignition-sphere-middle { animation: hloIgnitionSphereBurst .3s ease-out 1; animation-delay: ${SPHERE_PROPAGATION_DELAY_MS.middle}ms; }
  .hlo-ignition-sphere-outer  { animation: hloIgnitionSphereBurst .3s ease-out 1; animation-delay: ${SPHERE_PROPAGATION_DELAY_MS.outer}ms; }
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
    animation-duration: 3s;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }
  .hlo-glow-spike-active {
    animation: hloThinkGlowSpike 3s ease-in-out infinite;
  }
  .hlo-trace-flicker-active {
    animation: hloThinkTraceFlicker 3s ease-in-out infinite;
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
    .hlo-glow-spike-active, .hlo-trace-flicker-active,
    .hlo-think-squeeze-inner-active, .hlo-think-squeeze-middle-active, .hlo-think-squeeze-outer-active,
    .hlo-listen-contract-outer-active, .hlo-listen-contract-middle-active, .hlo-listen-contract-inner-active,
    .hlo-think-sphere-spike-inner, .hlo-think-sphere-spike-middle, .hlo-think-sphere-spike-outer {
      animation: none !important;
    }
    .hlo-shudder-active { translate: none !important; }
    .hlo-think-pulse-active,
    .hlo-think-squeeze-inner-active, .hlo-think-squeeze-middle-active, .hlo-think-squeeze-outer-active,
    .hlo-listen-contract-outer-active, .hlo-listen-contract-middle-active, .hlo-listen-contract-inner-active,
    .hlo-think-sphere-spike-inner, .hlo-think-sphere-spike-middle, .hlo-think-sphere-spike-outer {
      scale: none !important;
    }
    .hlo-ring-wobble-active { rotate: none !important; }
    /* One-shot transition flashes (ignition/focus/burst + the B.3 ring-wave
       and sphere-burst that ride along with ignition) are intentionally
       NOT suppressed here — each is a single, bounded, non-repeating
       state-change cue (≤550ms), which is exactly what reduced-motion
       guidance permits ("a minimal non-repeating state transition"). Only
       continuous/repeating motion is disabled above. The steady-state
       speaking energy-wave (ring/sphere 'scale' driven by audioLevel via
       plain CSS transition, not a keyframe) is likewise left enabled —
       it's a bounded, value-driven response, not a repeating loop.
       State distinction remains visible statically via colour/opacity. */
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
  const isListening = state === 'listening';

  // Ring rotation speed is state-driven only (never touched by audioLevel).
  // Core/halo/ring-energy/sphere response are audio-driven, smoothed via
  // CSS transition (not a rAF loop) so jitter in the source signal is
  // absorbed visually rather than producing per-frame jumps, and rotation
  // speed is never reassigned every frame from amplitude.
  const speakingBoost = isSpeaking ? level : 0;
  const listeningBoost = isListening ? level * 0.35 : 0;
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
    // Ignition's longest sub-event is the core keyframe itself (550ms, no
    // delay); the ring-wave and sphere-burst that ride along finish sooner
    // (outer ring: 160ms delay + 350ms ≈ 510ms; outer sphere: 180ms delay +
    // 300ms = 480ms). 620ms gives every sub-event room to finish cleanly.
    const fxDurationMs = fx === 'ignition' ? 620 : fx === 'focus' ? 450 : 400;
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
    : isListening
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
          animationDuration: `${corePulseS}s, .55s`,
          animationIterationCount: 'infinite, 1',
          animationTimingFunction: 'ease-in-out, ease-out',
        }
      : { animationName: corePulseBase, animationDuration: `${corePulseS}s`, animationIterationCount: undefined, animationTimingFunction: undefined };

  const shudderClass = `hlo-shudder${isThinking ? ' hlo-shudder-active' : ''}${transitionFx === 'burst' ? ' hlo-energy-burst-active' : ''}`;

  // ── Per-ring energy response (core→ring→sphere propagation) ────────────
  // Speaking: audioLevel-driven radial "pressure wave", staggered purely
  // via CSS transition-delay — no JS timers, no per-frame updates. Ring
  // rotation speed itself is untouched by any of this.
  const RING_WAVE_MAX_SCALE: Record<RingName, number> = { inner: 0.02, middle: 0.02, outer: 0.025 };
  const RING_WAVE_DURATION_MS: Record<RingName, number> = { inner: 160, middle: 170, outer: 180 };

  function ringEnergyStyle(ring: RingName): React.CSSProperties | undefined {
    if (transitionFx === 'ignition') return undefined; // one-shot wave class takes over instead
    if (isSpeaking) {
      return {
        scale: 1 + speakingBoost * RING_WAVE_MAX_SCALE[ring],
        transition: `scale ${RING_WAVE_DURATION_MS[ring]}ms ease-out ${PROPAGATION_DELAY_MS[ring]}ms`,
      } as React.CSSProperties;
    }
    return undefined;
  }
  function ringEnergyClass(ring: RingName): string {
    if (transitionFx === 'ignition') return `hlo-ring-energy hlo-ignition-wave-${ring}`;
    if (isThinking) return `hlo-ring-energy hlo-think-squeeze-${ring}-active`;
    if (isListening) return `hlo-ring-energy hlo-listen-contract-${ring === 'inner' ? 'inner' : ring === 'middle' ? 'middle' : 'outer'}-active`;
    return 'hlo-ring-energy';
  }

  function sphereStyle(ring: RingName): React.CSSProperties | undefined {
    if (transitionFx === 'ignition') return undefined;
    if (isSpeaking) {
      return {
        scale: 1 + speakingBoost * 0.08,
        transition: `scale 150ms ease-out ${SPHERE_PROPAGATION_DELAY_MS[ring]}ms`,
      } as React.CSSProperties;
    }
    return undefined;
  }
  function sphereClass(ring: RingName): string {
    if (transitionFx === 'ignition') return ` hlo-ignition-sphere-${ring}`;
    if (isThinking) return ` hlo-think-sphere-spike-${ring}`;
    return '';
  }

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
          {/* ── 3 primary orbital rings, each carrying exactly 1 primary sphere ──
              Wrapper order per ring: wobble (rotate) → energy (scale,
              core→ring propagation) → spinning ring group (transform:
              rotate via keyframe). Three independent transform-related
              properties on three elements — none override each other. */}
          <g className={isThinking ? 'hlo-ring-wobble hlo-ring-wobble-active' : 'hlo-ring-wobble'}>
            <g className={ringEnergyClass('outer')} style={ringEnergyStyle('outer')}>
              <g
                className="hlo-ring-group hlo-spin-cw"
                style={{ animationDuration: `${speeds.outer}s` }}
                data-hlo-ring="outer"
              >
                <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke={`url(#${uid}-orbit)`} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.85} />
                <circle
                  data-hlo-sphere="outer"
                  className={sphereClass('outer').trim() || undefined}
                  cx={CX}
                  cy={CY - R_OUTER}
                  r={4.2}
                  fill={PURPLE}
                  opacity={0.95}
                  style={{
                    filter: `drop-shadow(0 0 ${sphereGlowPx}px ${PURPLE_GLOW})`,
                    transition: 'filter .3s ease',
                    ...sphereStyle('outer'),
                  }}
                />
              </g>
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
            <g className={ringEnergyClass('middle')} style={ringEnergyStyle('middle')}>
              <g
                className="hlo-ring-group hlo-spin-ccw"
                style={{ animationDuration: `${speeds.middle}s` }}
                data-hlo-ring="middle"
              >
                <circle cx={CX} cy={CY} r={R_MIDDLE} fill="none" stroke={`url(#${uid}-orbit)`} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.85} />
                <circle
                  data-hlo-sphere="middle"
                  className={sphereClass('middle').trim() || undefined}
                  cx={CX + R_MIDDLE}
                  cy={CY}
                  r={3.4}
                  fill={VIOLET}
                  opacity={0.95}
                  style={{
                    filter: `drop-shadow(0 0 ${sphereGlowPx}px ${VIOLET_GLOW})`,
                    transition: 'filter .3s ease',
                    ...sphereStyle('middle'),
                  }}
                />
              </g>
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
            <g className={ringEnergyClass('inner')} style={ringEnergyStyle('inner')}>
              <g
                className="hlo-ring-group hlo-spin-cw"
                style={{ animationDuration: `${speeds.inner}s` }}
                data-hlo-ring="inner"
              >
                <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke={`url(#${uid}-orbit)`} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.85} />
                <circle
                  data-hlo-sphere="inner"
                  className={sphereClass('inner').trim() || undefined}
                  cx={CX}
                  cy={CY + R_INNER}
                  r={3.7}
                  fill={CYAN}
                  opacity={0.95}
                  style={{
                    filter: `drop-shadow(0 0 ${sphereGlowPx}px ${CYAN_GLOW})`,
                    transition: 'filter .3s ease',
                    ...sphereStyle('inner'),
                  }}
                />
              </g>
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
            style={{ opacity: isListening ? 1 : 0, transition: 'opacity .4s ease' }}
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

          {/* ── Compact luminous core — the origin of the energy chain ──
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
