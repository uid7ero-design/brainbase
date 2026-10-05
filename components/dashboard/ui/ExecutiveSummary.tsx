'use client';

import React from 'react';
import { DASHBOARD_TOKENS as th } from './tokens';

export interface ExecutiveSummaryProps {
  summary:     string;
  /** Accepted for API compatibility; the strip now uses neutral tokens. */
  accentColor: string;
  /** Accepted for API compatibility only — the strip follows the app theme. */
  theme?:      'light' | 'dark';
  loading?:    boolean;
}

// Situation strip (authenticated visual-completion pass): a sunken token band
// with a hairline, no module-hue wash.
export default function ExecutiveSummary({ summary, loading = false }: ExecutiveSummaryProps) {
  const band: React.CSSProperties = {
    padding: '8px 20px',
    background: 'var(--bg-sunken)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };

  if (loading) {
    return (
      <div style={band} aria-busy="true">
        <div style={{ width: '60%', height: 12, background: 'var(--border)', borderRadius: 'var(--radius-sm)' }} />
      </div>
    );
  }

  return (
    <div style={band}>
      <span style={{ fontSize: 11, fontWeight: 600, color: th.t2, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
        <span aria-hidden="true">✦ </span>Situation
      </span>
      <span style={{ fontSize: 12.5, color: th.t1, lineHeight: 1.4 }}>{summary}</span>
    </div>
  );
}
