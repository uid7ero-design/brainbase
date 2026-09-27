'use client';

import React from 'react';
import { Badge, buttonProps } from '@/components/ui/app';
import { DASHBOARD_TOKENS as th, PRIORITY_COLORS } from './tokens';
import { SEVERITY_STATE } from './InsightCard';

export interface OpportunityCardProps {
  index:        number;
  priority:     'High' | 'Medium' | 'Low';
  title:        string;
  explanation?: string;
  impact:       string;
  /** Accepted for API compatibility; impact text now uses the text token. */
  accentColor:  string;
  /** Accepted for API compatibility only — the card follows the app theme. */
  theme?:       'light' | 'dark';
  loading?:     boolean;
  onAssign?:    () => void;
}

// Flat opportunity card (authenticated visual-completion pass): priority is
// a left rule plus a written Badge; the Assign action is a standard ghost
// button with the same handler.
export default function OpportunityCard({
  index, priority, title, explanation, impact,
  loading = false, onAssign,
}: OpportunityCardProps) {
  const pc = PRIORITY_COLORS[priority];

  const frame: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderLeft: `3px solid ${loading ? 'var(--border)' : pc}`,
    borderRadius: 'var(--radius-lg)',
    padding: '11px 13px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };

  if (loading) {
    return (
      <div style={frame} aria-busy="true">
        {['40px', '90%', '70%', '60px'].map((w, i) => (
          <div key={i} style={{ width: w, height: 10, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)' }} />
        ))}
      </div>
    );
  }

  return (
    <div style={frame}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Badge state={SEVERITY_STATE[priority]}>{priority}</Badge>
        <span style={{ fontSize: 11, color: th.t3, fontWeight: 600, fontFamily: 'var(--bb-font-mono)' }}>#{String(index + 1).padStart(2, '0')}</span>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, color: th.t1 }}>{title}</div>

      {explanation && (
        <div style={{ fontSize: 12, color: th.t2, lineHeight: 1.4 }}>{explanation}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 'auto', paddingTop: 6, borderTop: `1px solid ${th.bdr}` }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: th.t3, fontWeight: 600, flexShrink: 0 }}>Impact</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: th.t1, lineHeight: 1.2 }}>{impact}</span>
      </div>

      <button type="button" onClick={onAssign} {...buttonProps('ghost', 'sm')} style={{ alignSelf: 'flex-start' }}>
        Assign →
      </button>
    </div>
  );
}
