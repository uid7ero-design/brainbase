'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Session = { role: string; name: string } | null;

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

function NavLink({ href, children, active }: { href: string; children: React.ReactNode; active?: boolean }) {

  return (
    <Link
      href={href}
      style={{
        fontSize: 13, fontWeight: 500, textDecoration: 'none', transition: 'color .15s',
        color: active ? '#C4B5FD' : 'rgba(255,255,255,.40)',
        borderBottom: active ? '1px solid rgba(167,139,250,.5)' : 'none',
        paddingBottom: active ? 1 : 0,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'rgba(255,255,255,.80)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'rgba(255,255,255,.40)'; }}
    >
      {children}
    </Link>
  );
}

export default function TopNav({ serverSession }: { serverSession?: Session }) {
  const [session, setSession] = useState<Session>(serverSession ?? null);
  const pathname = usePathname();

  useEffect(() => {
    fetch('/api/me').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.role) setSession(d);
    });
  }, []);

  if (!session) return null;

  const { role, name } = session;
  const isManager = ['manager', 'admin', 'super_admin'].includes(role);
  const isSuperAdmin = role === 'super_admin';
  const firstName = name.split(' ')[0];

  return (
    <nav style={{
      height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px', borderBottom: '1px solid rgba(255,255,255,.06)',
      background: 'rgba(7,8,11,.92)', backdropFilter: 'blur(16px)',
      position: 'sticky', top: 0, zIndex: 100, fontFamily: FONT,
      flexShrink: 0,
    }}>
      {/* Logo */}
      <Link href="/" style={{ fontWeight: 700, fontSize: 14, color: '#F5F7FA', textDecoration: 'none', letterSpacing: '.04em', flexShrink: 0 }}>
        BR<span style={{ color: '#A78BFA' }}>Λ</span>INBASE
      </Link>

      {/* Links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        {isManager && (
          <NavLink href="/command" active={pathname.startsWith('/command')}>Command Centre</NavLink>
        )}

        <NavLink href="/dashboard" active={pathname === '/dashboard'}>
          <svg width="46" height="14" viewBox="0 0 211 62" style={{ display: 'block' }} aria-label="HLNA">
            <g fill="rgba(245,247,250,0.9)">
              <path d="M28.59 48L21.81 48L21.81 10.17L28.59 10.17L28.59 25.81L46.18 25.81L46.18 10.17L52.96 10.17L52.96 48L46.18 48L46.18 31.52L28.59 31.52L28.59 48Z"/>
              <path d="M93.07 48L69.58 48L69.58 10.17L76.36 10.17L76.36 42.29L93.07 42.29L93.07 48Z"/>
              <path d="M114.89 48L107.98 48L107.98 10.17L115.65 10.17L128.73 31.01Q129.54 32.31 130.45 33.95Q131.37 35.58 132.36 37.59L132.36 37.59Q132.87 38.66 133.37 39.80L133.37 39.80Q133.30 38.76 133.25 37.69L133.25 37.69Q133.09 35.46 133.03 33.44Q132.97 31.42 132.97 30.02L132.97 30.02L132.97 10.17L139.85 10.17L139.85 48L132.15 48L120.35 29.24Q119.23 27.43 118.24 25.68Q117.25 23.93 116.11 21.72L116.11 21.72Q115.37 20.27 114.41 18.47L114.41 18.47Q114.51 20.10 114.58 21.62L114.58 21.62Q114.71 24.11 114.80 26.06Q114.89 28.02 114.89 29.21L114.89 29.21L114.89 48Z"/>
            </g>
            <path d="M 153,48 L 172,7 L 191,48" fill="none" stroke="url(#tnav-lg)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
            <defs>
              <linearGradient id="tnav-lg" gradientUnits="userSpaceOnUse" x1="172" y1="48" x2="172" y2="7">
                <stop offset="0%" stopColor="#6D28D9"/>
                <stop offset="100%" stopColor="#C084FC"/>
              </linearGradient>
            </defs>
          </svg>
        </NavLink>

        <NavLink href="/dashboards" active={pathname.startsWith('/dashboards')}>Dashboards</NavLink>

        {isSuperAdmin && (
          <NavLink href="/admin/users" active={pathname.startsWith('/admin')}>Admin</NavLink>
        )}

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,.10)' }} />

        <NavLink href="/profile" active={pathname === '/profile'}>
          <span style={{ color: 'rgba(255,255,255,.50)', fontSize: 13 }}>{firstName}</span>
        </NavLink>

        <button
          onClick={async () => { const { logout } = await import('@/app/actions/auth'); await logout(); }}
          style={{ background: 'none', border: 'none', fontSize: 13, color: 'rgba(255,255,255,.28)', cursor: 'pointer', fontFamily: FONT, fontWeight: 500, padding: 0, transition: 'color .15s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,.70)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,.28)')}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
