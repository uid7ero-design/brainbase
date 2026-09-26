'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

const FONT = 'var(--bb-font-sans)';

interface OpBarProps {
  title?: string;
  session?: { name: string; role: string; avatarUrl?: string } | null;
  alertCount?: number;
  uploadingCount?: number;
  pathname?: string;
}

function Clock() {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
      setDate(now.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--bb-font-mono)' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bb-text-secondary)', letterSpacing: '.04em' }}>
        {time}
      </span>
      <span style={{ fontSize: 10, color: 'var(--bb-text-muted)', letterSpacing: '.04em' }}>
        {date}
      </span>
    </div>
  );
}

export default function OpBar({ title = 'Command Centre', session, alertCount = 0, uploadingCount = 0 }: OpBarProps) {
  const initials = session?.name?.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() ?? '??';

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes ob-blink  { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes ob-spin   { to{transform:rotate(360deg)} }
      `}} />

      <header style={{
        height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        background: 'var(--bb-shell-header)',
        backdropFilter: 'blur(var(--bb-blur-nav))',
        borderBottom: '1px solid var(--bb-border-default)',
        boxShadow: 'var(--bb-shadow-sm)',
        flexShrink: 0, fontFamily: FONT, zIndex: 'var(--bb-z-raised)', position: 'relative',
      }}>

        {/* Left — breadcrumb + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--bb-accent-500)" strokeWidth="1.8" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--bb-accent-300)', letterSpacing: '.01em' }}>{title}</span>
          </div>

          {/* Live indicator */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '2px 8px', borderRadius: 20,
            background: 'var(--bb-success-soft)', border: '1px solid color-mix(in srgb, var(--bb-success) 22%, transparent)',
          }}>
            <div style={{ width: 4.5, height: 4.5, borderRadius: '50%', background: 'var(--bb-success)', boxShadow: 'var(--bb-glow-success)', animation: 'ob-blink 2.4s ease-in-out infinite' }} />
            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--bb-success)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Live</span>
          </div>
        </div>

        {/* Right — status cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>

          {/* Upload activity */}
          {uploadingCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--bb-info)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ animation: 'ob-spin 1.5s linear infinite', transformOrigin: 'center' }}><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--bb-info)' }}>{uploadingCount} uploading</span>
            </div>
          )}

          {/* AI status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--bb-accent-400)" strokeWidth="2" strokeLinecap="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
            <span style={{ fontSize: 11, color: 'var(--bb-accent-400)', fontWeight: 500, letterSpacing: '.02em' }}>HLNΛ active</span>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 16, background: 'var(--bb-border-default)' }} />

          {/* Alerts bell */}
          <Link href="/command/alerts" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5, position: 'relative' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={alertCount > 0 ? 'var(--bb-warning)' : 'var(--bb-text-muted)'}
              strokeWidth="1.8" strokeLinecap="round">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 01-3.46 0"/>
            </svg>
            {alertCount > 0 && (
              <span style={{
                minWidth: 16, height: 16, borderRadius: 8, padding: '0 4px',
                background: 'var(--bb-danger)', fontSize: 9, fontWeight: 700, color: 'var(--bb-text-on-accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                letterSpacing: '.02em',
              }}>
                {alertCount}
              </span>
            )}
          </Link>

          {/* Clock */}
          <Clock />

          {/* Divider */}
          <div style={{ width: 1, height: 16, background: 'var(--bb-border-default)' }} />

          {/* Profile */}
          <Link href="/account/profile" style={{
            display: 'flex', alignItems: 'center', gap: 7,
            textDecoration: 'none', padding: '3px 7px 3px 4px',
            borderRadius: 'var(--bb-radius-pill)',
            border: '1px solid var(--bb-border-subtle)',
            background: 'var(--bb-surface-soft)',
            transition: 'all var(--bb-duration-fast) var(--bb-ease-standard)',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bb-surface-hover)'; e.currentTarget.style.borderColor = 'var(--bb-border-strong)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bb-surface-soft)'; e.currentTarget.style.borderColor = 'var(--bb-border-subtle)'; }}
          >
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: session?.avatarUrl ? 'transparent' : 'var(--bb-gradient-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700, color: 'var(--bb-text-on-accent)', overflow: 'hidden',
            }}>
              {session?.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={session.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : initials}
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--bb-text-secondary)', letterSpacing: '-.01em' }}>
              {session?.name?.split(' ')[0] ?? 'Profile'}
            </span>
          </Link>
        </div>
      </header>
    </>
  );
}
