'use client';
import React from 'react';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

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

export default function Widget({
  title, subtitle, live = false,
  loading = false, empty = false, emptyMessage = 'No data',
  headerRight, children,
  style, bodyStyle, noPad = false,
}: WidgetProps) {
  return (
    <div style={{
      borderRadius: 14, overflow: 'hidden',
      background: 'rgba(7,8,11,.72)',
      border: '1px solid rgba(255,255,255,.07)',
      backdropFilter: 'blur(16px)',
      display: 'flex', flexDirection: 'column',
      fontFamily: FONT,
      ...style,
    }}>
      {/* Header */}
      <div style={{
        padding: '11px 16px', flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,.055)',
        background: 'rgba(255,255,255,.015)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {live && (
            <div style={{
              width: 5.5, height: 5.5, borderRadius: '50%',
              background: '#22C55E', boxShadow: '0 0 5px #22C55E',
              animation: 'w-blink 2.4s ease-in-out infinite', flexShrink: 0,
            }} />
          )}
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.10em', color: 'rgba(255,255,255,.42)', textTransform: 'uppercase' }}>
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,.20)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
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

      <style dangerouslySetInnerHTML={{ __html: `@keyframes w-blink{0%,100%{opacity:1}50%{opacity:.35}}` }} />
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[1, 0.7, 0.85].map((w, i) => (
        <div key={i} style={{
          height: 14, borderRadius: 4,
          background: 'rgba(255,255,255,.05)',
          width: `${w * 100}%`,
          animation: 'w-pulse 1.6s ease-in-out infinite',
          animationDelay: `${i * 0.15}s`,
        }} />
      ))}
      <style dangerouslySetInnerHTML={{ __html: `@keyframes w-pulse{0%,100%{opacity:.5}50%{opacity:.15}}` }} />
    </div>
  );
}

function WidgetEmpty({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 60 }}>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.18)', letterSpacing: '.04em' }}>{message}</span>
    </div>
  );
}
