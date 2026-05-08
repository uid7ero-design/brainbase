'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import OpBar from './OpBar';

interface WorkspaceShellProps {
  children: React.ReactNode;
  title?: string;
  alertCount?: number;
  uploadingCount?: number;
}

type Session = { name: string; role: string; avatarUrl?: string } | null;

export default function WorkspaceShell({
  children,
  title = 'Command Centre',
  alertCount = 4,
  uploadingCount = 0,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed]   = useState(false);
  const [session, setSession]       = useState<Session>(null);
  const [mounted, setMounted]       = useState(false);

  // Hydration guard + persist sidebar state
  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem('ops-sidebar-collapsed');
      if (saved === 'true') setCollapsed(true);
    } catch {}
  }, []);

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('ops-sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  };

  // Fetch session (same pattern as TopNav)
  useEffect(() => {
    fetch('/api/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.role) setSession({ name: d.name, role: d.role, avatarUrl: d.profile?.avatar_url ?? undefined });
      })
      .catch(() => {});
  }, []);

  if (!mounted) {
    // SSR / hydration placeholder — avoid layout shift
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#07080B' }} />
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes ws-fadein { from{opacity:0} to{opacity:1} }
        body { overflow: hidden !important; }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar       { width: 3px; height: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.09); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.18); }
      `}} />

      <div style={{
        position: 'fixed', inset: 0, display: 'flex',
        background: '#07080B',
        fontFamily: 'var(--font-inter),"Inter",-apple-system,sans-serif',
        animation: 'ws-fadein .25s ease',
        zIndex: 50,
        overflow: 'hidden',
      }}>

        {/* ── Ambient background ── */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(ellipse 90% 55% at 50% -8%, rgba(109,40,217,.14) 0%, transparent 60%)',
        }} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
          backgroundImage: 'linear-gradient(rgba(255,255,255,.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.012) 1px,transparent 1px)',
          backgroundSize: '48px 48px',
        }} />

        {/* ── Sidebar ── */}
        <div style={{ position: 'relative', zIndex: 10, flexShrink: 0 }}>
          <Sidebar
            collapsed={collapsed}
            onToggle={toggle}
            pathname={pathname ?? '/'}
            alertCount={alertCount}
          />
        </div>

        {/* ── Main area ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
          <OpBar
            title={title}
            session={session}
            alertCount={alertCount}
            uploadingCount={uploadingCount}
          />

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
