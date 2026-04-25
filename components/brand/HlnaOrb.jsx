'use client';

import { useRef, useEffect } from 'react';

const KEYFRAMES = `
  /* Idle — slow breathing: 1 → 1.03 → 1, slight opacity drift */
  @keyframes orbBreath {
    0%, 100% { transform: scale(1);    opacity: 1;   }
    50%       { transform: scale(1.03); opacity: .95; }
  }

  /* Listening — reduced breathing (attention is on the ring/ripple) */
  @keyframes orbListenBreath {
    0%, 100% { transform: scale(1);     opacity: 1;   }
    50%       { transform: scale(1.015); opacity: .97; }
  }

  /* Thinking — irregular, uneven internal movement */
  @keyframes orbThink {
    0%, 100% { transform: scale(1);     opacity: 1;   }
    33%       { transform: scale(1.016); opacity: .93; }
    66%       { transform: scale(1.006); opacity: .97; }
  }

  /* Responding — rhythmic two-beat pulse */
  @keyframes orbPulse {
    0%   { transform: scale(1);     }
    30%  { transform: scale(1.042); }
    60%  { transform: scale(1.016); }
    100% { transform: scale(1);     }
  }

  /* Ring orbit */
  @keyframes orbRing {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  /* Listening ripple — expands outward from orb edge */
  @keyframes orbRipple {
    0%   { transform: scale(1);    opacity: .38; }
    100% { transform: scale(1.62); opacity: 0;   }
  }

  /* Thinking inner pulse overlay */
  @keyframes orbThinkPulse {
    0%, 100% { opacity: .22; }
    50%       { opacity: .60; }
  }

  /* Internal gradient drift — creates subtle gradient movement */
  @keyframes orbGradDrift {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  /* Satellite alive pulse — subtle scale breathe */
  @keyframes orbSatPulse {
    0%, 100% { transform: translateX(-50%) scale(1);    opacity: 1;   }
    50%       { transform: translateX(-50%) scale(1.20); opacity: .65; }
  }
`;

/* Per-state config ─────────────────────────────────────────────────────── */
const STATE = {
  idle: {
    coreAnim:     'orbBreath 5.2s ease-in-out infinite',
    baseShadow:   '0 0 20px 6px rgba(139,92,246,.16), 0 2px 10px rgba(0,0,0,.45)',
    ringSpeed:    '28s',     // very slow — barely noticeable
    ringOpacity:  0.52,
    ripple:       false,
    thinking:     false,
    driftSpeed:   '18s',
    driftOpacity: 0.50,
  },
  listening: {
    coreAnim:     'orbListenBreath 3.0s ease-in-out infinite',
    baseShadow:   '0 0 26px 8px rgba(56,189,248,.20), 0 0 10px 2px rgba(139,92,246,.14), 0 2px 10px rgba(0,0,0,.45)',
    ringSpeed:    '16s',     // moderate — attention-drawing but not frantic
    ringOpacity:  0.88,
    ripple:       true,
    thinking:     false,
    driftSpeed:   '10s',
    driftOpacity: 0.40,
  },
  thinking: {
    coreAnim:     'orbThink 2.4s ease-in-out infinite',
    baseShadow:   '0 0 22px 6px rgba(139,92,246,.20), 0 0 8px 2px rgba(236,72,153,.12), 0 2px 10px rgba(0,0,0,.45)',
    ringSpeed:    '12s',     // "slowly" as specified — distinct from listening
    ringOpacity:  0.80,
    ripple:       false,
    thinking:     true,
    driftSpeed:   '5s',      // "shifts more dynamically"
    driftOpacity: 0.80,
  },
  responding: {
    coreAnim:     'orbPulse 1.2s ease-in-out infinite',
    baseShadow:   '0 0 28px 10px rgba(139,92,246,.24), 0 0 12px 3px rgba(56,189,248,.16), 0 2px 10px rgba(0,0,0,.45)',
    ringSpeed:    '10s',
    ringOpacity:  0.90,
    ripple:       false,
    thinking:     false,
    driftSpeed:   '8s',
    driftOpacity: 0.55,
  },
};

