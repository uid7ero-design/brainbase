'use client';

import React from 'react';
import { getTheme } from './tokens';

export interface SectionProps {
  title?:    string;
  subtitle?: string;
  badge?:    string | number;
  action?:   React.ReactNode;
  children:  React.ReactNode;
  spacing?:  'none' | 'sm' | 'md' | 'lg';
  border?:   boolean;
  bg?:       boolean;
  theme?:    'light' | 'dark';
  accentColor?: string;
}

const SPACING_MAP = { none: 0, sm: 12, md: 16, lg: 24 } as const;

export default function Section({
  title, subtitle, badge, action, children,
  spacing = 'md', border = false, bg = false,
  theme = 'dark', accentColor,
}: SectionProps) {
  const th = getTheme(theme);
  const L  = theme === 'light';
  const p  = SPACING_MAP[spacing];

  const hasHeader = !!(title || subtitle || badge !== undefined || action);

  return (
    <div style={{
      padding: p,
      background: bg ? (L ? th.ralt : th.ralt) : 'transparent',
      borderBottom: border ? `1px solid ${th.rbdr}` : 'none',
    }}>
      {hasHeader && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {title && (
              <span style={{ fontSize: 11, fontWeight: 700, color: th.t3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {title}
              </span>
            )}
            {badge !== undefined && (
              <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: th.sub, color: th.t3, border: `1px solid ${th.bdr}` }}>
                {badge}
              </span>
            )}
            {subtitle && (
              <span style={{ fontSize: 11, color: th.t2 }}>{subtitle}</span>
            )}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
