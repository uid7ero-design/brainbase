'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import OpBar from './OpBar';
import IntelRail from './IntelRail';
import { APP_HEADER_OFFSET_VAR } from '@/lib/layout/headerOffset';

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
    // SSR / hydration placeholder — avoid layout shift. Reads --bg-base directly
    // (set synchronously by the blocking theme script in <head>) since the
    // theme context itself isn't meaningful until this component mounts.
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-base)' }} />
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes ws-fadein  { from{opacity:0} to{opacity:1} }
        body { overflow: hidden !important; }
        /* Phase D1 — scoped to the workspace instead of the whole document. */
        .ws-shell, .ws-shell * { box-sizing: border-box; }
        .ws-shell ::-webkit-scrollbar       { width: 6px; height: 6px; }
        .ws-shell ::-webkit-scrollbar-track { background: transparent; }
        .ws-shell ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
        @media (prefers-reduced-motion: reduce) { .ws-shell { animation: none !important; } }
        /* Narrow screens: keep the title, alerts and avatar; drop secondary status. */
        @media (max-width: 767px) { .ws-shell .ob-hide-sm { display: none !important; } }
        /* Phase D2 — with the intelligence rail, narrow screens stack the rail
           under the canvas (one vertical scroll) instead of squeezing the
           canvas to a sliver beside a 260px rail. Nothing is hidden. Scoped
           to .ws-body--rail so rail-less pages (bin-maintenance) are unchanged. */
        @media (max-width: 767px) {
          .ws-shell .ws-body--rail { flex-direction: column; overflow-y: auto !important; }
          .ws-shell .ws-body--rail > .ws-canvas { flex: none !important; overflow-y: visible !important; }
          .ws-shell .ws-body--rail > aside { width: 100% !important; height: auto !important; border-left: 0 !important; border-top: 1px solid var(--border); }
        }
      `}} />

      <div className="ws-shell" style={{
        // Phase D.4.5C-W2 — shared --app-header-offset custom property
        // (lib/layout/headerOffset.ts) instead of a hardcoded `top: 52`.
        position: 'fixed', top: APP_HEADER_OFFSET_VAR, left: 0, right: 0, bottom: 0, display: 'flex',
        background: 'var(--bg-base)',
        fontFamily: 'var(--font-inter),"Inter",-apple-system,sans-serif',
        animation: 'ws-fadein .3s ease',
        zIndex: 50,
        overflow: 'hidden',
      }}>

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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1, minWidth: 0 }}>
          <OpBar
            title={title}
            session={session}
            alertCount={alertCount}
            uploadingCount={uploadingCount}
          />

          {/* Canvas + optional Intel Rail */}
          <div className={intelRail ? 'ws-body ws-body--rail' : 'ws-body'} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div className="ws-canvas" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
              {children}
            </div>
            {intelRail && <IntelRail />}
          </div>
        </div>
      </div>
    </>
  );
}
