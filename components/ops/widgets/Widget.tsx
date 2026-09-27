'use client';
import React from 'react';

// Authenticated visual-completion pass: a flat token panel that follows the
// app theme (no glass blur, no glow). Used only by the Bin Maintenance
// insights surface. The live dot and skeleton pulse are decorative and stop
// animating under prefers-reduced-motion.

interface WidgetProps {
  title: string;
  subtitle?: string;
  live?: boolean;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  headerRight?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  noPad?: boolean;
}

const MOTION_CSS =
  '@keyframes w-blink{0%,100%{opacity:1}50%{opacity:.35}}' +
  '@keyframes w-pulse{0%,100%{opacity:1}50%{opacity:.45}}' +
  '@media (prefers-reduced-motion: reduce){.w-anim{animation:none!important}}';

export default function Widget({
  title, subtitle, live = false,
  loading = false, empty = false, emptyMessage = 'No data',
  headerRight, children,
  style, bodyStyle, noPad = false,
}: WidgetProps) {
  return (
    <div style={{
      borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--bb-font-sans)',
      color: 'var(--text-primary)',
      ...style,
    }}>
      {/* Header */}
      <div style={{
        padding: '11px 16px', flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {live && (
            <div className="w-anim" aria-hidden="true" style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--status-success)',
              animation: 'w-blink 2.4s ease-in-out infinite', flexShrink: 0,
            }} />
          )}
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
              · {subtitle}
            </span>
          )}
        </div>
        {headerRight && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {headerRight}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: noPad ? 0 : '14px 16px', overflow: 'hidden', ...bodyStyle }}>
        {loading ? (
          <WidgetSkeleton />
        ) : empty ? (
          <WidgetEmpty message={emptyMessage} />
        ) : (
          children
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: MOTION_CSS }} />
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[1, 0.7, 0.85].map((w, i) => (
        <div key={i} className="w-anim" style={{
          height: 14, borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-sunken)',
          width: `${w * 100}%`,
          animation: 'w-pulse 1.6s ease-in-out infinite',
          animationDelay: `${i * 0.15}s`,
        }} />
      ))}
    </div>
  );
}

function WidgetEmpty({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 60 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '.02em' }}>{message}</span>
    </div>
  );
}
