'use client';
import { useState, useEffect, useRef } from 'react';
import { CapabilityIcon } from '@/components/brand/CapabilityIcon';
import styles from './OrganiserRail.module.css';

const COLLAPSE_KEY = 'organiser-rail-collapsed';

// Phase D.4.4E — promoted from app/organiser/page.tsx's inline BoardRail
// (D.2). Same board data/behavior (select/create/rename/delete) — this is
// a shell extraction, not a redesign of board APIs or data flow. New in
// this phase: the module identity header and the collapse control (own
// localStorage key, 'organiser-rail-collapsed' — deliberately NOT
// 'ops-sidebar-collapsed', since this rail has no dependency on the
// generic ops Sidebar it replaces for Organiser).
//
// Phase D3 — visual + keyboard convergence only (board data, callbacks,
// prompts/confirms and the collapse key are unchanged):
//   - each board is a real <button aria-current> (was a clickable <div>),
//     styled with the D1 module-nav active language
//   - the per-board options control is a sibling button (never nested
//     inside the select button) exposing aria-haspopup/aria-expanded; its
//     menu closes on Escape / outside click and returns focus to it
//   - tokens only: no violet literals, no JS hover colour swapping, no
//     outline suppression on the new-board input

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
  const menuRef = useRef<HTMLDivElement>(null);
  const optionsButtons = useRef<Record<string, HTMLButtonElement | null>>({});

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

  // Board options menu: Escape and outside click close it; Escape returns
  // focus to the button that opened it.
  useEffect(() => {
    if (!menuFor) return;
    const owner = menuFor;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setMenuFor(null);
      optionsButtons.current[owner]?.focus();
    }
    function onPointer(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || optionsButtons.current[owner]?.contains(target)) return;
      setMenuFor(null);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [menuFor]);

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, String(next)); } catch {}
      return next;
    });
  };

  const width = collapsed ? 56 : 208;

  return (
    <nav
      aria-label="Organiser boards"
      className={styles.rail}
      data-collapsed={collapsed || undefined}
      style={{
        width, minWidth: width,
        // Avoid a flash of the wrong (default-expanded) width before the
        // localStorage read above resolves, mirroring WorkspaceShell's own
        // mount-gate approach but scoped to just this rail rather than the
        // whole page.
        visibility: mounted ? 'visible' : 'hidden',
      }}
    >
      {/* ── Module identity header ── */}
      <div className={styles.identity}>
        <CapabilityIcon
          capability="organiser"
          size={collapsed ? 'sm' : 'md'}
          label={collapsed ? 'Organiser' : undefined}
        />
        {!collapsed && <span className={styles.identityName}>Organiser</span>}
      </div>

      {/* ── Boards ── */}
      <div className={styles.boards}>
        {!collapsed && <h2 className={styles.sectionLabel}>Boards</h2>}
        <ul className={styles.list}>
          {boards.map(b => {
            const active = activeId === b.id;
            return (
              <li key={b.id} className={styles.boardRow}>
                <button
                  type="button"
                  className={styles.item}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? b.name : undefined}
                  title={collapsed ? b.name : undefined}
                  onClick={() => onSelect(b.id)}
                >
                  {/* Board colour is user data (a category marker). */}
                  <span className={styles.dot} style={{ background: b.color || 'var(--text-subtle)' }} aria-hidden="true" />
                  {!collapsed && (
                    <>
                      <span className={styles.name}>{b.name}</span>
                      <span className={styles.count}>
                        {b.item_count ?? 0}<span className={styles.srOnly}> items</span>
                      </span>
                    </>
                  )}
                </button>
                {!collapsed && (
                  <button
                    type="button"
                    ref={el => { optionsButtons.current[b.id] = el; }}
                    className={styles.options}
                    onClick={() => setMenuFor(menuFor === b.id ? null : b.id)}
                    aria-label={`Board options for ${b.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === b.id}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
                  </button>
                )}
                {!collapsed && menuFor === b.id && (
                  <div ref={menuRef} role="menu" aria-label={`${b.name} options`} className={styles.menu}>
                    <button type="button" role="menuitem" className={styles.menuItem}
                      onClick={() => { const n = prompt('Rename board', b.name); if (n?.trim()) onRename(b.id, n.trim()); setMenuFor(null); }}>
                      Rename
                    </button>
                    <button type="button" role="menuitem" className={styles.menuItem} data-tone="danger"
                      onClick={() => { if (confirm(`Delete board "${b.name}"? This deletes all its groups and items.`)) onDelete(b.id); setMenuFor(null); }}>
                      Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {!collapsed && (adding ? (
          <input
            autoFocus
            value={name}
            aria-label="New board name"
            onChange={e => setName(e.target.value)}
            onBlur={() => { if (name.trim()) onCreate(name.trim()); setName(''); setAdding(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); setName(''); setAdding(false); }
              if (e.key === 'Escape') { setName(''); setAdding(false); }
            }}
            placeholder="Board name…"
            className={styles.newInput}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={styles.newButton}>
            <span aria-hidden="true">+</span> New board
          </button>
        ))}

        {collapsed && (
          <button
            type="button"
            onClick={() => { const n = prompt('Board name'); if (n?.trim()) onCreate(n.trim()); }}
            title="New board"
            aria-label="New board"
            className={styles.newButton}
          >
            +
          </button>
        )}
      </div>

      {/* ── Collapse control ── */}
      <div className={styles.footer}>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand Organiser rail' : 'Collapse Organiser rail'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand' : 'Collapse'}
          className={styles.collapse}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      </div>
    </nav>
  );
}
