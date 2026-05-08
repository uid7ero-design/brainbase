'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import OpBar from './OpBar';
import IntelRail from './IntelRail';

interface WorkspaceShellProps {
  children: React.ReactNode;
  title?: string;
  alertCount?: number;
  uploadingCount?: number;
  intelRail?: boolean;
}

type Session = { name: string; role: string; avatarUrl?: string } | null;

export default function WorkspaceShell({
  children,
  title = 'Command Centre',
  alertCount = 4,
  uploadingCount = 0,
  intelRail = false,
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
        @keyframes ws-fadein  { from{opacity:0} to{opacity:1} }
        @keyframes ws-breathe { 0%,100%{opacity:.7} 50%{opacity:1} }
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
        animation: 'ws-fadein .3s ease',
        zIndex: 50,
        overflow: 'hidden',
      }}>

        {/* ── Layer 1: deep ambient gradient ── */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(ellipse 100% 60% at 50% -10%, rgba(109,40,217,.18) 0%, transparent 58%)',
          animation: 'ws-breathe 8s ease-in-out infinite',
        }} />
        {/* ── Layer 2: bottom counter-vignette ── */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(ellipse 80% 40% at 50% 110%, rgba(6,5,20,.70) 0%, transparent 65%)',
        }} />
        {/* ── Layer 3: corner vignettes ── */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(ellipse 50% 80% at 0% 50%, rgba(4,4,12,.55) 0%, transparent 55%), radial-gradient(ellipse 30% 60% at 100% 0%, rgba(80,30,180,.07) 0%, transparent 50%)',
        }} />
        {/* ── Layer 4: grid ── */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
          backgroundImage: 'linear-gradient(rgba(255,255,255,.009) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.009) 1px,transparent 1px)',
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
          {/* edge light between sidebar and canvas */}
          <div style={{
            position: 'absolute', top: 0, right: -1, width: 1, height: '100%',
            background: 'linear-gradient(180deg, transparent 0%, rgba(139,92,246,.18) 30%, rgba(139,92,246,.08) 70%, transparent 100%)',
            pointerEvents: 'none', zIndex: 11,
          }} />
        </div>

        {/* ── Main area ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1, minWidth: 0 }}>
          <OpBar
            title={title}
            session={session}
            alertCount={alertCount}
            uploadingCount={uploadingCount}
          />

          {/* Canvas + optional Intel Rail */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
              {children}
            </div>
            {intelRail && <IntelRail />}
          </div>
        </div>
      </div>
    </>
  );
}
