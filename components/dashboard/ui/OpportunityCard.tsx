'use client';

import React from 'react';
import { getTheme, PRIORITY_COLORS } from './tokens';

export interface OpportunityCardProps {
  index:        number;
  priority:     'High' | 'Medium' | 'Low';
  title:        string;
  explanation?: string;
  impact:       string;
  accentColor:  string;
  theme?:       'light' | 'dark';
  loading?:     boolean;
  onAssign?:    () => void;
}

export default function OpportunityCard({
  index, priority, title, explanation, impact, accentColor,
  theme = 'dark', loading = false, onAssign,
}: OpportunityCardProps) {
  const th        = getTheme(theme);
  const L         = theme === 'light';
  const pc        = PRIORITY_COLORS[priority];

  const shadow    = L
    ? `0 1px 2px rgba(0,0,0,0.05), 0 4px 14px ${pc}15, 0 0 0 1px ${pc}12`
    : `0 2px 10px rgba(0,0,0,0.3), 0 4px 16px ${pc}18`;
  const shadowHov = L
    ? `0 2px 4px rgba(0,0,0,0.07), 0 8px 24px ${pc}22, 0 0 0 1px ${pc}18`
    : `0 4px 20px rgba(0,0,0,0.4), 0 6px 24px ${pc}28`;

  if (loading) {
    return (
      <div style={{ background: L ? '#fff' : th.card.background as string, border: `1.5px solid ${th.bdr}`, borderLeft: `4px solid ${th.bdr}`, borderRadius: '0 10px 10px 0', padding: '12px 14px' }}>
        <div style={{ width: 40, height: 10, background: th.bdr, borderRadius: 20, marginBottom: 8 }} />
        <div style={{ width: '90%', height: 10, background: th.bdr, borderRadius: 4, marginBottom: 4 }} />
        <div style={{ width: '70%', height: 10, background: th.bdr, borderRadius: 4, marginBottom: 8 }} />
        <div style={{ width: 60, height: 10, background: th.bdr, borderRadius: 4 }} />
      </div>
    );
  }

  return (
    <div
      style={{
        background: L
          ? `linear-gradient(135deg, ${pc}07 0%, #ffffff 55%)`
          : `linear-gradient(135deg, ${pc}12 0%, rgba(255,255,255,0.04) 70%)`,
        border: `1.5px solid ${L ? pc + '28' : pc + '22'}`,
        borderLeft: `4px solid ${pc}`,
        borderRadius: '0 10px 10px 0',
        padding: '11px 13px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: shadow,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = shadowHov;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'none';
        (e.currentTarget as HTMLDivElement).style.boxShadow = shadow;
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: pc, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {priority}
        </span>
        <span style={{ fontSize: 10, color: th.t3, fontWeight: 700, letterSpacing: '0.03em' }}>#{String(index + 1).padStart(2, '0')}</span>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.35, color: th.t1 }}>{title}</div>

      {explanation && (
        <div style={{ fontSize: 11, color: th.t2, lineHeight: 1.4 }}>{explanation}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 'auto', paddingTop: 6, borderTop: `1px solid ${L ? pc + '20' : 'rgba(255,255,255,0.06)'}` }}>
        <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: th.t3, fontWeight: 700, flexShrink: 0 }}>Impact</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: accentColor, lineHeight: 1.2, letterSpacing: '-0.01em' }}>{impact}</span>
      </div>

      <button
        onClick={onAssign}
        style={{
          padding: '5px 12px',
          borderRadius: 7,
          fontSize: 11,
          cursor: 'pointer',
          background: `${accentColor}12`,
          border: `1.5px solid ${accentColor}50`,
          color: accentColor,
          fontWeight: 700,
          alignSelf: 'flex-start',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = `${accentColor}22`)}
        onMouseLeave={e => (e.currentTarget.style.background = `${accentColor}12`)}
      >
        Assign →
      </button>
    </div>
  );
}
