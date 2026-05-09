'use client';
import Link from 'next/link';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

// ── Icons ─────────────────────────────────────────────────────────────────────

const I = {
  command:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  dayjob:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  briefings: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>,
  reports:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>,
  uploads:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>,
  alerts:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
  waste:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
  fleet:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  parks:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8C8 10 5.9 16.17 3.82 22"/><path d="M9.05 17.17C11 14.5 16 13 21 14"/></svg>,
  compliance:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>,
  assets:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>,
  infra:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  binmaint:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  orgs:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  users:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  settings:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  collapse:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>,
};

// ── Nav data ──────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    label: 'Core',
    items: [
      { icon: I.command,   label: 'Command Centre', href: '/command',     exact: true },
      { icon: I.dayjob,    label: 'Day Job',        href: '/dashboard',   exact: false },
      { icon: I.briefings, label: 'AI Briefings',   href: '/briefings',   exact: false },
      { icon: I.reports,   label: 'Reports',        href: '/reports',     exact: false },
      { icon: I.uploads,   label: 'Uploads',        href: '/data',        exact: false },
      { icon: I.alerts,    label: 'Alerts',         href: '/command/alerts', exact: false },
    ],
  },
  {
    label: 'Operational',
    items: [
      { icon: I.waste,     label: 'Waste',          href: '/dashboard/waste',            exact: false },
      { icon: I.binmaint, label: 'Bin Maintenance', href: '/dashboard/bin-maintenance', exact: false },
      { icon: I.fleet,     label: 'Fleet',          href: '/dashboard/fleet',        exact: false },
      { icon: I.parks,     label: 'Parks',          href: '/dashboard/parks',        exact: false },
      { icon: I.compliance,label: 'Compliance',     href: '/dashboard/compliance',   exact: false },
      { icon: I.assets,    label: 'Assets',         href: '/dashboard/facilities',   exact: false },
      { icon: I.infra,     label: 'Infrastructure', href: '/dashboard/roads',        exact: false },
    ],
  },
  {
    label: 'Admin',
    items: [
      { icon: I.orgs,      label: 'Organisations',  href: '/admin/orgs',      exact: false },
      { icon: I.users,     label: 'Users',          href: '/admin/users',     exact: false },
      { icon: I.settings,  label: 'Settings',       href: '/account/profile', exact: false },
    ],
  },
];

// ── Alert badge colours ───────────────────────────────────────────────────────

const ALERT_COLORS: Record<string, string> = {
  '/command/alerts': '#EF4444',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  pathname: string;
  alertCount?: number;
}

function NavItem({
  icon, label, href, exact, pathname, collapsed, alertColor,
}: {
  icon: React.ReactNode; label: string; href: string;
  exact: boolean; pathname: string; collapsed: boolean;
  alertColor?: string;
}) {
  const active = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      style={{
        display: 'flex', alignItems: 'center',
        gap: collapsed ? 0 : 10,
        padding: collapsed ? '10px 0' : '8px 12px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: 8,
        textDecoration: 'none',
        color: active ? '#C4B5FD' : 'rgba(255,255,255,.40)',
        background: active ? 'rgba(139,92,246,.12)' : 'transparent',
        borderLeft: `2px solid ${active ? '#8B5CF6' : 'transparent'}`,
        marginLeft: collapsed ? 0 : -2,
        transition: 'all .15s ease',
        position: 'relative',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        if (active) return;
        e.currentTarget.style.color = 'rgba(255,255,255,.72)';
        e.currentTarget.style.background = 'rgba(255,255,255,.04)';
      }}
      onMouseLeave={e => {
        if (active) return;
        e.currentTarget.style.color = 'rgba(255,255,255,.40)';
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18 }}>
        {icon}
      </span>
      {!collapsed && (
        <span style={{
          fontSize: 12.5, fontWeight: active ? 600 : 500, letterSpacing: '-.01em',
          opacity: collapsed ? 0 : 1, transition: 'opacity .15s',
        }}>
          {label}
        </span>
      )}
      {/* Alert dot */}
      {alertColor && !collapsed && (
        <span style={{
          marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%',
          background: alertColor, boxShadow: `0 0 5px ${alertColor}`, flexShrink: 0,
          animation: 'sb-blink 2.4s ease-in-out infinite',
        }} />
      )}
    </Link>
  );
}

