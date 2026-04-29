'use client';

import { useRef, useEffect, useMemo } from 'react';

const ORB_SRC = '/hlna-orb-only.webp';

// Per-keyframe timing functions replicate true sinusoidal velocity:
//   ease-out at the zero-crossing (fast start, slowing to peak)
//   ease-in  at the peak          (slow start, accelerating away)
// This avoids the stop-start jerk that happens when one timing function
// covers the whole animation cycle.
const BASE_KEYFRAMES = `
  @keyframes orbFloat {
    0%   { animation-timing-function: ease-out; transform: translateY(0px)   scale(1);     }
    50%  { animation-timing-function: ease-in;  transform: translateY(-10px) scale(1.022); }
    100% {                                       transform: translateY(0px)   scale(1);     }
  }
  @keyframes orbThink {
    0%   { animation-timing-function: ease-in-out; transform: translate(0px,  0px)  scale(1);     }
    18%  { animation-timing-function: ease-in-out; transform: translate(3px, -6px)  scale(1.018); }
    35%  { animation-timing-function: ease-in-out; transform: translate(5px, -9px)  scale(1.024); }
    50%  { animation-timing-function: ease-in-out; transform: translate(2px, -5px)  scale(1.014); }
    65%  { animation-timing-function: ease-in-out; transform: translate(-4px,-8px)  scale(1.022); }
    82%  { animation-timing-function: ease-in-out; transform: translate(-3px,-3px)  scale(1.010); }
    100% {                                          transform: translate(0px,  0px)  scale(1);     }
  }
  @keyframes orbPulse {
    0%   { animation-timing-function: ease-out; transform: translateY(0px)  scale(1);     }
    40%  { animation-timing-function: ease-in;  transform: translateY(-7px) scale(1.055); }
    100% {                                       transform: translateY(0px)  scale(1);     }
  }
  @keyframes orbSpeak {
    0%   { animation-timing-function: ease-out; transform: translateY(0px)   scale(1);     }
    16%  { animation-timing-function: ease-in;  transform: translateY(-16px) scale(1.062); }
    30%  { animation-timing-function: ease-out; transform: translateY(0px)   scale(1);     }
    48%  { animation-timing-function: ease-in;  transform: translateY(-12px) scale(1.048); }
    62%  { animation-timing-function: ease-out; transform: translateY(0px)   scale(1);     }
    80%  { animation-timing-function: ease-in;  transform: translateY(-14px) scale(1.056); }
    100% {                                       transform: translateY(0px)   scale(1);     }
  }
  @keyframes orbRipple {
    0%   { transform: scale(1);    opacity: .38; }
    100% { transform: scale(1.85); opacity: 0;   }
  }
  @keyframes glowSpin {
    from { transform: rotate(0deg)   scale(1);    }
    50%  { transform: rotate(180deg) scale(1.12); }
    to   { transform: rotate(360deg) scale(1);    }
  }
  @keyframes glowPulse {
    0%, 100% { opacity: .6;  transform: scale(1);    }
    50%       { opacity: 1;  transform: scale(1.15); }
  }
  @keyframes glowPulseFast {
    0%, 100% { opacity: .82; transform: scale(1);    }
    50%       { opacity: 1;  transform: scale(1.20); }
  }
  @keyframes speechBurst {
    0%   { transform: scale(0.95); opacity: .70; }
    100% { transform: scale(1.80); opacity: 0;   }
  }
  @keyframes speechBurst2 {
    0%   { transform: scale(1.00); opacity: .45; }
    100% { transform: scale(2.10); opacity: 0;   }
  }
  @keyframes speechBurst3 {
    0%   { transform: scale(0.90); opacity: .35; }
    100% { transform: scale(2.50); opacity: 0;   }
  }
  @keyframes satCore {
    0%, 100% { opacity: .60; transform: scale(1);    }
    50%       { opacity: 1;  transform: scale(1.35); }
  }
  @keyframes orbAlert {
    0%   { animation-timing-function: ease-out; transform: scale(1);     }
    30%  { animation-timing-function: ease-in;  transform: scale(1.060); }
    60%  { animation-timing-function: ease-out; transform: scale(0.975); }
    100% {                                       transform: scale(1);     }
  }
  @keyframes glowAlertPulse {
    0%, 100% { opacity: .55; transform: scale(1);    }
    50%       { opacity: 1;  transform: scale(1.22); }
  }
`;

