'use client';

import React from 'react';
import { getTheme, statusColor, TYPOGRAPHY } from './tokens';

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
  theme?:      'light' | 'dark';
  loading?:    boolean;
  minWidth?:   number;
}

export default function KpiCard({
  label, value, icon, sub, trend, trendLabel,
  status, alert, accentColor,
  theme = 'dark', loading = false,
  minWidth = 138,
}: KpiCardProps) {
  const th = getTheme(theme);
  const L  = theme === 'light';
  const sc = statusColor(status, alert, accentColor);

  const trendArrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  const trendColor = trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : th.t3;

  const shadow   = L
    ? `0 1px 2px rgba(0,0,0,0.04), 0 4px 14px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.04)`
    : `0 2px 8px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.2)`;
  const shadowHov = L
    ? `0 2px 4px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.05)`
    : `0 4px 16px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.3)`;

  if (loading) {
    return (
      <div style={{ minWidth, background: L ? '#fff' : th.sub, border: `1.5px solid ${th.bdr}`, borderRadius: 10, padding: '10px 14px', flexShrink: 0, boxShadow: shadow }}>
        <div style={{ width: 60, height: 7, background: th.bdr, borderRadius: 4, marginBottom: 8 }} />
        <div style={{ width: 80, height: 18, background: th.bdr, borderRadius: 4, marginBottom: 4 }} />
        <div style={{ width: 50, height: 7, background: th.bdr, borderRadius: 4 }} />
      </div>
    );
  }

  return (
    <div
      style={{
        minWidth,
        background: L ? '#ffffff' : `linear-gradient(145deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)`,
        border: `1.5px solid ${L ? '#d1d5db' : 'rgba(255,255,255,0.12)'}`,
        borderTop: `2.5px solid ${sc}`,
        borderRadius: 10,
        padding: '10px 14px',
        flexShrink: 0,
        position: 'relative',
        boxShadow: shadow,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        cursor: 'default',
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
      {/* label row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        {icon && <span style={{ fontSize: 12, lineHeight: 1, opacity: 0.8 }}>{icon}</span>}
        <span style={{ ...TYPOGRAPHY.label, color: th.t3 }}>{label}</span>
      </div>

      {/* value */}
      <div style={{ ...TYPOGRAPHY.kpiVal, color: sc }}>{value}</div>

      {/* sub */}
      {sub && <div style={{ fontSize: 11, color: th.t2, marginTop: 4, lineHeight: 1.3 }}>{sub}</div>}

      {/* trend */}
      {trend && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 5, paddingTop: 5, borderTop: `1px solid ${th.bdr}` }}>
          <span style={{ fontSize: 10, color: trendColor, fontWeight: 700 }}>{trendArrow}</span>
          {trendLabel && <span style={{ fontSize: 10, color: th.t3 }}>{trendLabel}</span>}
        </div>
      )}
    </div>
  );
}
