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
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '.04em', fontVariantNumeric: 'tabular-nums' }}>
        {time}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '.04em' }}>
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
        @keyframes ob-spin   { to{transform:rotate(360deg)} }
        @media (prefers-reduced-motion: reduce) { .ob-spin { animation: none !important; } }
      `}} />

      <header style={{
        height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        // Phase D1 — flat chrome surface: no glass blur, no purple shadow.
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0, fontFamily: FONT, zIndex: 5, position: 'relative',
      }}>

        {/* Left — breadcrumb + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '.01em' }}>{title}</span>
          </div>

          {/* Live indicator */}
          <div className="ob-hide-sm" style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '2px 7px', borderRadius: 'var(--radius-sm)',
            background: 'var(--status-success-muted)', border: '1px solid var(--status-success-border)',
          }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--status-success)' }} aria-hidden="true" />
            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--status-success)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Live</span>
          </div>
        </div>

        {/* Right — status cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>

          {/* Upload activity */}
          {uploadingCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--status-info)' }}>
              <svg className="ob-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ animation: 'ob-spin 1.5s linear infinite', transformOrigin: 'center' }}><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--status-info)' }}>{uploadingCount} uploading</span>
            </div>
          )}

          {/* AI status */}
          <div className="ob-hide-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--brand-brainbase-accent)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500, letterSpacing: '.02em' }}>HLNA active</span>
          </div>

          {/* Divider */}
          <div className="ob-hide-sm" style={{ width: 1, height: 16, background: 'var(--border)' }} aria-hidden="true" />

          {/* Alerts bell */}
          <Link
            href="/command/alerts"
            aria-label={alertCount > 0 ? `Alerts (${alertCount})` : 'Alerts'}
            style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5, position: 'relative', borderRadius: 'var(--radius-sm)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={alertCount > 0 ? 'var(--status-warning)' : 'var(--text-muted)'}
              strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 01-3.46 0"/>
            </svg>
            {alertCount > 0 && (
              <span style={{
                minWidth: 16, height: 16, borderRadius: 'var(--radius-sm)', padding: '0 4px',
                background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)',
                fontSize: 9, fontWeight: 700, color: 'var(--status-danger)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                letterSpacing: '.02em',
              }}>
                {alertCount}
              </span>
            )}
          </Link>

          {/* Clock */}
          <span className="ob-hide-sm" style={{ display: 'contents' }}><Clock /></span>

          {/* Divider */}
          <div className="ob-hide-sm" style={{ width: 1, height: 16, background: 'var(--border)' }} aria-hidden="true" />

          {/* Profile */}
          <Link href="/account/profile" style={{
            display: 'flex', alignItems: 'center', gap: 7,
            textDecoration: 'none', padding: '3px 7px 3px 4px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            background: 'transparent',
            transition: 'background-color .15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-sunken)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: session?.avatarUrl ? 'transparent' : 'var(--brand-brainbase-accent-muted)',
              border: '1px solid var(--brand-brainbase-accent-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700, color: 'var(--brand-brainbase-accent)', overflow: 'hidden',
            }}>
              {session?.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={session.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : initials}
            </div>
            <span className="ob-hide-sm" style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', letterSpacing: '-.01em' }}>
              {session?.name?.split(' ')[0] ?? 'Profile'}
            </span>
          </Link>
        </div>
      </header>
    </>
  );
}
