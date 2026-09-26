'use client';
import { useState, useEffect } from 'react';
import { CapabilityIcon } from '@/components/brand/CapabilityIcon';

const FONT = 'var(--bb-font-sans)';
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
      borderRight: '1px solid var(--bb-border-subtle)',
      background: 'var(--bb-shell-sidebar)',
      transition: 'width var(--bb-duration-base) var(--bb-ease-standard), min-width var(--bb-duration-base) var(--bb-ease-standard)',
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
        gap: 'var(--bb-space-5)',
        padding: collapsed ? '0 12px' : '0 14px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderBottom: '1px solid var(--bb-border-subtle)',
      }}>
        <CapabilityIcon
          capability="organiser"
          size={collapsed ? 'sm' : 'md'}
          label={collapsed ? 'Organiser' : undefined}
        />
        {!collapsed && (
          <span style={{ fontSize: 'var(--bb-type-body-size)', fontWeight: 700, color: 'var(--bb-text-primary)', letterSpacing: '-.01em' }}>
            Organiser
          </span>
        )}
      </div>

      {/* ── Boards ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '10px 6px' : '14px 10px' }}>
        {!collapsed && (
          <div style={{ fontSize: 'var(--bb-type-micro-size)', fontWeight: 700, letterSpacing: 'var(--bb-type-micro-tracking)', color: 'var(--bb-text-muted)', textTransform: 'uppercase', padding: '0 6px', marginBottom: 8 }}>
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
              borderRadius: 'var(--bb-radius-md)',
              cursor: 'pointer', marginBottom: 2,
              background: activeId === b.id ? 'var(--bb-surface-selected)' : 'transparent',
              color: activeId === b.id ? 'var(--bb-accent-300)' : 'var(--bb-text-secondary)',
              position: 'relative',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: b.color || 'var(--bb-accent-500)', flexShrink: 0 }} />
            {!collapsed && (
              <>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: activeId === b.id ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                <span style={{ fontSize: 'var(--bb-type-micro-size)', color: 'var(--bb-text-muted)' }}>{b.item_count ?? 0}</span>
                <button
                  onClick={e => { e.stopPropagation(); setMenuFor(menuFor === b.id ? null : b.id); }}
                  aria-label={`Board options for ${b.name}`}
                  style={{ width: 16, height: 16, background: 'transparent', border: 'none', color: 'var(--bb-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
                </button>
              </>
            )}
            {!collapsed && menuFor === b.id && (
              <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', right: 4, zIndex: 'var(--bb-z-menu)', background: 'var(--bb-surface-3)', border: '1px solid var(--bb-border-default)', borderRadius: 'var(--bb-radius-md)', padding: 'var(--bb-space-2)', minWidth: 120, boxShadow: 'var(--bb-shadow-float)' }}>
                <button onClick={() => { const n = prompt('Rename board', b.name); if (n?.trim()) onRename(b.id, n.trim()); setMenuFor(null); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 11.5, background: 'transparent', border: 'none', color: 'var(--bb-text-primary)', cursor: 'pointer', borderRadius: 'var(--bb-radius-sm)' }}>
                  Rename
                </button>
                <button onClick={() => { if (confirm(`Delete board "${b.name}"? This deletes all its groups and items.`)) onDelete(b.id); setMenuFor(null); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 11.5, background: 'transparent', border: 'none', color: 'var(--bb-danger)', cursor: 'pointer', borderRadius: 'var(--bb-radius-sm)' }}>
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
            style={{ marginTop: 4, fontSize: 12.5, fontFamily: FONT, background: 'var(--bb-surface-soft)', border: '1px solid var(--bb-border-focus)', borderRadius: 'var(--bb-radius-md)', padding: '7px 9px', color: 'var(--bb-text-primary)', outline: 'none' }}
          />
        ) : (
          <button onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '7px 8px', borderRadius: 'var(--bb-radius-md)', background: 'transparent', border: '1px dashed var(--bb-border-strong)', color: 'var(--bb-text-tertiary)', cursor: 'pointer', fontSize: 12, fontFamily: FONT, width: '100%' }}>
            <span>+</span> New board
          </button>
        ))}

        {collapsed && (
          <button
            onClick={() => { const n = prompt('Board name'); if (n?.trim()) onCreate(n.trim()); }}
            title="New board"
            aria-label="New board"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 6, width: '100%', height: 28, borderRadius: 'var(--bb-radius-md)', background: 'transparent', border: '1px dashed var(--bb-border-strong)', color: 'var(--bb-text-tertiary)', cursor: 'pointer', fontSize: 15, fontFamily: FONT }}
          >
            +
          </button>
        )}
      </div>

      {/* ── Collapse control ── */}
      <div style={{ padding: collapsed ? '8px 6px' : '8px 10px', borderTop: '1px solid var(--bb-border-subtle)', flexShrink: 0, display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end' }}>
        <button
          onClick={toggle}
          aria-label={collapsed ? 'Expand Organiser rail' : 'Collapse Organiser rail'}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            width: 26, height: 26, borderRadius: 'var(--bb-radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bb-surface-soft)', border: '1px solid var(--bb-border-default)',
            cursor: 'pointer', color: 'var(--bb-text-tertiary)',
            transition: 'all var(--bb-duration-fast) var(--bb-ease-standard)',
            transform: collapsed ? 'rotate(180deg)' : 'none',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bb-surface-hover)'; e.currentTarget.style.color = 'var(--bb-text-secondary)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bb-surface-soft)'; e.currentTarget.style.color = 'var(--bb-text-tertiary)'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      </div>
    </div>
  );
}
