'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

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

// ─── Shared pill nav item ────────────────────────────────────────────────────

function NavItem({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: '-0.01em',
        padding: '5px 10px',
        borderRadius: 7,
        textDecoration: 'none',
        color: active
          ? '#C4B5FD'
          : 'rgba(255,255,255,.45)',
        background: active
          ? 'rgba(139,92,246,.10)'
          : 'transparent',
        border: `1px solid ${
          active
            ? 'rgba(139,92,246,.22)'
            : 'transparent'
        }`,
        transition:
          'color .14s, background .14s, border-color .14s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        if (active) return;

        e.currentTarget.style.color =
          'rgba(255,255,255,.85)';

        e.currentTarget.style.background =
          'rgba(255,255,255,.05)';
      }}
      onMouseLeave={e => {
        if (active) return;

        e.currentTarget.style.color =
          'rgba(255,255,255,.45)';

        e.currentTarget.style.background =
          'transparent';
      }}
    >
      {label}
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
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '5px 11px',
        borderRadius: 7,
        textDecoration: 'none',
        background: active
          ? 'rgba(139,92,246,.13)'
          : 'transparent',
        border: `1px solid ${
          active
            ? 'rgba(167,139,250,.28)'
            : 'transparent'
        }`,
        boxShadow: active
          ? '0 0 14px rgba(139,92,246,.18)'
          : 'none',
        transition: 'all .18s',
      }}
      onMouseEnter={e => {
        if (active) return;

        e.currentTarget.style.background =
          'rgba(139,92,246,.07)';

        e.currentTarget.style.borderColor =
          'rgba(167,139,250,.14)';
      }}
      onMouseLeave={e => {
        if (active) return;

        e.currentTarget.style.background =
          'transparent';

        e.currentTarget.style.borderColor =
          'transparent';
      }}
    >
      <svg
        width="46"
        height="14"
        viewBox="0 0 211 62"
        style={{
          display: 'block',
          filter: active
            ? 'drop-shadow(0 0 7px rgba(167,139,250,.60))'
            : 'none',
          opacity: active ? 1 : 0.6,
          transition:
            'filter .18s, opacity .18s',
        }}
        aria-label="HLNA"
      >
        <g fill="rgba(245,247,250,0.95)">
          <path d="M28.59 48L21.81 48L21.81 10.17L28.59 10.17L28.59 25.81L46.18 25.81L46.18 10.17L52.96 10.17L52.96 48L46.18 48L46.18 31.52L28.59 31.52L28.59 48Z" />

          <path d="M93.07 48L69.58 48L69.58 10.17L76.36 10.17L76.36 42.29L93.07 42.29L93.07 48Z" />

          <path d="M114.89 48L107.98 48L107.98 10.17L115.65 10.17L128.73 31.01Q129.54 32.31 130.45 33.95Q131.37 35.58 132.36 37.59L132.36 37.59Q132.87 38.66 133.37 39.80L133.37 39.80Q133.30 38.76 133.25 37.69L133.25 37.69Q133.09 35.46 133.03 33.44Q132.97 31.42 132.97 30.02L132.97 30.02L132.97 10.17L139.85 10.17L139.85 48L132.15 48L120.35 29.24Q119.23 27.43 118.24 25.68Q117.25 23.93 116.11 21.72L116.11 21.72Q115.37 20.27 114.41 18.47L114.41 18.47Q114.51 20.10 114.58 21.62L114.58 21.62Q114.71 24.11 114.80 26.06Q114.89 28.02 114.89 29.21L114.89 29.21L114.89 48Z" />
        </g>

        <path
          d="M 153,48 L 172,7 L 191,48"
          fill="none"
          stroke="url(#tnav-lg)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <defs>
          <linearGradient
            id="tnav-lg"
            gradientUnits="userSpaceOnUse"
            x1="172"
            y1="48"
            x2="172"
            y2="7"
          >
            <stop
              offset="0%"
              stopColor="#6D28D9"
            />

            <stop
              offset="100%"
              stopColor="#C084FC"
            />
          </linearGradient>
        </defs>
      </svg>
    </Link>
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

  // Hotfix (founder nav dropdown clipping, ported from
  // hotfix/founder-nav-dropdown-clipping commit 26d4596): render the
  // panel position:'fixed' from the trigger's own measured screen
  // position rather than position:'absolute' relative to this wrapper.
  // Fixed positioning lays out against the viewport, not this (or any)
  // ancestor, so it can't be clipped by any overflow constraint an
  // ancestor row does or later comes to have.
  const [panelPos, setPanelPos] =
    useState<{ top: number; left: number } | null>(null);

  const triggerRef =
    useRef<HTMLDivElement | null>(null);

  const timerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

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

    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPanelPos({ top: rect.bottom + 10, left: rect.left });
    }

    setOpen(true);
  }

  function handleLeave() {
    timerRef.current = setTimeout(
      () => setOpen(false),
      140,
    );
  }

  return (
    <div
      ref={triggerRef}
      style={{
        position: 'relative',
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          padding: '5px 10px',
          borderRadius: 7,

          color: isActive
            ? '#C4B5FD'
            : open
              ? 'rgba(255,255,255,.85)'
              : 'rgba(255,255,255,.45)',

          background: isActive
            ? 'rgba(139,92,246,.10)'
            : open
              ? 'rgba(255,255,255,.05)'
              : 'transparent',

          border: `1px solid ${
            isActive
              ? 'rgba(139,92,246,.22)'
              : 'transparent'
          }`,

          cursor: 'pointer',
          fontFamily: FONT,
          transition:
            'color .14s, background .14s',
          whiteSpace: 'nowrap',
        }}
      >
        Operations

        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          style={{
            opacity: 0.45,
            transform: open
              ? 'rotate(180deg)'
              : 'rotate(0deg)',
            transition:
              'transform .18s',
          }}
        >
          <path
            d="M1 1L5 5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && panelPos && (
        <div
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          style={{
            position: 'fixed',
            top: panelPos.top,
            left: panelPos.left,
            background:
              'rgba(7,5,16,.98)',
            border:
              '1px solid rgba(255,255,255,.09)',
            borderRadius: 11,
            padding: 5,
            minWidth: 220,
            boxShadow:
              '0 12px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.04)',
            zIndex: 200,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -5,
              left: 18,
              width: 8,
              height: 8,
              background:
                'rgba(7,5,16,.98)',
              border:
                '1px solid rgba(255,255,255,.09)',
              borderRight: 'none',
              borderBottom: 'none',
              transform:
                'rotate(45deg)',
            }}
          />

          {items.map(item => {
            const itemActive =
              pathname.startsWith(
                item.href,
              );

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  flexDirection:
                    'column',
                  gap: 2,
                  padding:
                    '9px 13px',
                  borderRadius: 8,
                  textDecoration:
                    'none',
                  background:
                    itemActive
                      ? 'rgba(139,92,246,.10)'
                      : 'transparent',
                  transition:
                    'background .12s',
                }}
                onMouseEnter={e => {
                  if (!itemActive) {
                    e.currentTarget.style.background =
                      'rgba(255,255,255,.05)';
                  }
                }}
                onMouseLeave={e => {
                  if (!itemActive) {
                    e.currentTarget.style.background =
                      'transparent';
                  }
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    letterSpacing:
                      '-0.01em',
                    color:
                      itemActive
                        ? '#C4B5FD'
                        : 'rgba(255,255,255,.80)',
                  }}
                >
                  {item.label}
                </span>

                <span
                  style={{
                    fontSize: 11,
                    color:
                      'rgba(255,255,255,.30)',
                    lineHeight: 1.4,
                  }}
                >
                  {item.description}
                </span>
              </Link>
            );
          })}

          <div
            style={{
              height: 1,
              background:
                'rgba(255,255,255,.07)',
              margin:
                '4px 4px 3px',
            }}
          />

          <Link
            href="/dashboards"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                'space-between',
              padding:
                '8px 13px',
              borderRadius: 8,
              textDecoration: 'none',
              transition:
                'background .12s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background =
                'rgba(255,255,255,.05)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background =
                'transparent';
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color:
                  'rgba(255,255,255,.38)',
                letterSpacing:
                  '-0.01em',
              }}
            >
              All dashboards
            </span>

            <span
              style={{
                fontSize: 11,
                color:
                  'rgba(255,255,255,.22)',
              }}
            >
              →
            </span>
          </Link>
        </div>
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

  // Hotfix (founder nav dropdown clipping, ported from
  // hotfix/founder-nav-dropdown-clipping commit 26d4596) — same fix as
  // OpsDropdown above: position:'fixed' from a measured trigger rect
  // instead of position:'absolute', so the panel can't be clipped by
  // any ancestor overflow constraint.
  const [panelPos, setPanelPos] =
    useState<{ top: number; left: number } | null>(null);

  const triggerRef =
    useRef<HTMLDivElement | null>(null);

  const timerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  const isActive = ADMIN_ITEMS.some(
    item =>
      pathname.startsWith(
        item.href,
      ),
  );

  function handleEnter() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPanelPos({ top: rect.bottom + 10, left: rect.left });
    }

    setOpen(true);
  }

  function handleLeave() {
    timerRef.current =
      setTimeout(
        () => setOpen(false),
        140,
      );
  }

  return (
    <div
      ref={triggerRef}
      style={{
        position: 'relative',
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          padding: '5px 10px',
          borderRadius: 7,

          color: isActive
            ? '#C4B5FD'
            : open
              ? 'rgba(255,255,255,.85)'
              : 'rgba(255,255,255,.45)',

          background: isActive
            ? 'rgba(139,92,246,.10)'
            : open
              ? 'rgba(255,255,255,.05)'
              : 'transparent',

          border: `1px solid ${
            isActive
              ? 'rgba(139,92,246,.22)'
              : 'transparent'
          }`,

          cursor: 'pointer',
          fontFamily: FONT,
          transition:
            'color .14s, background .14s',
          whiteSpace: 'nowrap',
        }}
      >
        Admin

        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          style={{
            opacity: 0.45,
            transform: open
              ? 'rotate(180deg)'
              : 'rotate(0deg)',
            transition:
              'transform .18s',
          }}
        >
          <path
            d="M1 1L5 5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && panelPos && (
        <div
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          style={{
            position: 'fixed',
            top: panelPos.top,
            left: panelPos.left,
            background:
              'rgba(7,5,16,.98)',
            border:
              '1px solid rgba(255,255,255,.09)',
            borderRadius: 11,
            padding: 5,
            minWidth: 220,
            boxShadow:
              '0 12px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.04)',
            zIndex: 200,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -5,
              left: 18,
              width: 8,
              height: 8,
              background:
                'rgba(7,5,16,.98)',
              border:
                '1px solid rgba(255,255,255,.09)',
              borderRight: 'none',
              borderBottom: 'none',
              transform:
                'rotate(45deg)',
            }}
          />

          {ADMIN_ITEMS.map(item => {
            const itemActive =
              pathname.startsWith(
                item.href,
              );

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  flexDirection:
                    'column',
                  gap: 2,
                  padding:
                    '9px 13px',
                  borderRadius: 8,
                  textDecoration:
                    'none',
                  background:
                    itemActive
                      ? 'rgba(139,92,246,.10)'
                      : 'transparent',
                  transition:
                    'background .12s',
                }}
                onMouseEnter={e => {
                  if (!itemActive) {
                    e.currentTarget.style.background =
                      'rgba(255,255,255,.05)';
                  }
                }}
                onMouseLeave={e => {
                  if (!itemActive) {
                    e.currentTarget.style.background =
                      'transparent';
                  }
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    letterSpacing:
                      '-0.01em',
                    color:
                      itemActive
                        ? '#C4B5FD'
                        : 'rgba(255,255,255,.80)',
                  }}
                >
                  {item.label}
                </span>

                <span
                  style={{
                    fontSize: 11,
                    color:
                      'rgba(255,255,255,.30)',
                    lineHeight: 1.4,
                  }}
                >
                  {item.description}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── BRΛINBΛSE logo ──────────────────────────────────────────────────────────

function Logo({
  compact = false,
}: {
  compact?: boolean;
}) {
  const visualWidth =
    compact ? 170 : 180;

  return (
    <Link
      href="/"
      aria-label="BRΛINBΛSE home"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textDecoration: 'none',
        flexShrink: 0,
        overflow: 'visible',
      }}
    >
      <Image
        src="/Brand/brainbase-logo-dark.svg"
        alt="BRΛINBΛSE"
        width={300}
        height={68}
        priority
        style={{
          display: 'block',
          width: visualWidth,
          height: 'auto',
          maxWidth: 'none',

          /*
            Compensates for whitespace
            inside the SVG artwork.
          */
          transform: compact
            ? 'scale(1.10)'
            : 'none',

          transformOrigin:
            'center center',
        }}
      />
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
      style={{
        display: 'flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: '-0.01em',
        padding: '5px 10px',
        borderRadius: 7,
        textDecoration: 'none',
        color: active
          ? '#C4B5FD'
          : 'rgba(255,255,255,.45)',
        background: active
          ? 'rgba(139,92,246,.10)'
          : 'transparent',
        border: `1px solid ${
          active
            ? 'rgba(139,92,246,.22)'
            : 'transparent'
        }`,
        transition:
          'color .14s, background .14s, border-color .14s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        if (active) return;

        e.currentTarget.style.color =
          'rgba(255,255,255,.85)';

        e.currentTarget.style.background =
          'rgba(255,255,255,.05)';
      }}
      onMouseLeave={e => {
        if (active) return;

        e.currentTarget.style.color =
          'rgba(255,255,255,.45)';

        e.currentTarget.style.background =
          'transparent';
      }}
    >
      {'Squ'}

      <svg
        width="9"
        height="11"
        viewBox="153 7 38 41"
        style={{
          display: 'inline',
          verticalAlign: 'middle',
          margin: '0 1px',
          flexShrink: 0,
        }}
      >
        <defs>
          <linearGradient
            id="squad-lg"
            gradientUnits="userSpaceOnUse"
            x1="172"
            y1="48"
            x2="172"
            y2="7"
          >
            <stop
              offset="0%"
              stopColor="#6D28D9"
            />

            <stop
              offset="100%"
              stopColor="#C084FC"
            />
          </linearGradient>
        </defs>

        <path
          d="M 153,48 L 172,7 L 191,48"
          fill="none"
          stroke="url(#squad-lg)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {'d'}
    </Link>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider() {
  return (
    <div
      style={{
        width: 1,
        height: 16,
        background:
          'rgba(255,255,255,.08)',
        flexShrink: 0,
      }}
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

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontFamily:
          'var(--font-geist-mono,"Geist Mono",monospace)',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color:
            'rgba(255,255,255,.55)',
          letterSpacing: '.04em',
        }}
      >
        {time}
      </span>

      <span
        style={{
          fontSize: 10,
          color:
            'rgba(255,255,255,.22)',
          letterSpacing: '.04em',
        }}
      >
        {date}
      </span>
    </div>
  );
}