const SATS = [
  { baseSpeed: 4.5,  rr: 1.10, ellipseY: 0.30, tiltDeg:  35, initAngle:  20, color: '#38BDF8', glow: '56,189,248',  size: 7, dir:  1 },
  { baseSpeed: 7.5,  rr: 1.24, ellipseY: 0.25, tiltDeg: -22, initAngle: 145, color: '#A78BFA', glow: '167,139,250', size: 6, dir: -1 },
  { baseSpeed: 3.2,  rr: 1.02, ellipseY: 0.38, tiltDeg:  60, initAngle: 255, color: '#BFDBFE', glow: '191,219,254', size: 5, dir:  1 },
  { baseSpeed: 11.0, rr: 1.37, ellipseY: 0.22, tiltDeg: -48, initAngle:  72, color: '#818CF8', glow: '129,140,248', size: 4, dir: -1 },
];

function buildSatKeyframes(size) {
  return SATS.map((sat, i) => {
    const R = size * sat.rr / 2;
    const e = sat.ellipseY;
    const α = sat.tiltDeg  * Math.PI / 180;
    const φ = sat.initAngle * Math.PI / 180;
    const N = 28;
    let kf = `@keyframes hlnaSat${i}{`;
    for (let j = 0; j <= N; j++) {
      const θ  = φ + (j / N) * Math.PI * 2 * sat.dir;
      const cx = R * Math.cos(θ);
      const cy = R * e * Math.sin(θ);
      const x  = (cx * Math.cos(α) - cy * Math.sin(α)).toFixed(1);
      const y  = (cx * Math.sin(α) + cy * Math.cos(α)).toFixed(1);
      kf += `${Math.round((j / N) * 100)}%{transform:translate(calc(-50% + ${x}px),calc(-50% + ${y}px));}`;
    }
    return kf + '}';
  }).join('');
}

const STATE = {
  idle: {
    coreAnim:    'orbFloat 6s linear infinite',
    glowColor:   'rgba(79,70,229,.42)',
    glowColor2:  'rgba(99,102,241,.18)',
    glowAnim:    'glowSpin 18s linear infinite',
    glowOpacity: 0.65,
    ripple:      false,
    dropShadow:  'drop-shadow(0 0 30px rgba(79,70,229,.55)) drop-shadow(0 0 60px rgba(55,48,196,.30))',
    satOpacity:  0.15,
    satSpeedMul: 1.0,
  },
  listening: {
    coreAnim:    'orbPulse 1.4s linear infinite',
    glowColor:   'rgba(6,182,212,.50)',
    glowColor2:  'rgba(56,189,248,.22)',
    glowAnim:    'glowPulse 1.4s linear infinite',
    glowOpacity: 0.90,
    ripple:      true,
    dropShadow:  'drop-shadow(0 0 36px rgba(6,182,212,.70)) drop-shadow(0 0 70px rgba(56,189,248,.40))',
    satOpacity:  0.42,
    satSpeedMul: 1.4,
  },
  thinking: {
    coreAnim:    'orbThink 6s linear infinite',
    glowColor:   'rgba(99,102,241,.50)',
    glowColor2:  'rgba(139,92,246,.25)',
    glowAnim:    'glowSpin 6s linear infinite',
    glowOpacity: 0.95,
    ripple:      false,
    dropShadow:  'drop-shadow(0 0 36px rgba(99,102,241,.70)) drop-shadow(0 0 70px rgba(139,92,246,.40))',
    satOpacity:  0.55,
    satSpeedMul: 1.8,
  },
  responding: {
    coreAnim:    'orbSpeak 3s linear infinite',
    glowColor:   'rgba(139,92,246,.65)',
    glowColor2:  'rgba(99,102,241,.35)',
    glowAnim:    'glowPulseFast 1.4s linear infinite',
    glowOpacity: 1.0,
    ripple:      false,
    dropShadow:  'drop-shadow(0 0 50px rgba(139,92,246,.90)) drop-shadow(0 0 110px rgba(99,102,241,.55))',
    satOpacity:  0.92,
    satSpeedMul: 2.8,
  },
  alert: {
    coreAnim:    'orbAlert 2.2s ease-in-out infinite',
    glowColor:   'rgba(249,115,22,.48)',
    glowColor2:  'rgba(239,68,68,.22)',
    glowAnim:    'glowAlertPulse 2.2s ease-in-out infinite',
    glowOpacity: 0.85,
    ripple:      false,
    dropShadow:  'drop-shadow(0 0 36px rgba(249,115,22,.65)) drop-shadow(0 0 70px rgba(239,68,68,.30))',
    satOpacity:  0.30,
    satSpeedMul: 0.6,
  },
};

