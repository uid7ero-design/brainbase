'use client';

import React from 'react';
import { Badge, type SemanticState } from '@/components/ui/app';
import { DASHBOARD_TOKENS as th, PRIORITY_COLORS } from './tokens';

export interface InsightCardProps {
  severity:       'High' | 'Medium' | 'Low';
  problem:        string;
  cause?:         string;
  recommendation: string;
  impact?:        string;
  /** Accepted for API compatibility only — the card follows the app theme. */
  theme?:         'light' | 'dark';
  /** Accepted for API compatibility; the recommendation now uses the text token. */
  accentColor?:   string;
  loading?:       boolean;
}

export const SEVERITY_STATE: Record<'High' | 'Medium' | 'Low', SemanticState> = {
  High: 'error',
  Medium: 'warning',
  Low: 'success',
};

// Flat insight card (authenticated visual-completion pass): token surface,
// severity carried by a left rule (hue) AND a written semantic Badge, so the
// meaning never depends on colour alone. No gradient, glow or hover lift.
export default function InsightCard({
  severity, problem, cause, recommendation, impact,
  loading = false,
}: InsightCardProps) {
  const sevCol = PRIORITY_COLORS[severity];

  const frame: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderLeft: `3px solid ${loading ? 'var(--border)' : sevCol}`,
    borderRadius: 'var(--radius-lg)',
    padding: '11px 13px',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  };

  if (loading) {
    return (
      <div style={frame} aria-busy="true">
        <div style={{ width: 40, height: 10, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)', marginBottom: 4 }} />
        <div style={{ width: '85%', height: 10, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)', marginBottom: 4 }} />
        <div style={{ width: '65%', height: 10, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)' }} />
      </div>
    );
  }

  return (
    <div style={frame}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <Badge state={SEVERITY_STATE[severity]}>{severity}</Badge>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: th.t1, lineHeight: 1.3 }}>{problem}</span>
      </div>

      {cause && (
        <div style={{ fontSize: 12, color: th.t2, lineHeight: 1.45 }}>
          <span style={{ fontWeight: 600, color: th.t3, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>Why · </span>
          {cause}
        </div>
      )}

      <div style={{ fontSize: 12, color: th.t1, lineHeight: 1.45, fontWeight: 600 }}>
        <span aria-hidden="true" style={{ color: th.t3 }}>→ </span>{recommendation}
      </div>

      {impact && (
        <div style={{ fontSize: 11, color: th.t3, lineHeight: 1.3 }}>{impact}</div>
      )}
    </div>
  );
}
