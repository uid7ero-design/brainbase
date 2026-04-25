'use client';

import { useState } from 'react';
import { HlnaOrb } from './HlnaOrb';

export function HlnaAssistant({ state = 'idle', onClick }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      aria-label="Ask HLNΛ"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 16px 8px 8px',
        borderRadius: 999,
        background: hovered ? '#2D1B69' : '#1E1040',
        border: '1px solid rgba(124,58,237,.50)',
        backdropFilter: 'blur(12px)',
        cursor: 'pointer',
        transform: hovered ? 'scale(1.04)' : 'scale(1)',
        transition: 'transform .18s cubic-bezier(.34,1.56,.64,1), background .18s, box-shadow .18s',
        boxShadow: hovered
          ? '0 4px 24px rgba(124,58,237,.45)'
          : '0 2px 12px rgba(124,58,237,.25)',
      }}
    >
      <HlnaOrb size={32} state={state} />
      <span style={{
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '.04em',
        color: '#F5F7FA',
        fontFamily: 'var(--font-inter), "Inter", -apple-system, sans-serif',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}>
        Ask HLN<span style={{ color: '#A78BFA' }}>Λ</span>
      </span>
    </button>
  );
}
