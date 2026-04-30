'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/state/useAppStore';
import { getDeptConfig } from '@/lib/hlna/departmentConfigs';
import { type WasteAction, type Impact } from '@/lib/hlna/wasteIntelligence';

const FONT = "var(--font-inter), -apple-system, sans-serif";

const IMPACT_COLOR: Record<Impact, string> = { high: '#FB7185', medium: '#FBBF24', low: '#34D399' };
const IMPACT_BG:    Record<Impact, string> = { high: 'rgba(251,113,133,.08)', medium: 'rgba(251,191,36,.07)', low: 'rgba(52,211,153,.07)' };
const IMPACT_BORDER:Record<Impact, string> = { high: 'rgba(251,113,133,.22)', medium: 'rgba(251,191,36,.20)', low: 'rgba(52,211,153,.18)' };

const URG_COLOR: Record<Impact, string> = { high: '#FB7185', medium: '#FBBF24', low: '#34D399' };
const URG_BG:    Record<Impact, string> = { high: 'rgba(251,113,133,.06)', medium: 'rgba(251,191,36,.06)', low: 'rgba(52,211,153,.06)' };
const URG_BORDER:Record<Impact, string> = { high: 'rgba(251,113,133,.18)', medium: 'rgba(251,191,36,.16)', low: 'rgba(52,211,153,.15)' };

function Badge({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) {
  return (
    <span style={{
      fontSize: 8, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 4, background: bg, color, border: `1px solid ${border}`,
    }}>
      {label}
    </span>
  );
}

function ActionCard({ action, selected, onSelect }: { action: WasteAction; selected: boolean; onSelect: () => void }) {
  const [hover, setHover] = useState(false);
  const active = selected || hover;

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '14px 16px',
        borderRadius: 11,
        background: active
          ? 'rgba(124,58,237,.10)'
          : 'rgba(255,255,255,.025)',
        border: `1px solid ${active
          ? 'rgba(124,58,237,.38)'
          : 'rgba(255,255,255,.07)'}`,
        cursor: 'pointer',
        transition: 'all .18s',
        boxShadow: selected ? '0 0 20px rgba(124,58,237,.12)' : 'none',
        display: 'flex', flexDirection: 'column', gap: 8,
        fontFamily: FONT,
      }}
    >
      {/* Title + badges row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: active ? '#E2D9F3' : '#D4D4D8', lineHeight: 1.35, flex: 1 }}>
          {action.title}
        </span>
      </div>

      {/* Description */}
      <p style={{ margin: 0, fontSize: 11, color: 'rgba(161,161,170,.75)', lineHeight: 1.5 }}>
        {action.description}
      </p>

      {/* Badges + CTA */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <Badge
          label={`↑ ${action.impact} impact`}
          color={IMPACT_COLOR[action.impact]}
          bg={IMPACT_BG[action.impact]}
          border={IMPACT_BORDER[action.impact]}
        />
        <Badge
          label={`⚡ ${action.urgency} urgency`}
          color={URG_COLOR[action.urgency]}
          bg={URG_BG[action.urgency]}
          border={URG_BORDER[action.urgency]}
        />
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
          color: active ? '#C4B5FD' : 'rgba(167,139,250,.55)',
          transition: 'color .18s',
        }}>
          {action.cta} →
        </span>
      </div>
    </div>
  );
}

export function RecommendedActions() {
  const [selected, setSelected] = useState<string | null>(null);
  const { fireHelena, setChatOpen, activeDepartment } = useAppStore();
  const actions = getDeptConfig(activeDepartment).actions;

  function handleSelect(action: WasteAction) {
    setSelected(action.id);
    fireHelena(action.command);
    setChatOpen(true);
  }

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.06)' }} />
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.14em', color: 'rgba(255,255,255,.30)', textTransform: 'uppercase' }}>
          Recommended Actions
        </span>
        <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.06)' }} />
      </div>

      {/* 2-column grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 8,
      }}>
        {actions.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            selected={selected === action.id}
            onSelect={() => handleSelect(action)}
          />
        ))}
      </div>
    </div>
  );
}
