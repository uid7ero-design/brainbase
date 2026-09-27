'use client';

import { useState, useRef, useEffect, useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark';
import { BrokenOrbitMark } from '@/components/brand/BrokenOrbitMark';
import { CapabilityIcon } from '@/components/brand/CapabilityIcon';
import { useTheme } from '@/components/theme/ThemeProvider';
import { resolvePublicEventTheme } from '@/lib/events/publicEventTheme';
import { TOP_NAV_HEIGHT_PX } from '@/lib/layout/headerOffset';
import { PublicNav } from '@/components/public/PublicNav';
import styles from './AppChrome.module.css';

type Session = {
  role: string;
  name: string;
  avatarUrl?: string;
  enabledModules?: string[];
  enabledCapabilities?: string[];
  dashboardVariant?: 'ld-tennis' | 'brainbase-hq' | null;
} | null;

const FONT =
  'var(--font-inter), "Inter", -apple-system, sans-serif';

// Visual treatment for every chrome control lives in AppChrome.module.css
// (semantic app tokens, one hover/active/focus language for both themes).
// Inline styles below are layout only.

// ─── Shared pill nav item ────────────────────────────────────────────────────

function NavItem({
  href,
  label,
  active,
  capability,
}: {
  href: string;
  label: string;
  active: boolean;
  /** Canonical capability id (e.g. 'events' | 'crm') for the ONLY items
      that are genuinely gated by that capability elsewhere in this file
      (the `hasEvents`/`hasCrm` checks the caller already performed to
      decide whether to render this item at all). Omit for every generic/
      HQ/bespoke item — NavItem does not gate on this prop itself, it only
      chooses whether to render CapabilityIcon, so no entitlement logic is
      duplicated here. */
  capability?: string;
}) {
  return (
    <Link
      href={href}
      className={styles.item}
      aria-current={active ? 'page' : undefined}
      style={{
        flexShrink: 0,
      }}
    >
      {capability && (
        <CapabilityIcon
          capability={capability}
          size="sm"
          state={active ? 'active' : 'default'}
          container={false}
        />
      )}
      <span>{label}</span>
    </Link>
  );
}

// ─── HLNA hero item ──────────────────────────────────────────────────────────

function HlnaItem({
  href,
  active,
}: {
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${styles.item} ${styles.hlna}`}
      aria-current={active ? 'page' : undefined}
      style={{
        flexShrink: 0,
      }}
    >
      HLNA
    </Link>
  );
}

// ─── Shared menu behaviour (Operations + Admin) ──────────────────────────────
//
// Both chrome menus are disclosure buttons that reveal a list of links:
// pointer hover still opens them (as before), and they now also open on
// click / Enter / Space / ArrowDown, close on Escape (focus returns to the
// trigger), outside press, focus leaving, scroll or resize, and expose
// aria-expanded. The positioning code stays inside each dropdown (see
// tests/containment/dropdownPanelPortal.test.ts); only dismissal and
// keyboard movement are shared here.

const MENU_WIDTH = 264;

function clampMenuLeft(left: number): number {
  if (typeof window === 'undefined') return left;
  return Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));
}

function menuLinks(panel: HTMLElement | null): HTMLElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>('a[href]')) : [];
}

function useMenuDismissal({
  open,
  setOpen,
  timerRef,
  wrapperRef,
  panelRef,
  triggerRef,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  timerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  useEffect(() => {
    if (!open) return;
    const close = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setOpen(false);
    };
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (!!wrapperRef.current?.contains(target) || !!panelRef.current?.contains(target));
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) close();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const hadFocus = inside(document.activeElement);
      close();
      if (hadFocus) triggerRef.current?.focus();
    };
    const onViewportChange = (e: Event) => {
      // Scrolling inside the menu itself is not a reason to close it.
      if (e.type === 'scroll' && inside(e.target)) return;
      // The fixed panel would be left at stale coordinates. Close it, and
      // never strand keyboard focus on <body> when it was inside the menu.
      const focusInPanel = !!panelRef.current?.contains(document.activeElement);
      close();
      if (focusInPanel) triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, setOpen, timerRef, wrapperRef, panelRef, triggerRef]);
}

/** Arrow / Home / End movement inside an open menu; Tab leaves it in page order. */
function handleMenuKeyDown(
  e: ReactKeyboardEvent<HTMLDivElement>,
  panel: HTMLDivElement | null,
  trigger: HTMLButtonElement | null,
) {
  const links = menuLinks(panel);
  if (links.length === 0) return;
  const index = links.indexOf(document.activeElement as HTMLElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    links[(index + step + links.length) % links.length].focus();
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    links[e.key === 'Home' ? 0 : links.length - 1].focus();
  } else if (e.key === 'Tab') {
    // The panel is portaled to the end of <body>, so native Tab order
    // would leave the page. Hand focus back to the trigger: Shift+Tab
    // stops there, Tab continues to whatever follows the trigger.
    if (e.shiftKey && index <= 0) {
      e.preventDefault();
      trigger?.focus();
    } else if (!e.shiftKey && index === links.length - 1) {
      trigger?.focus();
    }
  }
}

function Chevron() {
  return (
    <svg
      className={styles.chevron}
      width="10"
      height="6"
      viewBox="0 0 10 6"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 1L5 5L9 1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Operations dropdown ─────────────────────────────────────────────────────

const OPS_ITEMS = [
  {
    label: 'Waste',
    href: '/dashboard/wste',
    description:
      'Service verification & tracking',
  },
  {
    label: 'Fleet',
    href: '/dashboard/fleet',
    description:
      'Asset lifecycle & cost analysis',
  },
  {
    label: 'Social',
    href: '/dashboard/social',
    description:
      'Instagram intelligence & sentiment',
  },
  {
    label: 'CRM',
    href: '/crm',
    description:
      'Companies, contacts, deals & activities',
    capabilityKey: 'crm',
  },
];

function OpsDropdown({
  pathname,
  enabledCapabilities,
}: {
  pathname: string;
  enabledCapabilities: string[];
}) {
  const [open, setOpen] =
    useState(false);
  // The panel is portaled to document.body (see below) so its own
  // position must be computed in viewport coordinates rather than
  // relying on CSS `position: absolute` against this wrapper — the
  // centre nav row it lives in has `overflowX: 'auto'` (added for
  // horizontal scroll on a crowded nav), and ANY ancestor with overflow
  // other than 'visible' clips ALL descendants that paint outside its
  // box — including absolutely-positioned ones — regardless of what
  // element establishes their own containing block. A portal is the
  // only fix that is actually robust to this.
  const wrapperRef =
    useRef<HTMLDivElement>(null);
  const triggerRef =
    useRef<HTMLButtonElement>(null);
  const panelRef =
    useRef<HTMLDivElement>(null);
  const focusOnOpen =
    useRef<'first' | 'last' | null>(null);
  // 'hover' menus close when the pointer leaves; a click or key press
  // pins the menu open until Escape, a second click, or a press outside.
  const openedBy =
    useRef<'hover' | 'press' | null>(null);
  const [coords, setCoords] =
    useState<{ top: number; left: number } | null>(
      null,
    );
  const timerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
  const panelId = useId();

  // Items without a capabilityKey are always shown (Waste/Fleet/Social
  // predate the capability system and aren't gated by it); an item with
  // a capabilityKey is shown only once that capability is confirmed
  // enabled for the organisation, so CRM never advertises a dead end to
  // an organisation that doesn't have it.
  const items = OPS_ITEMS.filter(
    item =>
      !item.capabilityKey ||
      enabledCapabilities.includes(
        item.capabilityKey,
      ),
  );

  const isActive = items.some(item =>
    pathname.startsWith(item.href),
  );

  function handleEnter() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    const rect =
      wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({
        top: rect.bottom + 6,
        left: clampMenuLeft(rect.left),
      });
    }
    setOpen(true);
  }

  function handleLeave() {
    if (openedBy.current === 'press') return;
    timerRef.current = setTimeout(
      () => setOpen(false),
      140,
    );
  }

  function close() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setOpen(false);
  }

  function handleTriggerClick(e: ReactMouseEvent<HTMLButtonElement>) {
    if (open && openedBy.current === 'press') {
      close();
      return;
    }
    // detail === 0: activated from the keyboard (Enter / Space).
    if (e.detail === 0) focusOnOpen.current = 'first';
    openedBy.current = 'press';
    handleEnter();
  }

  function handleTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusOnOpen.current = e.key === 'ArrowDown' ? 'first' : 'last';
      if (open) {
        const links = menuLinks(panelRef.current);
        links[e.key === 'ArrowDown' ? 0 : links.length - 1]?.focus();
        focusOnOpen.current = null;
      } else {
        openedBy.current = 'press';
        handleEnter();
      }
    }
  }

  useMenuDismissal({ open, setOpen, timerRef, wrapperRef, panelRef, triggerRef });

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    const links = menuLinks(panelRef.current);
    links[focusOnOpen.current === 'first' ? 0 : links.length - 1]?.focus();
    focusOnOpen.current = null;
  }, [open, coords]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'relative',
        flexShrink: 0,
      }}
      onPointerEnter={e => {
        if (e.pointerType !== 'mouse') return;
        if (!open) openedBy.current = 'hover';
        handleEnter();
      }}
      onPointerLeave={e => {
        if (e.pointerType === 'mouse') handleLeave();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.item}
        data-active={isActive ? 'true' : undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        style={{
          fontFamily: FONT,
        }}
      >
        Operations
        <Chevron />
      </button>

      {open &&
        coords &&
        typeof document !==
          'undefined' &&
        createPortal(
        <div
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          ref={panelRef}
          id={panelId}
          className={styles.menu}
          onKeyDown={e => handleMenuKeyDown(e, panelRef.current, triggerRef.current)}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: MENU_WIDTH,
            minWidth: 220,
            zIndex: 200,
          }}
        >
          <nav aria-label="Operations">
            <ul className={styles.menuList}>
              {items.map(item => {
                const itemActive =
                  pathname.startsWith(
                    item.href,
                  );
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={styles.menuItem}
                      aria-current={itemActive ? 'page' : undefined}
                      onClick={close}
                    >
                      <span className={styles.menuLabel}>
                        {item.label}
                      </span>
                      <span className={styles.menuDescription}>
                        {item.description}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className={styles.menuSeparator} aria-hidden="true" />
            <Link
              href="/dashboards"
              className={styles.menuFooter}
              onClick={close}
            >
              <span>All dashboards</span>
              <span aria-hidden="true">→</span>
            </Link>
          </nav>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Admin dropdown ──────────────────────────────────────────────────────────

const ADMIN_ITEMS = [
  {
    label: 'Organisations',
    href: '/admin/orgs',
    description:
      'Manage accounts & modules',
  },
  {
    label: 'Users',
    href: '/admin/users',
    description:
      'Roles, access & invitations',
  },
  {
    label: 'Client Events',
    href: '/admin/client-events',
    description:
      'Platform-wide event oversight across client organisations',
  },
  {
    label: 'Pipeline',
    href: '/admin/pipeline',
    description:
      'Client requests & issues',
  },
  {
    label: 'Setup',
    href: '/onboarding',
    description:
      'Onboarding & configuration',
  },
];

function AdminDropdown({
  pathname,
}: {
  pathname: string;
}) {
  const [open, setOpen] =
    useState(false);
  // Portaled to document.body — see OpsDropdown above for why a portal
  // (not position: fixed alone) is required to escape the scrolling row.
  const wrapperRef =
    useRef<HTMLDivElement>(null);
  const triggerRef =
    useRef<HTMLButtonElement>(null);
  const panelRef =
    useRef<HTMLDivElement>(null);
  const focusOnOpen =
    useRef<'first' | 'last' | null>(null);
  // 'hover' menus close when the pointer leaves; a click or key press
  // pins the menu open until Escape, a second click, or a press outside.
  const openedBy =
    useRef<'hover' | 'press' | null>(null);
  const [coords, setCoords] =
    useState<{ top: number; left: number } | null>(
      null,
    );
  const timerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
  const panelId = useId();

  const isActive = ADMIN_ITEMS.some(item =>
    pathname.startsWith(item.href),
  );

  function handleEnter() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    const rect =
      wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({
        top: rect.bottom + 6,
        left: clampMenuLeft(rect.left),
      });
    }
    setOpen(true);
  }

  function handleLeave() {
    if (openedBy.current === 'press') return;
    timerRef.current = setTimeout(
      () => setOpen(false),
      140,
    );
  }

  function close() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setOpen(false);
  }

  function handleTriggerClick(e: ReactMouseEvent<HTMLButtonElement>) {
    if (open && openedBy.current === 'press') {
      close();
      return;
    }
    // detail === 0: activated from the keyboard (Enter / Space).
    if (e.detail === 0) focusOnOpen.current = 'first';
    openedBy.current = 'press';
    handleEnter();
  }

  function handleTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusOnOpen.current = e.key === 'ArrowDown' ? 'first' : 'last';
      if (open) {
        const links = menuLinks(panelRef.current);
        links[e.key === 'ArrowDown' ? 0 : links.length - 1]?.focus();
        focusOnOpen.current = null;
      } else {
        openedBy.current = 'press';
        handleEnter();
      }
    }
  }

  useMenuDismissal({ open, setOpen, timerRef, wrapperRef, panelRef, triggerRef });

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    const links = menuLinks(panelRef.current);
    links[focusOnOpen.current === 'first' ? 0 : links.length - 1]?.focus();
    focusOnOpen.current = null;
  }, [open, coords]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'relative',
        flexShrink: 0,
      }}
      onPointerEnter={e => {
        if (e.pointerType !== 'mouse') return;
        if (!open) openedBy.current = 'hover';
        handleEnter();
      }}
      onPointerLeave={e => {
        if (e.pointerType === 'mouse') handleLeave();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.item}
        data-active={isActive ? 'true' : undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        style={{
          fontFamily: FONT,
        }}
      >
        Admin
        <Chevron />
      </button>

      {open &&
        coords &&
        typeof document !==
          'undefined' &&
        createPortal(
        <div
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          ref={panelRef}
          id={panelId}
          className={styles.menu}
          onKeyDown={e => handleMenuKeyDown(e, panelRef.current, triggerRef.current)}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: MENU_WIDTH,
            minWidth: 220,
            zIndex: 200,
          }}
        >
          <nav aria-label="Admin">
            <ul className={styles.menuList}>
              {ADMIN_ITEMS.map(item => {
                const itemActive =
                  pathname.startsWith(
                    item.href,
                  );
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={styles.menuItem}
                      aria-current={itemActive ? 'page' : undefined}
                      onClick={close}
                    >
                      <span className={styles.menuLabel}>
                        {item.label}
                      </span>
                      <span className={styles.menuDescription}>
                        {item.description}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── BRΛINBΛSE logo ──────────────────────────────────────────────────────────

function Logo() {
  // Full lockup on wide screens, the broken-orbit mark alone on narrow
  // ones (AppChrome.module.css swaps them). Both are the approved,
  // theme-aware product geometry; the link carries the accessible name.
  return (
    <Link
      href="/"
      aria-label="BrainBase home"
      className={styles.brand}
    >
      <span className={styles.brandFull} aria-hidden="true">
        <BrainBaseWordmark
          width={136}
        />
      </span>
      <span className={styles.brandMark} aria-hidden="true">
        <BrokenOrbitMark size={24} context="brainbase" />
      </span>
    </Link>
  );
}

// ─── Squad nav item ──────────────────────────────────────────────────────────

function SquadItem({
  active,
}: {
  active: boolean;
}) {
  return (
    <Link
      href="/dashboard/contacts"
      className={styles.item}
      aria-current={active ? 'page' : undefined}
      style={{
        flexShrink: 0,
      }}
    >
      Squad
    </Link>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={className ? `${styles.divider} ${className}` : styles.divider}
    />
  );
}

// ─── Clock ───────────────────────────────────────────────────────────────────

function Clock() {
  const [time, setTime] =
    useState('');
  const [date, setDate] =
    useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();

      setTime(
        now.toLocaleTimeString(
          'en-AU',
          {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          },
        ),
      );

      setDate(
        now.toLocaleDateString(
          'en-AU',
          {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          },
        ),
      );
    };

    tick();

    const id =
      setInterval(tick, 1000);

    return () =>
      clearInterval(id);
  }, []);

  if (!time) return null;

  // Ticking every second: kept out of the accessibility tree so screen
  // readers are not handed a constantly changing string.
  return (
    <div className={styles.clock} aria-hidden="true">
      <span className={styles.clockTime}>
        {time}
      </span>
      <span className={styles.clockDate}>
        {date}
      </span>
    </div>
  );
}

// ─── Theme control ───────────────────────────────────────────────────────────

function ThemeControl() {
  // Same ThemeProvider as the public ThemeToggle (bb-theme persistence and
  // the layout's pre-paint script are unchanged). The icon is chosen by CSS
  // from <html data-theme>, so it is right on first paint.
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={toggleTheme}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <svg
        className={styles.onlyDark}
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
      </svg>
      <svg
        className={styles.onlyLight}
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
      </svg>
    </button>
  );
}

function formatRole(role: string): string {
  const text = role.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ─── Public navigation ───────────────────────────────────────────────────────
// Extracted to components/public/PublicNav.tsx (public-site visual system).
// Same destinations; restyled onto the --bb-* tokens with a theme toggle and
// a mobile menu.

// ─── Authenticated navigation ────────────────────────────────────────────────

function AppNav({
  session,
  pathname,
}: {
  session: NonNullable<Session>;
  pathname: string;
}) {
  const {
    role,
    name,
    avatarUrl,
    enabledCapabilities = [],
    dashboardVariant = null,
  } = session;

  const isSuperAdmin =
    role === 'super_admin';

  // Data Hub 5A.3C.1 — manager+ visibility for the canonical Data Hub
  // import entry, matching the exact same array-membership check
  // app/data/page.tsx's own isAdmin computation already uses for a role
  // gate in this codebase (lib/session.ts's ROLE_ORDER/roleGte is
  // server-only — `import 'server-only'` — and cannot be imported into
  // this client component). Never a new authorization table: the API
  // layer's own requireRole('manager') (identical minimum) remains the
  // real security boundary; this only decides pill visibility.
  const isManagerPlus =
    ['manager', 'admin', 'super_admin'].includes(
      role,
    );

  // Tenant classification reuses the exact same slug-driven resolver
  // app/dashboard/page.tsx already uses to pick between the Founder OS
  // redirect, TennisDashboard, and the generic organisation dashboard
  // (see lib/dashboard/clientDashboard.ts, wired in server-side in
  // app/layout.tsx) — not a second, independent classification system.
  //
  // Previously this branch was chosen by checking whether the caller was
  // a non-super-admin AND had zero rows back from the (separately
  // broken) enabledModules query — since that query always throws and
  // fails closed to an empty array, that old condition was functionally
  // true for every non-super-admin session on every organisation, so
  // every generic tenant (Emma's School Test Organisation included) was
  // silently receiving LD Tennis's bespoke Leads/SquAd/Sessions/
  // Requests/Blog menu.
  const isLdTennis =
    dashboardVariant === 'ld-tennis';

  const isBrainbaseHQ =
    dashboardVariant === 'brainbase-hq';

  const hasEvents =
    enabledCapabilities.includes(
      'events',
    );

  // Phase 6.2 — same capability-driven pattern as hasEvents above.
  // Previously CRM only appeared inside OpsDropdown, which is itself
  // gated on isBrainbaseHQ (see below) — meaning a client organisation
  // with the crm capability enabled had no way to reach CRM from this
  // nav at all, regardless of entitlement. This flag drives a
  // standalone, client-facing NavItem instead; OpsDropdown's own CRM
  // entry (Brainbase HQ's internal ops shortcut) is untouched.
  const hasCrm =
    enabledCapabilities.includes(
      'crm',
    );

  // Phase D.4.4E — same capability-driven pattern as hasEvents/hasCrm
  // above. Organiser is a real, first-class workspace (its own TopNav
  // entry, its own dedicated shell) now that D.4.4C enforces the
  // capability server-side; gated purely on entitlement, never on
  // dashboardVariant/isBrainbaseHQ/role, exactly like Events/CRM.
  const hasOrganiser =
    enabledCapabilities.includes(
      'organiser',
    );

  // Phase C3 — same capability-driven pattern as hasEvents/hasCrm/
  // hasOrganiser above. Originally gated on 'quotes' alone (not a
  // dedicated 'commercial' key — none exists), because Quotes was the
  // only real Commercial transactional workflow that phase built.
  //
  // Phase C7.2 — widened to 'quotes' OR 'invoicing' OR 'purchasing'.
  // app/commercial/layout.tsx (the actual server-side gate this pill
  // links to) already checks all three and only blocks entry when NONE
  // are enabled — this pill had fallen behind that gate, so a
  // purchasing-only organisation (entitled, and able to reach every
  // Purchasing route/page directly) saw no way to discover /commercial
  // from the top nav at all. This is a visibility-only fix: nothing
  // here is a security boundary (the layout and every Commercial route
  // already enforce their own capability checks independently), so
  // widening which capabilities SHOW this pill cannot grant access to
  // anything a viewer couldn't already reach by URL.
  const hasCommercial =
    enabledCapabilities.includes(
      'quotes',
    ) ||
    enabledCapabilities.includes(
      'invoicing',
    ) ||
    enabledCapabilities.includes(
      'purchasing',
    );

  // HR-1 People Foundation — same capability-driven pattern as
  // hasEvents/hasCrm/hasOrganiser/hasCommercial above. Gated purely on
  // the 'people' entitlement, never on role/dashboardVariant — People
  // is a joinable per-organisation module like every other capability
  // here, not a Founder OS/internal tool.
  //
  // HR-2 — `isSuperAdmin ||` reuses this file's own existing
  // isSuperAdmin convention (see above) to mirror the same HR-specific
  // module bypass app/people/layout.tsx and every HR API route under
  // app/api/hr now apply via lib/hr/capability.ts's checkHrCapability()/
  // requireHrCapability() — a super_admin sees this nav item even in an
  // organisation that hasn't enabled People, since the page and every
  // API route behind it are already independently reachable for them
  // regardless of this pill's own visibility. No other capability pill
  // in this file gains a role bypass from this change.
  const hasPeople =
    isSuperAdmin ||
    enabledCapabilities.includes(
      'people',
    );

  const initials = name
    .split(' ')
    .map(
      (p: string) => p[0],
    )
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <nav
      aria-label="Primary"
      className={styles.nav}
      style={{
        height: TOP_NAV_HEIGHT_PX,
        display: 'flex',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        fontFamily: FONT,
        flexShrink: 0,
      }}
    >
      {/* Product lockup — leads the bar, compact, never the loudest element. */}
      <Logo />

      {/* Centre navigation — overflowX auto + flexShrink:0 on every item
          (see each item's own style below) is the smallest fix for a
          crowded/narrow nav: items keep their natural, legible width and
          the row scrolls horizontally instead of squeezing/clipping pill
          text unreadable. Phase B: the scrollbar is now a thin, themed
          one (styles.navRow) rather than hidden, so overflow is
          discoverable when a persona's item set exceeds the width. */}
      <div
        className={styles.navRow}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 2,
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        {isLdTennis ? (
          <>
            {/* LD Tennis keeps its bespoke HLNA entry pointing at
                /dashboard (its own TennisDashboard, not the generic
                /hlna workspace) — audited this phase and left
                unchanged rather than guessed at, since LD Tennis is a
                distinct bespoke product and there's no live LD Tennis
                session available this phase to confirm /hlna's
                tenant-aware chat is even part of its intended flow. */}
            <HlnaItem
              href="/dashboard"
              active={
                pathname ===
                '/dashboard'
              }
            />

            {/*
              Events is a first-class, always-visible pill here (never
              behind a hover-only dropdown) because a client
              organisation's nav — unlike the internal-staff branch
              below — has no Operations dropdown to bury it in at all.
              Gated by the real enabledCapabilities projection, same as
              every other capability-gated entry in this file.
            */}
            {enabledCapabilities.includes(
              'events',
            ) && (
              <NavItem
                href="/events"
                label="Events"
                capability="events"
                active={pathname.startsWith(
                  '/events',
                )}
              />
            )}

            {/* Phase 6.2 — same capability gate as Events immediately
                above; not currently expected to be true for LD Tennis,
                but this branch shouldn't silently hide CRM from a
                client whose org happens to be dashboardVariant
                'ld-tennis' AND has crm enabled — capability-driven,
                never variant-driven. */}
            {hasCrm && (
              <NavItem
                href="/crm"
                label="CRM"
                capability="crm"
                active={pathname.startsWith(
                  '/crm',
                )}
              />
            )}

            {/* Phase D.4.4E — same capability gate as Events/CRM above;
                not currently expected to be true for LD Tennis, but this
                branch shouldn't silently hide Organiser from a client
                whose org happens to be dashboardVariant 'ld-tennis' AND
                has organiser enabled — capability-driven, never
                variant-driven, same rule as Events/CRM. */}
            {hasCommercial && (
              <NavItem
                href="/commercial"
                label="Commercial"
                capability="quotes"
                active={pathname.startsWith(
                  '/commercial',
                )}
              />
            )}

            {hasOrganiser && (
              <NavItem
                href="/organiser"
                label="Organiser"
                capability="organiser"
                active={pathname.startsWith(
                  '/organiser',
                )}
              />
            )}

            {/* HR-1 People Foundation — same capability-gated pattern as
                Organiser/CRM/Commercial above, never role-driven. */}
            {hasPeople && (
              <NavItem
                href="/people"
                label="People"
                capability="people"
                active={pathname.startsWith(
                  '/people',
                )}
              />
            )}

            {/* Data Hub 5A.3C.1 — canonical manager-facing Illegal Dumping
                CSV import experience. Role-gated only (isManagerPlus,
                same minimum as the API layer's own requireRole('manager')),
                never capability-gated — Data Hub has no dedicated
                capability key, matching the backend's own role-only
                authorization. */}
            {isManagerPlus && (
              <NavItem
                href="/data-hub/import"
                label="Data Hub Import"
                active={pathname.startsWith(
                  '/data-hub/import',
                )}
              />
            )}

            {/*
              Leads/Squad(Contacts)/Sessions/Blog are LD Tennis's own
              coaching-business tools (tennis_leads, the "Program"/
              "Session Times" contact fields, the tennis session-type
              catalogue, and the /api/tennis/blog namespace — none of
              this is generic client data). Gated on dashboardVariant,
              the SAME slug-driven resolver app/dashboard/page.tsx
              already uses to render TennisDashboard instead of the
              generic BrainBase shell for this one organisation — not a
              new capability, not a hardcoded organisation id. A generic
              client organisation (e.g. School Test Organisation) never
              matches 'ld-tennis' and correctly never sees these.
            */}
            {isLdTennis && (
              <>
                <NavItem
                  href="/dashboard/leads"
                  label="Leads"
                  active={pathname.startsWith(
                    '/dashboard/leads',
                  )}
                />

                <SquadItem
                  active={pathname.startsWith(
                    '/dashboard/contacts',
                  )}
                />

                <NavItem
                  href="/dashboard/sessions"
                  label="Sessions"
                  active={pathname.startsWith(
                    '/dashboard/sessions',
                  )}
                />
              </>
            )}

            {/*
              Requests (client_pipeline) is a genuine platform-global
              channel — feature requests/issues/feedback from ANY
              BrainBase client to the BrainBase founder, not tied to
              tennis or any other vertical — so it stays visible for
              every client organisation, not just LD Tennis.
            */}
            <NavItem
              href="/dashboard/pipeline"
              label="Requests"
              active={pathname.startsWith(
                '/dashboard/pipeline',
              )}
            />

            {isLdTennis && (
              <NavItem
                href="/dashboard/blog"
                label="Blog"
                active={pathname.startsWith(
                  '/dashboard/blog',
                )}
              />
            )}
          </>
        ) : (
          <>
            {isSuperAdmin && (
              <NavItem
                href="/admin/founder"
                label="Founder OS"
                active={pathname.startsWith(
                  '/admin/founder',
                )}
              />
            )}

            {/* Command Centre, Operations, Reports and Data are
                Brainbase-internal tooling — gated on isBrainbaseHQ
                (super_admin at the Brainbase org specifically), not the
                broader isManager role check every tenant's own
                manager/admin staff also satisfy. Previously gated by
                isManager alone, which couldn't distinguish Brainbase's
                own staff from a client tenant's staff who happen to
                hold the same role — the same class of problem as the
                broken tenant heuristic this phase replaced above — so
                every manager-role client-tenant user (Emma included)
                saw these too. */}
            {isBrainbaseHQ && (
              <NavItem
                href="/command"
                label="Command"
                active={pathname.startsWith(
                  '/command',
                )}
              />
            )}

            {/* Generic tenant dashboard entry — not shown for
                Brainbase HQ super_admin, who already has an
                equivalent entry point via Founder OS above (and
                whose own /dashboard just redirects back to
                /admin/founder). Dashboard and Command Centre
                (/command) are separate concepts; this does not
                replace it. */}
            {!isBrainbaseHQ && (
              <NavItem
                href="/dashboard"
                label="Dashboard"
                active={
                  pathname ===
                  '/dashboard'
                }
              />
            )}

            {/* Canonical HLNA destination is now the dedicated
                /hlna workspace (Phase C.2B), not /dashboard — the
                old link was only ever correct because /dashboard
                used to render the HLNA-flavoured BrainBase shell;
                now that /dashboard is the organisation dashboard
                (Phase C.2C), pointing HLNA at it would land users on
                the wrong page. */}
            <HlnaItem
              href="/hlna"
              active={pathname.startsWith(
                '/hlna',
              )}
            />

            {/* Requests (client_pipeline) is a genuine platform-global
                channel — feature requests/issues/feedback from ANY
                BrainBase client to the BrainBase founder, not tied to
                LD Tennis or any other vertical — so it stays visible
                for every generic client organisation. Restored during
                the D.2.3 origin/main reconciliation: C.2D's rewrite
                had folded it into the isLdTennis-only bundle alongside
                Leads/Squad/Sessions/Blog, silently dropping it for
                every non-LD-Tennis client. Not shown to Brainbase HQ
                staff — they are the request's recipient, not its
                sender — same !isBrainbaseHQ gate as the Dashboard
                entry above. */}
            {!isBrainbaseHQ && (
              <NavItem
                href="/dashboard/pipeline"
                label="Requests"
                active={pathname.startsWith(
                  '/dashboard/pipeline',
                )}
              />
            )}

            {/* Surfaced only once the organisation's real `events`
                capability is confirmed enabled (enabledCapabilities,
                the same trusted m.key = om.module_key projection
                used elsewhere) — never guessed, never hardcoded to a
                specific org. */}
            {hasEvents && (
              <NavItem
                href="/events"
                label="Events & Ticketing"
                capability="events"
                active={pathname.startsWith(
                  '/events',
                )}
              />
            )}

            {/* Phase 6.2 — capability-driven, mirrors the Events item
                immediately above exactly. Never gated on isBrainbaseHQ
                or any organisation id/slug/name — any organisation
                (client or Brainbase HQ) with crm enabled sees it. */}
            {hasCrm && (
              <NavItem
                href="/crm"
                label="CRM"
                capability="crm"
                active={pathname.startsWith(
                  '/crm',
                )}
              />
            )}

            {/* Phase D.4.4E — capability-driven, mirrors the Events/CRM
                items immediately above exactly. Never gated on
                isBrainbaseHQ or any organisation id/slug/name — any
                organisation (client or Brainbase HQ) with organiser
                enabled sees it. Deliberately not inside OpsDropdown
                (which is isBrainbaseHQ-only and would hide Organiser
                from every entitled client tenant) and not a new "Tools"
                dropdown — same direct-top-level-item precedent Phase 6.2
                established for CRM. */}
            {hasCommercial && (
              <NavItem
                href="/commercial"
                label="Commercial"
                capability="quotes"
                active={pathname.startsWith(
                  '/commercial',
                )}
              />
            )}

            {hasOrganiser && (
              <NavItem
                href="/organiser"
                label="Organiser"
                capability="organiser"
                active={pathname.startsWith(
                  '/organiser',
                )}
              />
            )}

            {/* HR-1 People Foundation — same capability-gated pattern as
                Organiser/CRM/Commercial above, never role-driven. */}
            {hasPeople && (
              <NavItem
                href="/people"
                label="People"
                capability="people"
                active={pathname.startsWith(
                  '/people',
                )}
              />
            )}

            {/* Data Hub 5A.3C.1 — canonical manager-facing Illegal Dumping
                CSV import experience. Role-gated only (isManagerPlus, same
                minimum as the API layer's own requireRole('manager')),
                never capability-gated — Data Hub has no dedicated
                capability key, matching the backend's own role-only
                authorization. */}
            {isManagerPlus && (
              <NavItem
                href="/data-hub/import"
                label="Data Hub Import"
                active={pathname.startsWith(
                  '/data-hub/import',
                )}
              />
            )}

            {isSuperAdmin && (
              <NavItem
                href="/clients"
                label="Clients"
                active={pathname.startsWith(
                  '/clients',
                )}
              />
            )}

            {isBrainbaseHQ && (
              <OpsDropdown
                pathname={pathname}
                enabledCapabilities={
                  enabledCapabilities
                }
              />
            )}

            {isBrainbaseHQ && (
              <NavItem
                href="/reports"
                label="Reports"
                active={pathname.startsWith(
                  '/reports',
                )}
              />
            )}

            {isBrainbaseHQ && (
              <NavItem
                href="/data"
                label="Data"
                active={pathname.startsWith(
                  '/data',
                )}
              />
            )}

            {isSuperAdmin && (
              <AdminDropdown
                pathname={pathname}
              />
            )}
          </>
        )}
      </div>

      {/* Far-right system cluster */}
      <div className={styles.rightCluster}>
        <Divider className={styles.clockDivider} />

        <Clock />

        <Divider className={styles.clockDivider} />

        <ThemeControl />

        <Divider />

        <Link
          href="/account/profile"
          className={styles.profile}
          aria-current={
            pathname.startsWith(
              '/account/profile',
            )
              ? 'page'
              : undefined
          }
        >
          <span className={styles.avatar} aria-hidden="true">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-supplied avatar URL, decorative beside the visible name
              <img
                src={avatarUrl}
                alt=""
              />
            ) : (
              initials
            )}
          </span>
          <span className={styles.identity}>
            <span className={styles.identityName}>
              {name.split(' ')[0]}
            </span>
            <span className={styles.identityRole}>
              {formatRole(role)}
            </span>
          </span>
        </Link>

        {/* Organisation Branding (Phase 2) — admin+ only, matching the
            settings page/API's own auth floor exactly (see
            app/api/organisations/branding/route.ts). Inline
            role === 'admin' || role === 'super_admin' check, matching
            this file's own existing isSuperAdmin convention above —
            lib/session.ts's roleGte/ROLE_ORDER are behind a
            'server-only' import and cannot be imported into this
            client component. */}
        {(role === 'admin' || role === 'super_admin') && (
          <Link
            href="/settings/branding"
            className={`${styles.item} ${styles.brandingLink}`}
            aria-current={pathname.startsWith('/settings/branding') ? 'page' : undefined}
          >
            Branding
          </Link>
        )}

        <button
          type="button"
          className={`${styles.item} ${styles.signOut}`}
          onClick={async () => {
            const { logout } =
              await import(
                '@/app/actions/auth'
              );

            await logout();
          }}
          style={{
            fontFamily: FONT,
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────

export default function TopNav({
  serverSession,
}: {
  serverSession?: Session;
}) {
  const [
    fetchedSession,
    setFetchedSession,
  ] = useState<Session>(
    undefined as unknown as Session,
  );

  const pathname =
    usePathname();

  useEffect(() => {
    fetch('/api/me')
      .then(async res => {
        if (
          res.status === 401
        ) {
          return null;
        }

        if (!res.ok) {
          console.warn(
            '[TopNav] /api/me unexpected status:',
            res.status,
          );

          return null;
        }

        return res.json() as Promise<{
          role: string;
          name: string;
          profile?: {
            avatar_url?: string;
          };
          enabledModules?: {
            key: string;
          }[];
          enabledCapabilities?: {
            key: string;
          }[];
          dashboardVariant?:
            | 'ld-tennis'
            | 'brainbase-hq'
            | null;
        }>;
      })
      .then(d => {
        setFetchedSession(
          d?.role
            ? {
                role: d.role,
                name: d.name,
                avatarUrl:
                  d.profile
                    ?.avatar_url ??
                  undefined,
                enabledModules: (
                  d.enabledModules ??
                  []
                ).map(
                  (m: {
                    key: string;
                  }) => m.key,
                ),
                enabledCapabilities: (
                  d.enabledCapabilities ??
                  []
                ).map(
                  (c: {
                    key: string;
                  }) => c.key,
                ),
                dashboardVariant:
                  d.dashboardVariant ??
                  null,
              }
            : null,
        );
      })
      .catch(err => {
        console.warn(
          '[TopNav] /api/me network error:',
          (err as Error)
            .message,
        );

        setFetchedSession(
          null,
        );
      });
  }, []);

  const session =
    serverSession !==
    undefined
      ? serverSession
      : fetchedSession;

  // Public event pages (app/e/[organisationSlug]/**) for an
  // institutional-themed organisation render their OWN branded header
  // (InstitutionalHeader — see components/publicEvents/InstitutionalChrome.tsx)
  // — this site-wide masthead would otherwise stack on top of it,
  // leaving the visitor entering through what looks like a BrainBase
  // marketing page rather than the organisation's own experience. Reuses
  // the exact same resolvePublicEventTheme(organisationSlug) lookup
  // every public-event component already calls — no new theme logic,
  // no duplicated registry. A non-themed organisation's slug resolves to
  // the default theme, so this condition never fires for it and TopNav
  // renders exactly as before (see the DEFAULT_THEME safety requirement
  // this check exists to preserve).
  const publicEventOrgSlug =
    pathname?.match(
      /^\/e\/([^/]+)/,
    )?.[1];

  if (
    pathname?.startsWith(
      '/tennis',
    ) ||
    pathname?.startsWith(
      '/connect',
    ) ||
    (publicEventOrgSlug &&
      resolvePublicEventTheme(
        publicEventOrgSlug,
      ).variant ===
        'institutional')
  ) {
    return null;
  }

  if (
    session === undefined
  ) {
    return null;
  }

  if (!session) {
    return (
      <PublicNav
        pathname={pathname}
      />
    );
  }

  return (
    <AppNav
      session={session}
      pathname={pathname}
    />
  );
}