export default function Sidebar({ collapsed, onToggle, pathname, alertCount = 0 }: SidebarProps) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes sb-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes sb-fade { from{opacity:0;transform:translateX(-4px)} to{opacity:1;transform:none} }
      ` }} />

      <aside style={{
        width: collapsed ? 56 : 220,
        minWidth: collapsed ? 56 : 220,
        height: '100%',
        display: 'flex', flexDirection: 'column',
        background: 'rgba(6,7,10,.97)',
        borderRight: '1px solid rgba(255,255,255,.055)',
        transition: 'width .22s cubic-bezier(.4,0,.2,1), min-width .22s cubic-bezier(.4,0,.2,1)',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
        fontFamily: FONT,
      }}>

        {/* ── Header ── */}
        <div style={{
          height: 52, display: 'flex', alignItems: 'center',
          padding: collapsed ? '0 12px' : '0 14px',
          borderBottom: '1px solid rgba(255,255,255,.05)',
          justifyContent: collapsed ? 'center' : 'space-between',
          flexShrink: 0,
        }}>
          {!collapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, animation: 'sb-fade .2s ease' }}>
              {/* Tactical logo mark */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
                  fill="rgba(139,92,246,.18)" stroke="#8B5CF6" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.18em', color: 'rgba(255,255,255,.75)', textTransform: 'uppercase' }}>
                Brainbase
              </span>
            </div>
          )}
          {collapsed && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
                fill="rgba(139,92,246,.22)" stroke="#8B5CF6" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          )}

          {/* Toggle */}
          <button onClick={onToggle} style={{
            width: 26, height: 26, borderRadius: 7,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)',
            cursor: 'pointer', color: 'rgba(255,255,255,.35)',
            transition: 'all .15s', flexShrink: 0,
            transform: collapsed ? 'rotate(180deg)' : 'none',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.08)'; e.currentTarget.style.color = 'rgba(255,255,255,.70)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.04)'; e.currentTarget.style.color = 'rgba(255,255,255,.35)'; }}
          >
            {I.collapse}
          </button>
        </div>

        {/* ── Nav sections ── */}
        <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: collapsed ? '10px 6px' : '10px 10px' }}>
          {SECTIONS.map((section, si) => (
            <div key={section.label} style={{ marginBottom: si < SECTIONS.length - 1 ? 18 : 0 }}>
              {/* Section label */}
              {!collapsed && (
                <div style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '.16em',
                  color: 'rgba(255,255,255,.18)', textTransform: 'uppercase',
                  padding: '0 12px', marginBottom: 4,
                  animation: 'sb-fade .2s ease',
                }}>
                  {section.label}
                </div>
              )}
              {collapsed && si > 0 && (
                <div style={{ height: 1, background: 'rgba(255,255,255,.06)', margin: '6px 0' }} />
              )}

              {section.items.map(item => (
                <NavItem
                  key={item.href}
                  icon={item.icon}
                  label={item.label}
                  href={item.href}
                  exact={item.exact}
                  pathname={pathname}
                  collapsed={collapsed}
                  alertColor={item.href === '/command/alerts' && alertCount > 0 ? ALERT_COLORS[item.href] : undefined}
                />
              ))}
            </div>
          ))}
        </nav>

        {/* ── Footer status ── */}
        <div style={{
          padding: collapsed ? '10px 6px' : '10px 12px',
          borderTop: '1px solid rgba(255,255,255,.05)',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: 8, padding: collapsed ? '6px 0' : '8px 10px',
            borderRadius: 8, background: 'rgba(34,197,94,.06)',
            border: '1px solid rgba(34,197,94,.12)',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#22C55E', boxShadow: '0 0 6px #22C55E',
              flexShrink: 0, animation: 'sb-blink 2.8s ease-in-out infinite',
            }} />
            {!collapsed && (
              <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(34,197,94,.75)', letterSpacing: '.06em', animation: 'sb-fade .2s ease' }}>
                Systems Live
              </span>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
