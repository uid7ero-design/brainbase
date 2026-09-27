'use client';

import React from 'react';
import { DASHBOARD_TOKENS as th, TONE, TYPOGRAPHY } from './tokens';

export interface KpiCardProps {
  label:       string;
  value:       string | number;
  icon?:       string;
  sub?:        string;
  trend?:      'up' | 'down' | 'flat';
  trendLabel?: string;
  status?:     'risk' | 'watch' | 'normal';
  alert?:      boolean;
  accentColor: string;
  /**
   * Accepted for API compatibility only. The card follows the app theme
   * (<html data-theme>) through tokens; this prop no longer forces a palette.
   */
  theme?:      'light' | 'dark';
  loading?:    boolean;
  minWidth?:   number;
}

// Flat metric card (authenticated visual-completion pass): token surface,
// hairline border, the module accent kept only as a thin top rule (identity,
// never text). A risk/watch status colours the value with the semantic
// status token (AA as text in both themes) and is also written out for
// assistive tech, so meaning never depends on colour alone.
export default function KpiCard({
  label, value, icon, sub, trend, trendLabel,
  status, alert, accentColor,
  loading = false,
  minWidth = 138,
}: KpiCardProps) {
  const tone = alert || status === 'risk' ? TONE.danger : status === 'watch' ? TONE.warning : null;
  const stateLabel = alert || status === 'risk' ? 'At risk' : status === 'watch' ? 'Watch' : null;

  const trendArrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  const trendColor = trend === 'up' ? TONE.success.fg : trend === 'down' ? TONE.danger.fg : th.t3;
  const trendWord  = trend === 'up' ? 'Up' : trend === 'down' ? 'Down' : 'Flat';

  const frame: React.CSSProperties = {
    minWidth,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderTop: `2px solid ${tone ? tone.fg : accentColor}`,
    borderRadius: 'var(--radius-lg)',
    padding: '10px 14px',
    flexShrink: 0,
  };

  if (loading) {
    return (
      <div style={frame} aria-busy="true">
        <div style={{ ...TYPOGRAPHY.label, color: th.t3, marginBottom: 6 }}>{label}</div>
        <div aria-hidden="true" style={{ width: 80, height: 18, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)', marginBottom: 4 }} />
        <div aria-hidden="true" style={{ width: 50, height: 7, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)' }} />
      </div>
    );
  }

  return (
    <div style={frame}>
      {/* label row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        {icon && <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>}
        <span style={{ ...TYPOGRAPHY.label, color: th.t3 }}>{label}</span>
      </div>

      {/* value */}
      <div style={{ ...TYPOGRAPHY.kpiVal, color: tone ? tone.fg : th.t1 }}>
        {value}
        {stateLabel && <span className="sr-only"> ({stateLabel})</span>}
      </div>

      {/* sub */}
      {sub && <div style={{ fontSize: 11, color: th.t2, marginTop: 4, lineHeight: 1.3 }}>{sub}</div>}

      {/* trend */}
      {trend && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 5, paddingTop: 5, borderTop: `1px solid ${th.bdr}` }}>
          <span aria-hidden="true" style={{ fontSize: 11, color: trendColor, fontWeight: 700 }}>{trendArrow}</span>
          <span className="sr-only">{trendWord}</span>
          {trendLabel && <span style={{ fontSize: 11, color: th.t3 }}>{trendLabel}</span>}
        </div>
      )}
    </div>
  );
}