// ─── Public navigation ───────────────────────────────────────────────────────

function PublicNav({
  pathname,
}: {
  pathname: string;
}) {
  return (
    <nav
      style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent:
          'space-between',
        padding: '0 28px',
        borderBottom:
          '1px solid rgba(255,255,255,.06)',
        background:
          'rgba(7,8,11,.92)',
        backdropFilter:
          'blur(16px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        fontFamily: FONT,
        flexShrink: 0,
      }}
    >
      <Logo />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <NavItem
          href="/#product"
          label="Product"
          active={false}
        />

        <NavItem
          href="/client-operations"
          label="Client Operations"
          active={pathname.startsWith(
            '/client-operations',
          )}
        />

        <NavItem
          href="/web-systems"
          label="Web Systems"
          active={pathname.startsWith(
            '/web-systems',
          )}
        />

        <NavItem
          href="/pricing"
          label="Pricing"
          active={pathname.startsWith(
            '/pricing',
          )}
        />

        <NavItem
          href="/demo"
          label="Demo"
          active={
            pathname === '/demo'
          }
        />

        <Divider />

        <NavItem
          href="/login"
          label="Login"
          active={
            pathname === '/login'
          }
        />

        <Link
          href="/request-demo"
          style={{
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            background:
              'linear-gradient(135deg, #6D28D9, #A78BFA)',
            color: '#fff',
            padding:
              '6px 14px',
            borderRadius: 8,
            letterSpacing: '.01em',
            transition:
              'opacity .15s',
            marginLeft: 4,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.opacity =
              '0.88';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.opacity =
              '1';
          }}
        >
          Get Started
        </Link>
      </div>
    </nav>
  );
}

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
      style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        borderBottom:
          '1px solid rgba(255,255,255,.06)',
        background:
          'rgba(7,8,11,.92)',
        backdropFilter:
          'blur(16px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        fontFamily: FONT,
        flexShrink: 0,
        gap: 16,
      }}
    >
      {/* Left balance spacer */}
      <div
        aria-hidden="true"
        style={{
          width: 150,
          flexShrink: 0,
        }}
      />

      {/* Centre navigation */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          flex: 1,
          minWidth: 0,
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

            <NavItem
              href="/dashboard/pipeline"
              label="Requests"
              active={pathname.startsWith(
                '/dashboard/pipeline',
              )}
            />

            <NavItem
              href="/dashboard/blog"
              label="Blog"
              active={pathname.startsWith(
                '/dashboard/blog',
              )}
            />
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

            {/* Surfaced only once the organisation's real `events`
                capability is confirmed enabled (enabledCapabilities,
                the same trusted m.key = om.module_key projection
                used elsewhere) — never guessed, never hardcoded to a
                specific org. */}
            {hasEvents && (
              <NavItem
                href="/events"
                label="Events & Ticketing"
                active={pathname.startsWith(
                  '/events',
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent:
            'flex-end',
          gap: 10,
          flexShrink: 0,
        }}
      >
        {/* Larger BRΛINBΛSE mark */}
        <div
          style={{
            width: 185,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'visible',
          }}
        >
          <Logo compact />
        </div>

        <Divider />

        <Clock />

        <Divider />

        <Link
          href="/account/profile"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            textDecoration: 'none',
            padding:
              '4px 8px 4px 5px',
            borderRadius: 20,
            transition: 'all .15s',
            background:
              pathname.startsWith(
                '/account/profile',
              )
                ? 'rgba(167,139,250,.10)'
                : 'transparent',

            border: `1px solid ${
              pathname.startsWith(
                '/account/profile',
              )
                ? 'rgba(167,139,250,.22)'
                : 'transparent'
            }`,
          }}
          onMouseEnter={e => {
            if (
              pathname.startsWith(
                '/account/profile',
              )
            ) {
              return;
            }

            e.currentTarget.style.background =
              'rgba(255,255,255,.05)';

            e.currentTarget.style.borderColor =
              'rgba(255,255,255,.08)';
          }}
          onMouseLeave={e => {
            if (
              pathname.startsWith(
                '/account/profile',
              )
            ) {
              return;
            }

            e.currentTarget.style.background =
              'transparent';

            e.currentTarget.style.borderColor =
              'transparent';
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              flexShrink: 0,

              background:
                avatarUrl
                  ? 'transparent'
                  : 'linear-gradient(135deg, #6D28D9, #A78BFA)',

              display: 'flex',
              alignItems: 'center',
              justifyContent:
                'center',

              fontSize: 10,
              fontWeight: 700,
              color: '#fff',
              overflow: 'hidden',
              letterSpacing: '.02em',
            }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="avatar"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              initials
            )}
          </div>

          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color:
                'rgba(245,247,250,.65)',
              whiteSpace: 'nowrap',
            }}
          >
            {name.split(' ')[0]}
          </span>
        </Link>

        <Divider />

        <button
          onClick={async () => {
            const { logout } =
              await import(
                '@/app/actions/auth'
              );

            await logout();
          }}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 13,
            fontWeight: 500,
            color:
              'rgba(255,255,255,.28)',
            cursor: 'pointer',
            fontFamily: FONT,
            padding: '5px 8px',
            borderRadius: 7,
            transition:
              'color .14s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color =
              'rgba(255,255,255,.65)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color =
              'rgba(255,255,255,.28)';
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

  if (
    pathname?.startsWith(
      '/tennis',
    ) ||
    pathname?.startsWith(
      '/connect',
    )
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