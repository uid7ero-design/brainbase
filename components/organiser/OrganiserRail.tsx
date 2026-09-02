'use client';
import { useState, useEffect } from 'react';
import { useOpsTheme } from '@/components/ops/theme';
import { CapabilityIcon } from '@/components/brand/CapabilityIcon';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';
const COLLAPSE_KEY = 'organiser-rail-collapsed';

// Phase D.4.4E — promoted from app/organiser/page.tsx's inline BoardRail
// (D.2). Same board data/behavior (select/create/rename/delete) — this is
// a shell extraction, not a redesign of board APIs or data flow. New in
// this phase: the module identity header and the collapse control (own
// localStorage key, 'organiser-rail-collapsed' — deliberately NOT
// 'ops-sidebar-collapsed', since this rail has no dependency on the
// generic ops Sidebar it replaces for Organiser).

export type OrganiserBoard = {
  id: string; name: string; color: string | null; icon: string | null;
  position: number; item_count?: number;
};

interface OrganiserRailProps {
  boards: OrganiserBoard[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export default function OrganiserRail({
  boards, activeId, onSelect, onCreate, onRename, onDelete,
}: OrganiserRailProps) {
  const t = useOpsTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Hydration guard, matching Sidebar.tsx's own proven pattern — read the
  // persisted collapse state only after mount so server-render and first
  // client-render agree, then adopt whatever was saved.
  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      if (saved === 'true') setCollapsed(true);
    } catch {}
  }, []);

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, String(next)); } catch {}
      return next;
    });
  };

  const width = collapsed ? 56 : 208;

  return (
    <div style={{
      width, minWidth: width,
      flexShrink: 0,
      height: '100%',
      display: 'flex', flexDirection: 'column',
      borderRight: `1px solid ${t.ink(.055)}`,
      background: t.sidebarBg,
      transition: 'width .2s cubic-bezier(.4,0,.2,1), min-width .2s cubic-bezier(.4,0,.2,1)',
      overflow: 'hidden',
      fontFamily: FONT,
      // Avoid a flash of the wrong (default-expanded) width before the
      // localStorage read above resolves, mirroring WorkspaceShell's own
      // mount-gate approach but scoped to just this rail rather than the
      // whole page.
      visibility: mounted ? 'visible' : 'hidden',
    }}>
      {/* ── Module identity header ── */}
      <div style={{
        height: 52, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        gap: 10,
        padding: collapsed ? '0 12px' : '0 14px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderBottom: `1px solid ${t.ink(.07)}`,
      }}>
        <CapabilityIcon
          capability="organiser"
          size={collapsed ? 'sm' : 'md'}
          label={collapsed ? 'Organiser' : undefined}
        />
        {!collapsed && (
          <span style={{ fontSize: 13, fontWeight: 700, color: t.ink(.90), letterSpacing: '-.01em' }}>
            Organiser
          </span>
        )}
      </div>

      {/* ── Boards ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '10px 6px' : '14px 10px' }}>
        {!collapsed && (
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: t.ink(.24), textTransform: 'uppercase', padding: '0 6px', marginBottom: 8 }}>
            Boards
          </div>
        )}
        {boards.map(b => (
          <div
            key={b.id}
            onClick={() => onSelect(b.id)}
            title={collapsed ? b.name : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: collapsed ? '8px 0' : '8px 8px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              borderRadius: 8,
              cursor: 'pointer', marginBottom: 2,
              background: activeId === b.id ? 'rgba(139,92,246,.14)' : 'transparent',
              color: activeId === b.id ? t.accentText : t.ink(.65),
              position: 'relative',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: b.color || '#8B5CF6', flexShrink: 0 }} />
            {!collapsed && (
              <>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: activeId === b.id ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                <span style={{ fontSize: 10, color: t.ink(.22) }}>{b.item_count ?? 0}</span>
                <button
                  onClick={e => { e.stopPropagation(); setMenuFor(menuFor === b.id ? null : b.id); }}
                  aria-label={`Board options for ${b.name}`}
                  style={{ width: 16, height: 16, background: 'transparent', border: 'none', color: t.ink(.28), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
                </button>
              </>
            )}
            {!collapsed && menuFor === b.id && (
              <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', right: 4, zIndex: 20, background: t.menuBg, border: `1px solid ${t.ink(.1)}`, borderRadius: 8, padding: 4, minWidth: 120, boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                <button onClick={() => { const n = prompt('Rename board', b.name); if (n?.trim()) onRename(b.id, n.trim()); setMenuFor(null); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 11.5, background: 'transparent', border: 'none', color: t.ink(.8), cursor: 'pointer', borderRadius: 5 }}>
                  Rename
                </button>
                <button onClick={() => { if (confirm(`Delete board "${b.name}"? This deletes all its groups and items.`)) onDelete(b.id); setMenuFor(null); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 11.5, background: 'transparent', border: 'none', color: '#EF4444', cursor: 'pointer', borderRadius: 5 }}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}

        {!collapsed && (adding ? (
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => { if (name.trim()) onCreate(name.trim()); setName(''); setAdding(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); setName(''); setAdding(false); }
              if (e.key === 'Escape') { setName(''); setAdding(false); }
            }}
            placeholder="Board name…"
            style={{ marginTop: 4, fontSize: 12.5, fontFamily: FONT, background: t.ink(.05), border: '1px solid rgba(139,92,246,.4)', borderRadius: 8, padding: '7px 9px', color: t.ink(.94), outline: 'none' }}
          />
        ) : (
          <button onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '7px 8px', borderRadius: 8, background: 'transparent', border: `1px dashed ${t.ink(.14)}`, color: t.ink(.40), cursor: 'pointer', fontSize: 12, fontFamily: FONT, width: '100%' }}>
            <span>+</span> New board
          </button>
        ))}

        {collapsed && (
          <button
            onClick={() => { const n = prompt('Board name'); if (n?.trim()) onCreate(n.trim()); }}
            title="New board"
            aria-label="New board"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 6, width: '100%', height: 28, borderRadius: 8, background: 'transparent', border: `1px dashed ${t.ink(.14)}`, color: t.ink(.40), cursor: 'pointer', fontSize: 15, fontFamily: FONT }}
          >
            +
          </button>
        )}
      </div>

      {/* ── Collapse control ── */}
      <div style={{ padding: collapsed ? '8px 6px' : '8px 10px', borderTop: `1px solid ${t.ink(.07)}`, flexShrink: 0, display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end' }}>
        <button
          onClick={toggle}
          aria-label={collapsed ? 'Expand Organiser rail' : 'Collapse Organiser rail'}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            width: 26, height: 26, borderRadius: 7,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: t.ink(.04), border: `1px solid ${t.ink(.09)}`,
            cursor: 'pointer', color: t.ink(.40),
            transition: 'all .15s',
            transform: collapsed ? 'rotate(180deg)' : 'none',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = t.ink(.08); e.currentTarget.style.color = t.ink(.75); }}
          onMouseLeave={e => { e.currentTarget.style.background = t.ink(.04); e.currentTarget.style.color = t.ink(.40); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      </div>
    </div>
  );
}
