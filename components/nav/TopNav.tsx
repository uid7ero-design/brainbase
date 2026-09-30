'use client';

import { useState, useRef, useEffect, useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
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
import {
  activeNavId,
  containsActive,
  resolveNav,
  type NavEntry,
  type NavLink,
  type ResolvedNav,
} from './navModel';
import styles from './AppChrome.module.css';

type Session = {
  role: string;
  name: string;
  avatarUrl?: string;
  /** Name of the organisation currently in view (the impersonated one for a
   *  super_admin using the organisation-context bar). Display only. */
  organisationName?: string | null;
  enabledModules?: string[];
  enabledCapabilities?: string[];
  dashboardVariant?: 'ld-tennis' | 'brainbase-hq' | null;
} | null;

const FONT =
  'var(--font-inter), "Inter", -apple-system, sans-serif';

// Authenticated navigation consolidation. WHAT is offered and to WHOM lives
// in ./navModel.ts (one descriptor tree + pure visibility rules, shared with
// the dashboard "Your tools" card). This file only renders that resolved
// tree: one universal path for every organisation — desktop menus and the
// ≤767px mobile menu read the SAME resolved model. No tenant branches.
//
// Visual treatment for every chrome control lives in AppChrome.module.css
// (semantic app tokens, one hover/active/focus language for both themes).
// Inline styles below are layout only.

// ─── Top-level pill ──────────────────────────────────────────────────────────

function NavPill({
  link,
  active,
  hlna = false,
}: {
  link: NavLink;
  active: boolean;
  hlna?: boolean;
}) {
  return (
    <Link
      href={link.href}
      className={hlna ? `${styles.item} ${styles.hlna}` : styles.item}
      aria-current={active ? 'page' : undefined}
      style={{ flexShrink: 0 }}
    >
      {link.label}
    </Link>
  );
}

// ─── Shared menu behaviour ───────────────────────────────────────────────────
//
// Every chrome menu (Work, Manage, Brainbase, Account) is a disclosure button
// that reveals a panel of native links/buttons — not an ARIA menu. Pointer
// hover opens a menu (as the old Operations/Admin menus did); click / Enter /
// Space / ArrowDown pin it open. Escape closes and returns focus to the
// trigger; an outside press, focus leaving, scroll or resize closes it.
// Panels are portaled to document.body with position: fixed so the
// horizontally scrolling nav row can never clip them (see
// tests/containment/dropdownPanelPortal.test.ts).

const MENU_WIDTH = 264;

function clampMenuLeft(left: number, width = MENU_WIDTH): number {
  if (typeof window === 'undefined') return left;
  return Math.max(8, Math.min(left, window.innerWidth - width - 8));
}

const FOCUSABLE = 'a[href], button:not([disabled])';

function menuFocusables(panel: HTMLElement | null): HTMLElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
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
  const items = menuFocusables(panel);
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length].focus();
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    items[e.key === 'Home' ? 0 : items.length - 1].focus();
  } else if (e.key === 'Tab') {
    // The panel is portaled to the end of <body>, so native Tab order
    // would leave the page. Hand focus back to the trigger: Shift+Tab
    // stops there, Tab continues to whatever follows the trigger.
    if (e.shiftKey && index <= 0) {
      e.preventDefault();
      trigger?.focus();
    } else if (!e.shiftKey && index === items.length - 1) {
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

// ─── Generic desktop menu ────────────────────────────────────────────────────

function NavMenu({
  label,
  trigger,
  triggerClassName,
  panelLabel,
  active,
  align = 'start',
  width = MENU_WIDTH,
  children,
}: {
  /** Visible trigger text (omit when `trigger` supplies custom content). */
  label?: string;
  /** Custom trigger content (Account: avatar + identity). */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** Accessible name of the panel's navigation landmark. */
  panelLabel: string;
  /** A destination inside this menu is the current page. */
  active: boolean;
  align?: 'start' | 'end';
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'first' | 'last' | null>(null);
  // 'hover' menus close when the pointer leaves; a click or key press
  // pins the menu open until Escape, a second click, or a press outside.
  const openedBy = useRef<'hover' | 'press' | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  function handleEnter() {
    if (timerRef.current) clearTimeout(timerRef.current);
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({
        top: rect.bottom + 6,
        left: clampMenuLeft(align === 'end' ? rect.right - width : rect.left, width),
      });
    }
    setOpen(true);
  }

  function handleLeave() {
    if (openedBy.current === 'press') return;
    timerRef.current = setTimeout(() => setOpen(false), 140);
  }

  function close() {
    if (timerRef.current) clearTimeout(timerRef.current);
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
        const items = menuFocusables(panelRef.current);
        items[e.key === 'ArrowDown' ? 0 : items.length - 1]?.focus();
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
    const items = menuFocusables(panelRef.current);
    items[focusOnOpen.current === 'first' ? 0 : items.length - 1]?.focus();
    focusOnOpen.current = null;
  }, [open, coords]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', flexShrink: 0 }}
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
        className={triggerClassName ?? styles.item}
        data-active={active ? 'true' : undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        style={{ fontFamily: FONT }}
      >
        {trigger ?? label}
        {/* Not colour alone: a menu holding the current page says so. */}
        {active && <span className={styles.srOnly}> (current section)</span>}
        <Chevron />
      </button>

      {open &&
        coords &&
        typeof document !== 'undefined' &&
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
              width,
              minWidth: 220,
              zIndex: 200,
            }}
          >
            <nav aria-label={panelLabel}>
              <MenuPanelBody render={children} close={close} />
            </nav>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Calls a NavMenu's render prop from its own component, so `close` (which
 *  touches refs) is handed on as a prop rather than invoked in NavMenu's
 *  render. */
function MenuPanelBody({
  render,
  close,
}: {
  render: (close: () => void) => ReactNode;
  close: () => void;
}) {
  return <>{render(close)}</>;
}

// ─── Menu contents (shared by desktop menus and the mobile menu) ─────────────

function MenuLink({
  link,
  activeId,
  onNavigate,
  withIcon = false,
}: {
  link: NavLink;
  activeId: string | null;
  onNavigate: () => void;
  withIcon?: boolean;
}) {
  const active = link.id === activeId;
  return (
    <li>
      <Link
        href={link.href}
        className={styles.menuItem}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
      >
        <span className={styles.menuLabelRow}>
          {withIcon && link.icon && (
            <CapabilityIcon
              capability={link.icon}
              size="sm"
              state={active ? 'active' : 'default'}
              container={false}
            />
          )}
          <span className={styles.menuLabel}>{link.label}</span>
        </span>
        {link.description && (
          <span className={styles.menuDescription}>{link.description}</span>
        )}
      </Link>
    </li>
  );
}

function MenuEntries({
  entries,
  activeId,
  onNavigate,
  withIcons = false,
}: {
  entries: readonly NavEntry[];
  activeId: string | null;
  onNavigate: () => void;
  withIcons?: boolean;
}) {
  const groupHeadingBase = useId();
  const links = entries.filter((e): e is NavLink => e.kind === 'link');
  const groups = entries.filter(e => e.kind === 'group');
  return (
    <>
      {links.length > 0 && (
        <ul className={styles.menuList}>
          {links.map(link => (
            <MenuLink
              key={link.id}
              link={link}
              activeId={activeId}
              onNavigate={onNavigate}
              withIcon={withIcons}
            />
          ))}
        </ul>
      )}
      {groups.map(group =>
        group.kind === 'group' ? (
          <div key={group.id} className={styles.menuGroup}>
            <div className={styles.menuSeparator} aria-hidden="true" />
            <p id={`${groupHeadingBase}-${group.id}`} className={styles.menuGroupLabel}>
              {group.label}
            </p>
            <ul className={styles.menuList} aria-labelledby={`${groupHeadingBase}-${group.id}`}>
              {group.children.map(link => (
                <MenuLink key={link.id} link={link} activeId={activeId} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </>
  );
}

// ─── BrandMark (canonical BRΛINBΛSE lockup) ──────────────────────────────────

function BrandMark() {
  // The one product lockup this header renders — width 124px at rest
  // (118–130px range), shrinking via the .wordmark class's own responsive
  // overrides at the 960–1279 and <640 bands (AppChrome.module.css). The
  // link itself is the >=44px click target; the mark inside is decorative,
  // the link carries the accessible name.
  return (
    <Link
      href="/"
      aria-label="BrainBase home"
      className={styles.brand}
    >
      <span className={styles.brandFull} aria-hidden="true">
        <BrainBaseWordmark
          width={140}
          className={styles.wordmark}
        />
      </span>
      <span className={styles.brandMark} aria-hidden="true">
        <BrokenOrbitMark size={24} context="brainbase" />
      </span>
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

function ThemeMenuItem() {
  // Same ThemeProvider as the public ThemeToggle (bb-theme persistence and
  // the layout's pre-paint script are unchanged). The icon is chosen by CSS
  // from <html data-theme>, so it is right on first paint.
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <li>
      <button
        type="button"
        className={styles.menuButton}
        onClick={toggleTheme}
        aria-label={`Switch to ${next} theme`}
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
        <span className={styles.menuLabel}>
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </span>
      </button>
    </li>
  );
}

function SignOutMenuItem() {
  return (
    <li>
      <button
        type="button"
        className={`${styles.menuButton} ${styles.signOut}`}
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
        <span className={styles.menuLabel}>Sign out</span>
      </button>
    </li>
  );
}

function formatRole(role: string): string {
  const text = role.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Identity = {
  name: string;
  role: string;
  initials: string;
  avatarUrl?: string;
  organisationName: string | null;
};

function Avatar({ identity }: { identity: Identity }) {
  return (
    <span className={styles.avatar} aria-hidden="true">
      {identity.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-supplied avatar URL, decorative beside the visible name
        <img
          src={identity.avatarUrl}
          alt=""
        />
      ) : (
        identity.initials
      )}
    </span>
  );
}

/** Who is signed in and which organisation is in view — the Account menu's
 *  heading, shared by the desktop and mobile menus. */
function AccountSummary({ identity }: { identity: Identity }) {
  return (
    <div className={styles.accountSummary}>
      <span className={styles.accountName}>{identity.name}</span>
      <span className={styles.accountMeta}>{formatRole(identity.role)}</span>
      {identity.organisationName && (
        <span className={styles.accountOrg}>
          <span className={styles.accountOrgLabel}>Organisation</span>
          {identity.organisationName}
        </span>
      )}
    </div>
  );
}

function AccountEntries({
  nav,
  activeId,
  onNavigate,
}: {
  nav: ResolvedNav;
  activeId: string | null;
  onNavigate: () => void;
}) {
  return (
    <ul className={styles.menuList}>
      <MenuLink link={nav.account.profile} activeId={activeId} onNavigate={onNavigate} />
      <ThemeMenuItem />
      <SignOutMenuItem />
    </ul>
  );
}

// ─── Mobile menu (≤767px) ────────────────────────────────────────────────────
//
// The same resolved tree as the desktop menus, in one panel under the bar.
// Focus moves into the panel on open, Tab / Shift+Tab stay inside it while
// it is open, Escape or an outside press closes it and focus returns to the
// Menu button, and choosing a destination closes it.

function MobileMenu({
  nav,
  activeId,
  identity,
}: {
  nav: ResolvedNav;
  activeId: string | null;
  identity: Identity;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const pathname = usePathname();
  // The panel is open only on the path it was opened on, so a client-side
  // navigation closes it without a state reset in an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null);

  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menuFocusables(panelRef.current)[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpenOn(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpenOn(null);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = menuFocusables(panelRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onResize = () => {
      if (window.innerWidth > 767) setOpenOn(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const onNavigate = () => close(false);
  const topLinks = [nav.home, nav.hlna, ...(nav.requests ? [nav.requests] : [])];

  return (
    <div className={styles.mobileOnly}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.item} ${styles.mobileTrigger}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        style={{ fontFamily: FONT }}
      >
        <Avatar identity={identity} />
        <span>Menu</span>
        <Chevron />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            className={styles.mobilePanel}
            style={{ top: TOP_NAV_HEIGHT_PX }}
          >
            <nav aria-label="Main menu">
              <AccountSummary identity={identity} />
              <ul className={styles.menuList}>
                {topLinks.map(link => (
                  <MenuLink key={link.id} link={link} activeId={activeId} onNavigate={onNavigate} />
                ))}
              </ul>
              {nav.work.length > 0 && (
                <MobileSection title="Work">
                  <MenuEntries entries={nav.work} activeId={activeId} onNavigate={onNavigate} withIcons />
                </MobileSection>
              )}
              {nav.manage.length > 0 && (
                <MobileSection title="Manage">
                  <MenuEntries entries={nav.manage} activeId={activeId} onNavigate={onNavigate} />
                </MobileSection>
              )}
              {nav.brainbase.length > 0 && (
                <MobileSection title="Brainbase">
                  <MenuEntries entries={nav.brainbase} activeId={activeId} onNavigate={onNavigate} />
                </MobileSection>
              )}
              <MobileSection title="Account">
                <AccountEntries nav={nav} activeId={activeId} onNavigate={onNavigate} />
              </MobileSection>
            </nav>
          </div>,
          document.body,
        )}
    </div>
  );
}

function MobileSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className={styles.mobileSection} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.mobileSectionTitle}>{title}</h2>
      {children}
    </section>
  );
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
    organisationName = null,
    enabledCapabilities = [],
    dashboardVariant = null,
  } = session;

  // `role` is the REAL signed-in role (an impersonating super_admin stays
  // super_admin); capabilities and the dashboard variant describe the
  // organisation in view — app/layout.tsx resolves both server-side. The
  // model turns them into the visible tree; nothing here re-derives access.
  const nav = resolveNav({ role, enabledCapabilities, dashboardVariant });
  const activeId = activeNavId(nav, pathname);

  const identity: Identity = {
    name,
    role,
    avatarUrl,
    organisationName,
    initials: name
      .split(' ')
      .map((p: string) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase(),
  };

  return (
    <nav
      aria-label="Primary"
      className={styles.nav}
      style={{
        height: TOP_NAV_HEIGHT_PX,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        fontFamily: FONT,
        flexShrink: 0,
      }}
    >
      {/* Three-zone row: BrandMark / PrimaryNav / right-side controls.
          Width-constrained and centred independently of .nav's own
          edge-to-edge surface — see .navInner (AppChrome.module.css). */}
      <div className={styles.navInner}>
        {/* Product lockup — leads the bar, compact, never the loudest element. */}
        <BrandMark />

        {/* Centre navigation (desktop). A handful of permanent items; modules
            live inside Work, so the row no longer grows with every module.
            overflowX stays as a safety net for very narrow desktop widths. */}
        <div
          className={`${styles.navRow} ${styles.desktopOnly}`}
          // No inline display: .desktopOnly supplies flex and must be able to
          // hide the row below the mobile-Menu breakpoint (an inline display
          // would override it).
          style={{
            justifyContent: 'center',
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
          }}
        >
          <NavPill link={nav.home} active={activeId === nav.home.id} />
          <NavPill link={nav.hlna} active={activeId === nav.hlna.id} hlna />

          {nav.work.length > 0 && (
            <NavMenu label="Work" panelLabel="Work" active={containsActive(nav.work, activeId)}>
              {close => <MenuEntries entries={nav.work} activeId={activeId} onNavigate={close} withIcons />}
            </NavMenu>
          )}

          {nav.requests && (
            <NavPill link={nav.requests} active={activeId === nav.requests.id} />
          )}

          {nav.manage.length > 0 && (
            <NavMenu label="Manage" panelLabel="Manage" active={containsActive(nav.manage, activeId)}>
              {close => <MenuEntries entries={nav.manage} activeId={activeId} onNavigate={close} />}
            </NavMenu>
          )}

          {nav.brainbase.length > 0 && (
            <NavMenu label="Brainbase" panelLabel="Brainbase" active={containsActive(nav.brainbase, activeId)}>
              {close => <MenuEntries entries={nav.brainbase} activeId={activeId} onNavigate={close} />}
            </NavMenu>
          )}
        </div>

        <div className={`${styles.spacer} ${styles.mobileOnly}`} aria-hidden="true" />

        {/* Right-side controls: UtilityMeta (clock) → divider → AccountControl.
            OrganisationSwitcher (super_admin only) is a separate element
            rendered immediately before this whole header — see
            app/layout.tsx and components/admin/OrgSwitcher.tsx's own
            visual-integration styling. */}
        <div className={styles.rightCluster}>
          <Clock />

          <Divider className={styles.clockDivider} />

          <div className={styles.desktopOnly}>
            <NavMenu
              panelLabel="Account"
              align="end"
              triggerClassName={styles.profile}
              active={activeId === nav.account.profile.id}
              trigger={
                <>
                  <Avatar identity={identity} />
                  <span className={styles.identity}>
                    <span className={styles.identityName}>
                      {name.split(' ')[0]}
                    </span>
                    {/* Not rendered in the flex column; keeps the accessible
                        name "Sam Admin", not "SamAdmin". */}
                    {' '}
                    <span className={styles.identityRole}>
                      {formatRole(role)}
                    </span>
                  </span>
                  <span className={styles.srOnly}>, account menu</span>
                </>
              }
            >
              {close => (
                <>
                  <AccountSummary identity={identity} />
                  <AccountEntries nav={nav} activeId={activeId} onNavigate={close} />
                </>
              )}
            </NavMenu>
          </div>

          <MobileMenu nav={nav} activeId={activeId} identity={identity} />
        </div>
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
