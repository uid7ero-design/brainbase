import type { CSSProperties } from 'react';
import { CalendarClock, LayoutGrid, Ticket, Users } from 'lucide-react';

// Phase D.4 — live production call sites: components/dashboard/
// ModuleAccessCard.tsx (full container treatment) and, since D.4.2,
// components/nav/TopNav.tsx (container={false} — see below).
//
// Maps a canonical capability ID (the SAME id `app/api/me/route.ts`'s
// enabledCapabilities projection and components/dashboard/ModuleAccessCard's
// MODULE_ENTRIES already use — 'crm' | 'events' | 'organiser', confirmed via
// this phase's own audit as the only three rows that exist in `modules`
// today) to a small, consistent icon+container treatment.
//
// This component owns visual mapping ONLY. It does not read entitlements,
// does not know about routes, does not gate anything — callers decide
// whether/when to render it and in which `state`. It is not a second
// capability registry: `CAPABILITY_ICON_MAP` below is presentation-only and
// intentionally has no fallback that invents a capability that doesn't
// exist elsewhere — unknown ids render a neutral placeholder glyph rather
// than throwing, so a not-yet-mapped future module never breaks a caller.
//
// Container recipe (38x38 / borderRadius 9 / `${color}10` background /
// `${color}22` border / 20px icon / strokeWidth 1.6) is not new — it's
// lifted directly from the homepage's own already-shipped CAPABILITIES
// card treatment (app/page.tsx) so this reads as the same visual language,
// not a competing one.

export type CapabilityIconSize = 'sm' | 'md' | 'lg';
export type CapabilityIconState = 'default' | 'hover' | 'active' | 'disabled';

export interface CapabilityIconProps {
  /** Canonical capability id, e.g. 'crm' | 'events' | 'organiser'. Unknown ids fall back to a neutral glyph rather than throwing. */
  capability: string;
  size?: CapabilityIconSize;
  state?: CapabilityIconState;
  /** Accessible name for icon-only interactive contexts. Omit when a visible label already sits next to the icon (the icon stays aria-hidden). */
  label?: string;
  /** Default true (the rounded-square background/border tile). Set false
      for a dense context — e.g. a nav pill sitting directly before its own
      text label — where the tile's fixed footprint reads as visibly
      taller than the surrounding row (confirmed by rendering `size="sm"`
      with its container at TopNav scale before adding this). false skips
      the background/border/radius entirely and sizes the wrapper to
      exactly the glyph itself — same colour/state logic, no bigger. */
  container?: boolean;
  className?: string;
  style?: CSSProperties;
}

const SIZE_SCALE: Record<CapabilityIconSize, { icon: number; container: number; radius: number }> = {
  sm: { icon: 16, container: 28, radius: 7 },
  md: { icon: 20, container: 38, radius: 9 },
  lg: { icon: 24, container: 46, radius: 11 },
};

const NEUTRAL = '#94A3B8';

// Colours are not new brand colours — 'crm' and 'events' reuse the exact
// hex values already shipped on the homepage's CAPABILITIES cards for the
// same two capabilities; 'organiser' borrows the homepage's closest
// existing semantic neighbour ("Scheduling & Bookings"), since 'organiser'
// itself isn't marketed by name yet. Flagged in the D.4 report as a
// proposal, not a locked decision.
const CAPABILITY_ICON_MAP: Record<string, { Icon: typeof Users; color: string }> = {
  crm: { Icon: Users, color: '#8A4DFF' },
  events: { Icon: Ticket, color: '#FBBF24' },
  organiser: { Icon: CalendarClock, color: '#38BDF8' },
};

function alphaHex(base: string, hover: string, active: string, state: CapabilityIconState) {
  if (state === 'hover') return hover;
  if (state === 'active') return active;
  return base;
}

export function CapabilityIcon({
  capability,
  size = 'md',
  state = 'default',
  label,
  container = true,
  className,
  style,
}: CapabilityIconProps) {
  const mapped = CAPABILITY_ICON_MAP[capability];
  const Icon = mapped?.Icon ?? LayoutGrid;
  const accent = mapped?.color ?? NEUTRAL;
  const { icon, container: containerSize, radius } = SIZE_SCALE[size];

  const disabled = state === 'disabled';
  const color = disabled ? 'rgba(255,255,255,.35)' : accent;
  const background = disabled
    ? 'rgba(255,255,255,.03)'
    : `${accent}${alphaHex('10', '18', '22', state)}`;
  const border = disabled
    ? '1px solid rgba(255,255,255,.08)'
    : `1px solid ${accent}${alphaHex('22', '38', '55', state)}`;

  return (
    <div
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      className={className}
      style={{
        width: container ? containerSize : icon,
        height: container ? containerSize : icon,
        borderRadius: container ? radius : 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        background: container ? background : 'transparent',
        border: container ? border : 'none',
        transition: 'background .15s, border-color .15s',
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      <Icon width={icon} height={icon} strokeWidth={1.6} aria-hidden="true" />
    </div>
  );
}
