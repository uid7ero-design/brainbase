'use client';

import React from 'react';
import { getTheme, PRIORITY_COLORS } from './tokens';

export interface InsightCardProps {
  severity:       'High' | 'Medium' | 'Low';
  problem:        string;
  cause?:         string;
  recommendation: string;
  impact?:        string;
  theme?:         'light' | 'dark';
  accentColor?:   string;
  loading?:       boolean;
}

export default function InsightCard({
  severity, problem, cause, recommendation, impact,
  theme = 'dark', accentColor, loading = false,
}: InsightCardProps) {
  const th     = getTheme(theme);
  const L      = theme === 'light';
  const sevCol = PRIORITY_COLORS[severity];

  const shadow    = L
    ? `0 1px 2px rgba(0,0,0,0.05), 0 4px 14px ${sevCol}18, 0 0 0 1px ${sevCol}15`
    : `0 2px 10px rgba(0,0,0,0.3), 0 4px 16px ${sevCol}20`;
  const shadowHov = L
    ? `0 2px 4px rgba(0,0,0,0.07), 0 8px 24px ${sevCol}25, 0 0 0 1px ${sevCol}20`
    : `0 4px 20px rgba(0,0,0,0.4), 0 6px 24px ${sevCol}30`;

  if (loading) {
    return (
      <div style={{ background: L ? '#fff' : th.card.background as string, border: `1.5px solid ${th.bdr}`, borderLeft: `4px solid ${th.bdr}`, borderRadius: '0 10px 10px 0', padding: '12px 14px' }}>
        <div style={{ width: 40, height: 10, background: th.bdr, borderRadius: 20, marginBottom: 8 }} />
        <div style={{ width: '85%', height: 10, background: th.bdr, borderRadius: 4, marginBottom: 4 }} />
        <div style={{ width: '65%', height: 10, background: th.bdr, borderRadius: 4 }} />
      </div>
    );
  }

  return (
    <div
      style={{
        background: L
          ? `linear-gradient(135deg, ${sevCol}06 0%, #ffffff 60%)`
          : `linear-gradient(135deg, ${sevCol}10 0%, rgba(255,255,255,0.04) 70%)`,
        border: `1.5px solid ${L ? sevCol + '30' : sevCol + '25'}`,
        borderLeft: `4px solid ${sevCol}`,
        borderRadius: '0 10px 10px 0',
        padding: '11px 13px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: sevCol, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>
          {severity}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: th.t1, lineHeight: 1.3 }}>{problem}</span>
      </div>

      {cause && (
        <div style={{ fontSize: 11, color: th.t2, lineHeight: 1.45, paddingLeft: 2 }}>
          <span style={{ fontWeight: 700, color: th.t3, textTransform: 'uppercase', fontSize: 9, letterSpacing: '0.06em' }}>Why · </span>
          {cause}
        </div>
      )}

      <div style={{ fontSize: 11, color: accentColor ?? sevCol, lineHeight: 1.45, fontWeight: 600, paddingLeft: 2, marginTop: 1 }}>
        <span style={{ fontWeight: 700 }}>→ </span>{recommendation}
      </div>

      {impact && (
        <div style={{ fontSize: 10.5, color: th.t3, fontStyle: 'italic', lineHeight: 1.3, paddingLeft: 2 }}>{impact}</div>
      )}
    </div>
  );
}
