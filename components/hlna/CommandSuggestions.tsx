'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/state/useAppStore';
import { getDeptConfig } from '@/lib/hlna/departmentConfigs';
import { HLNA_MODULES } from '@/lib/hlna/modules';

const FONT = "var(--font-inter), -apple-system, sans-serif";

const MAX_PANEL = 4;

interface Props {
  panelMode?: boolean;
}

export function CommandSuggestions({ panelMode = false }: Props) {
  const { activeModule, fireHelena, setChatOpen, activeDepartment } = useAppStore();
  const [active, setActive] = useState<number | null>(null);

  const mod = activeModule ? HLNA_MODULES[activeModule] : null;

  const chips: { icon: string; label: string; command: string }[] =
    (mod && mod.key !== 'waste_recycling')
      ? mod.questions.slice(0, 6).map((q: string) => ({ icon: '→', label: q, command: q }))
      : getDeptConfig(activeDepartment).commands;

  const visible = panelMode ? chips.slice(0, MAX_PANEL) : chips.slice(0, 6);
  const overflow = panelMode ? Math.max(0, chips.length - MAX_PANEL) : 0;

  function send(i: number, command: string) {
    setActive(i);
    fireHelena(command);
    setChatOpen(true);
    setTimeout(() => setActive(null), 2000);
  }

  return (
    <div style={{ fontFamily: FONT, width: '100%' }}>
      {!panelMode && (
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.12em', color: 'rgba(255,255,255,.25)', textTransform: 'uppercase', marginBottom: 9, textAlign: 'center' }}>
          Command Suggestions
        </div>
      )}
      <div style={{
        display: 'flex', flexWrap: 'wrap',
        gap: panelMode ? 5 : 7,
        justifyContent: panelMode ? 'flex-start' : 'center',
      }}>
        {visible.map((chip, i) => {
          const isActive = active === i;
          return (
            <button
              key={i}
              onClick={() => send(i, chip.command)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: panelMode ? '5px 10px' : '6px 14px',
                borderRadius: 20,
                fontSize: panelMode ? 10 : 11,
                fontWeight: 600,
                background: isActive ? 'rgba(124,58,237,.18)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${isActive ? 'rgba(124,58,237,.45)' : 'rgba(255,255,255,.09)'}`,
                color: isActive ? '#C4B5FD' : 'rgba(230,237,243,.60)',
                cursor: 'pointer', fontFamily: FONT,
                transition: 'all .18s', letterSpacing: '-0.01em',
                boxShadow: isActive ? '0 0 12px rgba(124,58,237,.22)' : 'none',
              }}
              onMouseEnter={e => {
                if (isActive) return;
                e.currentTarget.style.background = 'rgba(124,58,237,.14)';
                e.currentTarget.style.borderColor = 'rgba(124,58,237,.38)';
                e.currentTarget.style.color = '#C4B5FD';
                e.currentTarget.style.boxShadow = '0 0 12px rgba(124,58,237,.16)';
              }}
              onMouseLeave={e => {
                if (isActive) return;
                e.currentTarget.style.background = 'rgba(255,255,255,.04)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)';
                e.currentTarget.style.color = 'rgba(230,237,243,.60)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span style={{ fontSize: panelMode ? 10 : 12 }}>{chip.icon}</span>
              <span>{chip.label}</span>
            </button>
          );
        })}

        {overflow > 0 && (
          <span style={{
            display: 'flex', alignItems: 'center',
            padding: '5px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
            background: 'rgba(255,255,255,.03)',
            border: '1px solid rgba(255,255,255,.07)',
            color: 'rgba(255,255,255,.28)',
            letterSpacing: '.02em',
            userSelect: 'none',
          }}>
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}