export function HlnaOrb({ size = 80, state = 'idle', speechRef, style }) {
  const s        = STATE[state] ?? STATE.idle;
  const coreRef  = useRef(null);
  const ringSize = Math.round(size * 1.30);
  const offset   = Math.round((ringSize - size) / 2);
  const satSize  = Math.max(5, Math.round(size * 0.10));
  const gradId   = `hlnaRingGrad-${size}`;

  // ── Speech amplitude → live shadow intensity on core ──────────────────
  useEffect(() => {
    if (!speechRef) return;
    speechRef.current = (level) => {
      if (!coreRef.current || state !== 'responding') return;
      const boost = level * 12;
      const alpha = (0.24 + level * 0.10).toFixed(2);
      coreRef.current.style.boxShadow =
        `0 0 ${28 + boost}px ${10 + level * 4}px rgba(139,92,246,${alpha}), 0 2px 10px rgba(0,0,0,.45)`;
    };
    return () => { if (speechRef.current) speechRef.current = null; };
  }, [state, speechRef]);

  // Reset box-shadow when leaving responding state
  useEffect(() => {
    if (coreRef.current && state !== 'responding') {
      coreRef.current.style.boxShadow = '';
    }
  }, [state]);

  return (
    <>
      <style>{KEYFRAMES}</style>

      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0, ...style }}>

        {/* ── Listening ripples — two offset rings expanding outward ─── */}
        {[0, 850].map((delay, i) => (
          <div key={i} style={{
            position: 'absolute', inset: 0,
            borderRadius: '50%',
            border: '1px solid rgba(56,189,248,.35)',
            opacity: s.ripple ? 1 : 0,
            transition: 'opacity 0.5s ease-in-out',
            animation: 'orbRipple 1.8s ease-out infinite',
            animationDelay: `${delay}ms`,
            animationPlayState: s.ripple ? 'running' : 'paused',
            pointerEvents: 'none',
            zIndex: 0,
          }} />
        ))}

        {/* ── Rotating ring + satellite ─────────────────────────────── */}
        <div style={{
          position: 'absolute',
          top: -offset, left: -offset,
          width: ringSize, height: ringSize,
          animation: `orbRing ${s.ringSpeed} linear infinite`,
          pointerEvents: 'none',
          opacity: s.ringOpacity,
          transition: 'opacity 0.6s ease-in-out',
        }}>
          <svg
            width={ringSize} height={ringSize}
            viewBox={`0 0 ${ringSize} ${ringSize}`}
            fill="none"
            style={{ position: 'absolute', inset: 0 }}
          >
            <defs>
              <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#38BDF8" />
                <stop offset="50%"  stopColor="#8B5CF6" />
                <stop offset="100%" stopColor="#EC4899" />
              </linearGradient>
            </defs>
            <circle
              cx={ringSize / 2} cy={ringSize / 2}
              r={ringSize / 2 - 1}
              stroke={`url(#${gradId})`}
              strokeWidth="1.8"
              strokeDasharray={`${Math.round(Math.PI * ringSize * 0.75)} ${Math.round(Math.PI * ringSize * 0.25)}`}
              strokeLinecap="round"
            />
          </svg>

          {/* Satellite node */}
          <div style={{
            position: 'absolute',
            top: -Math.round(satSize / 2), left: '50%',
            width: satSize, height: satSize,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #38BDF8, #8B5CF6)',
            boxShadow: '0 0 4px 1px rgba(56,189,248,.45)',
            animation: `orbSatPulse ${s.ringSpeed} ease-in-out infinite`,
          }} />
        </div>

        {/* ── Core sphere ───────────────────────────────────────────── */}
        <div
          ref={coreRef}
          style={{
            position: 'relative', zIndex: 1,
            width: size, height: size,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 32% 32%, #38BDF8 0%, #8B5CF6 52%, #EC4899 100%)',
            boxShadow: s.baseShadow,
            animation: s.coreAnim,
            overflow: 'hidden',
            transition: 'box-shadow 0.5s ease-in-out',
          }}
        >
          {/* Gradient drift — slow conic rotation creates internal movement */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'conic-gradient(from 0deg at 50% 50%, transparent 0%, rgba(56,189,248,.10) 25%, transparent 50%, rgba(139,92,246,.10) 75%, transparent 100%)',
            animation: `orbGradDrift ${s.driftSpeed} linear infinite`,
            opacity: s.driftOpacity,
            transition: 'opacity 0.5s ease-in-out',
            pointerEvents: 'none',
          }} />

          {/* Thinking overlay — slow internal pulse, visible only in thinking */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(circle at 50% 50%, rgba(139,92,246,.28) 0%, transparent 65%)',
            opacity: s.thinking ? 1 : 0,
            transition: 'opacity 0.5s ease-in-out',
            animation: s.thinking ? 'orbThinkPulse 2.4s ease-in-out infinite' : 'none',
            pointerEvents: 'none',
          }} />

          {/* Inner shadow — bottom-right depth */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(circle at 70% 72%, rgba(0,0,0,.44) 0%, transparent 60%)',
            pointerEvents: 'none',
          }} />

          {/* Primary specular — top-left soft catch */}
          <div style={{
            position: 'absolute',
            top: '9%', left: '11%',
            width: '36%', height: '24%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(255,255,255,.58) 0%, rgba(255,255,255,.14) 50%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          {/* Secondary specular — sharp bright point */}
          <div style={{
            position: 'absolute',
            top: '13%', left: '16%',
            width: '15%', height: '11%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(255,255,255,.82) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
        </div>

      </div>
    </>
  );
}
