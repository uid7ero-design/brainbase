'use client';

import React from 'react';
import { getTheme } from './tokens';

export interface ExecutiveSummaryProps {
  summary:     string;
  accentColor: string;
  theme?:      'light' | 'dark';
  loading?:    boolean;
}

export default function ExecutiveSummary({ summary, accentColor, theme = 'dark', loading = false }: ExecutiveSummaryProps) {
  const th = getTheme(theme);
  const L  = theme === 'light';

  if (loading) {
    return (
      <div style={{ padding: '8px 24px', background: L ? `${accentColor}08` : `${accentColor}0a`, borderBottom: `1px solid ${accentColor}20` }}>
        <div style={{ width: '60%', height: 12, background: `${accentColor}20`, borderRadius: 4 }} />
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 24px', background: L ? `${accentColor}08` : `${accentColor}0a`, borderBottom: `1px solid ${accentColor}20`, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>✦ Situation</span>
      <span style={{ fontSize: 12.5, color: th.t1, lineHeight: 1.4 }}>{summary}</span>
    </div>
  );
}