// Returns a random glance direction across the full visible hemisphere.
// ry: horizontal turn (±26°), rx: vertical tilt (±18°, slight upward bias).
// lastGlanceRef is used to guarantee the new direction is far enough away.
function randomGlance(last) {
  let ry, rx;
  let attempts = 0;
  do {
    ry = Math.round((Math.random() * 2 - 1) * 26);
    rx = Math.round((Math.random() * 2 - 1) * 18 - 2);
    attempts++;
  } while (
    attempts < 8 &&
    last &&
    Math.abs(ry - last.ry) < 8 &&
    Math.abs(rx - last.rx) < 6
  );
  return { ry, rx };
}

export function HlnaOrb({ size = 80, state = 'idle', speechRef = null, style = {} }) {
  const s          = STATE[state] ?? STATE.idle;
  const imgRef     = useRef(null);
  const glanceRef  = useRef(null);
  const ring1Ref   = useRef(null);
  const ring2Ref   = useRef(null);
  const ring3Ref   = useRef(null);
  const lastBurst  = useRef(0);
  const stateRef   = useRef(state);
  const glowExt    = Math.round(size * 0.45);
  const blurPx     = Math.max(12, Math.round(size * 0.32));
  const perspPx    = Math.round(size * 2); // perspective distance — gives convincing sphere foreshortening
  const neutralXfm = `perspective(${perspPx}px) rotateY(0deg) rotateX(0deg)`;

  const satKeyframes = useMemo(() => buildSatKeyframes(size), [size]);

  // Keep stateRef in sync without re-running the glance scheduler
  useEffect(() => { stateRef.current = state; }, [state]);

  // ── Eye-glance scheduler ────────────────────────────────────────────
  // Rotates the orb wrapper with perspective so it foreshortens like a
  // real sphere turning. Fast snap toward target, slow ease back.
  useEffect(() => {
    let timerId;
    let lastGlance = null;
    function scheduleNext() {
      timerId = setTimeout(() => {
        if (stateRef.current === 'idle' && glanceRef.current) {
          const g = randomGlance(lastGlance);
          lastGlance = g;
          // Saccade-fast snap to look direction
          glanceRef.current.style.transition = `transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)`;
          glanceRef.current.style.transform  =
            `perspective(${perspPx}px) rotateY(${g.ry}deg) rotateX(${g.rx}deg)`;
          // Hold, then ease smoothly back to neutral
          timerId = setTimeout(() => {
            if (glanceRef.current) {
              glanceRef.current.style.transition = `transform 0.55s cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
              glanceRef.current.style.transform  = neutralXfm;
            }
            scheduleNext();
          }, 600 + Math.random() * 1000);
        } else {
          scheduleNext();
        }
      }, 4000 + Math.random() * 7000);
    }
    scheduleNext();
    return () => clearTimeout(timerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perspPx, neutralXfm]);

  // Snap back to neutral when entering an active state
  useEffect(() => {
    if (state !== 'idle' && glanceRef.current) {
      glanceRef.current.style.transition = `transform 0.35s ease-out`;
      glanceRef.current.style.transform  = neutralXfm;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── Speech-pulse handler ─────────────────────────────────────────────
  useEffect(() => {
    if (!speechRef) return;
    speechRef.current = (level) => {
      if (state !== 'responding') return;
      if (imgRef.current) {
        const a = (0.62 + level * 0.28).toFixed(2);
        imgRef.current.style.filter =
          `drop-shadow(0 0 58px rgba(139,92,246,${a})) drop-shadow(0 0 110px rgba(99,102,241,.55))`;
      }
      const now = Date.now();
      if (now - lastBurst.current > 250) {
        lastBurst.current = now;
        [ring1Ref, ring2Ref, ring3Ref].forEach((ref, i) => {
          if (!ref.current) return;
          const el = ref.current;
          el.style.animation = 'none';
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          el.offsetHeight;
          el.style.animation = i === 0
            ? 'speechBurst  0.55s ease-out forwards'
            : i === 1
            ? 'speechBurst2 0.72s ease-out forwards'
            : 'speechBurst3 0.92s ease-out forwards';
        });
      }
    };
    return () => { if (speechRef.current) speechRef.current = null; };
  }, [state, speechRef]);

  useEffect(() => {
    if (imgRef.current && state !== 'responding') imgRef.current.style.filter = '';
  }, [state]);

  return (
    <>
      <style>{BASE_KEYFRAMES + satKeyframes}</style>

      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0, ...style }}>

        {/* ── GLOW LAYER ────────────────────────────────────────────── */}
        <div style={{
          position: 'absolute',
          inset: -glowExt,
          borderRadius: '50%',
          background: `radial-gradient(circle at 50% 50%, ${s.glowColor} 0%, ${s.glowColor2} 40%, transparent 68%)`,
          filter: `blur(${blurPx}px)`,
          opacity: s.glowOpacity,
          animation: s.glowAnim,
          transition: 'opacity 0.7s ease, background 0.7s ease',
          pointerEvents: 'none',
        }} />

        {/* Listening ripples */}
        {[0, 780].map((delay, i) => (
          <div key={i} style={{
            position: 'absolute', inset: -(size * 0.04), borderRadius: '50%',
            boxShadow: '0 0 0 1.5px rgba(56,189,248,.28)',
            opacity: s.ripple ? 1 : 0,
            transition: 'opacity 0.5s ease',
            animation: 'orbRipple 2s ease-out infinite',
            animationDelay: `${delay}ms`,
            animationPlayState: s.ripple ? 'running' : 'paused',
            pointerEvents: 'none',
          }} />
        ))}

        {/* ── ORBITING SATELLITES ──────────────────────────────────── */}
        {SATS.map((sat, i) => {
          const speed = (sat.baseSpeed / s.satSpeedMul).toFixed(2);
          return (
            <div key={i} style={{
              position: 'absolute',
              top: '50%', left: '50%',
              width: sat.size, height: sat.size,
              animation: `hlnaSat${i} ${speed}s linear infinite`,
              opacity: s.satOpacity,
              transition: 'opacity 0.9s ease',
              pointerEvents: 'none',
              zIndex: 3,
            }}>
              <div style={{
                width: '100%', height: '100%',
                borderRadius: '50%',
                background: `radial-gradient(circle, white 0%, rgba(${sat.glow},.92) 50%, rgba(${sat.glow},0) 100%)`,
                boxShadow: `0 0 ${sat.size * 2}px rgba(${sat.glow},1), 0 0 ${sat.size * 5}px rgba(${sat.glow},.42)`,
              }}>
                <div style={{
                  position: 'absolute', inset: '20%',
                  borderRadius: '50%',
                  background: 'white',
                  animation: `satCore ${(sat.baseSpeed * 0.55).toFixed(1)}s ease-in-out infinite`,
                }} />
              </div>
            </div>
          );
        })}

        {/* Speech burst rings */}
        <div ref={ring1Ref} style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          boxShadow: '0 0 0 2px rgba(139,92,246,.65)',
          opacity: 0, pointerEvents: 'none',
        }} />
        <div ref={ring2Ref} style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          boxShadow: '0 0 0 1.5px rgba(99,102,241,.45)',
          opacity: 0, pointerEvents: 'none',
        }} />
        <div ref={ring3Ref} style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          boxShadow: '0 0 0 1px rgba(167,139,250,.35)',
          opacity: 0, pointerEvents: 'none',
        }} />

        {/* ── ORB IMAGE ─────────────────────────────────────────────── */}
        {/* glanceRef wrapper moves the orb off-centre for the "eye look" */}
        <div
          ref={glanceRef}
          style={{
            position: 'relative', zIndex: 2,
            width: '100%', height: '100%',
            transform: neutralXfm,
            transition: 'transform 0.55s cubic-bezier(.25,.46,.45,.94)',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={ORB_SRC}
            alt=""
            draggable={false}
            style={{
              width: '100%', height: '100%',
              objectFit: 'contain',
              animation: s.coreAnim,
              filter: s.dropShadow,
              transition: 'filter 0.7s ease',
              pointerEvents: 'none',
            }}
          />
        </div>

      </div>
    </>
  );
}
