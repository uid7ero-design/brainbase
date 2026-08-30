'use client';

import { useState } from 'react';
import { HelenaOrbital, STATE_DESCRIPTION, type HelenaVisualState } from '@/components/brand/HelenaOrbital';

// Manual-control design QA showcase only. Deliberately has zero connection
// to production Helena: no chat API, no browser speech recognition, no mic
// capture, no text-to-speech provider, no organisation/session data. State
// and audioLevel are both fully local UI state.

const STATES: HelenaVisualState[] = ['idle', 'listening', 'thinking', 'speaking', 'error'];

const TOKENS = {
  space: '#050812',
  surface: '#0A0F1B',
  border: '#20283C',
  text: '#F4F6FB',
  textMuted: '#98A3B8',
  purple: '#A855F7',
  violet: '#7C5CFF',
  cyan: '#00D4FF',
};

export function HelenaOrbitalShowcase() {
  const [state, setState] = useState<HelenaVisualState>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [forceReducedMotion, setForceReducedMotion] = useState(false);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `radial-gradient(circle at 30% 20%, ${TOKENS.surface} 0%, ${TOKENS.space} 60%)`,
        color: TOKENS.text,
        fontFamily: 'system-ui, sans-serif',
        padding: '32px 20px 80px',
      }}
    >
      <style>{`
        .hlo-force-reduced .hlo-spin-cw,
        .hlo-force-reduced .hlo-spin-ccw,
        .hlo-force-reduced .hlo-core-pulse,
        .hlo-force-reduced .hlo-attention,
        .hlo-force-reduced .hlo-system,
        .hlo-force-reduced .hlo-shudder-active,
        .hlo-force-reduced .hlo-glow-spike-active,
        .hlo-force-reduced .hlo-trace-flicker-active {
          animation: none !important;
        }
        .hlo-force-reduced .hlo-shudder-active {
          translate: none !important;
        }
      `}</style>

      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <header style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, letterSpacing: '.14em', color: TOKENS.textMuted, textTransform: 'uppercase' }}>
            BrainBase — Hybrid Orbit — Dev QA
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '6px 0 4px' }}>HelenaOrbital showcase</h1>
          <p style={{ fontSize: 13, color: TOKENS.textMuted, maxWidth: 620 }}>
            Manual-control visual QA only. Not wired to production Helena, browser speech
            recognition, any text-to-speech provider, or account data. Development-only route.
          </p>
        </header>

        {/* State controls */}
        <section style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, alignItems: 'center' }}>
          {STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setState(s)}
              aria-pressed={state === s}
              style={{
                padding: '8px 16px',
                borderRadius: 999,
                border: `1px solid ${state === s ? TOKENS.violet : TOKENS.border}`,
                background: state === s ? 'rgba(124,92,255,.18)' : 'transparent',
                color: state === s ? TOKENS.text : TOKENS.textMuted,
                fontSize: 13,
                fontWeight: 500,
                textTransform: 'capitalize',
                cursor: 'pointer',
              }}
            >
              {s}
            </button>
          ))}

          {/* Dev-only convenience for reviewing state transitions in sequence. */}
          <button
            type="button"
            onClick={() => setState(STATES[(STATES.indexOf(state) + 1) % STATES.length])}
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: `1px dashed ${TOKENS.border}`,
              background: 'transparent',
              color: TOKENS.textMuted,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cycle states →
          </button>
        </section>

        <p style={{ fontSize: 12.5, color: TOKENS.textMuted, maxWidth: 620, marginBottom: 24, minHeight: 18 }}>
          {STATE_DESCRIPTION[state]}
        </p>

        {/* Audio level + reduced-motion controls */}
        <section
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 28,
            alignItems: 'center',
            marginBottom: 40,
            padding: '16px 18px',
            border: `1px solid ${TOKENS.border}`,
            borderRadius: 12,
            background: 'rgba(255,255,255,.02)',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: TOKENS.textMuted, minWidth: 240 }}>
            audioLevel — {audioLevel.toFixed(2)} (drives core/glow in &quot;speaking&quot;)
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={audioLevel}
              onChange={(e) => setAudioLevel(Number(e.target.value))}
            />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: TOKENS.textMuted }}>
            <input
              type="checkbox"
              checked={forceReducedMotion}
              onChange={(e) => setForceReducedMotion(e.target.checked)}
            />
            Preview prefers-reduced-motion: reduce
          </label>

          <div style={{ fontSize: 12, color: TOKENS.textMuted }}>
            Selected state: <strong style={{ color: TOKENS.text }}>{state}</strong>
          </div>
        </section>

        {/* Size previews */}
        <section className={forceReducedMotion ? 'hlo-force-reduced' : undefined} style={{ display: 'flex', flexWrap: 'wrap', gap: 48, alignItems: 'flex-end' }}>
          <PreviewCell label="Large — 220px (showcase)" size={220}>
            <HelenaOrbital state={state} audioLevel={audioLevel} size={220} />
          </PreviewCell>
          <PreviewCell label="Medium — 96px (dashboard)" size={96}>
            <HelenaOrbital state={state} audioLevel={audioLevel} size={96} />
          </PreviewCell>
          <PreviewCell label="Compact — 32px (sidebar)" size={32}>
            <HelenaOrbital state={state} audioLevel={audioLevel} size={32} />
          </PreviewCell>
        </section>
      </div>
    </div>
  );
}

function PreviewCell({ label, size, children }: { label: string; size: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: Math.max(size + 80, 160),
          height: Math.max(size + 80, 160),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 16,
          border: '1px solid #20283C',
          background: 'radial-gradient(circle at 50% 40%, #0A0F1B 0%, #050812 75%)',
        }}
      >
        {children}
      </div>
      <span style={{ fontSize: 12, color: '#98A3B8' }}>{label}</span>
    </div>
  );
}
