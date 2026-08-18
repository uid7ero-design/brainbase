import type { CSSProperties } from 'react'

// Pure, framework-free session-type display resolution shared by
// app/dashboard/sessions/page.tsx. Extracted into its own module (rather
// than living inline in that 'use client' page) specifically so it can be
// imported directly by tests — this is the single source of truth for
// "Session Type is the primary visible identity; the stored session name
// is an optional secondary label, shown only when it adds real
// information" (see optionalLabel below), so it needs real, executable
// test coverage rather than only static source-text assertions.

export type SessionTypeRow = { id: string; name: string; slug: string; colour_key: string; active: boolean; sort_order: number }

// Legacy hardcoded fallback maps — used only for a type slug with no
// matching row in the live, organisation-scoped session_types list
// (pre-migration, or a type predating that feature). Once every type is
// backed by a session_types row these are dead weight but harmless.
export const SESSION_LABELS: Record<string, string> = {
  // Private Coaching
  PRIVATE_30:        'Private Coaching (30 min)',
  PRIVATE_60:        'Private Coaching (60 min)',
  SEMI_PRIVATE:      'Semi-Private Coaching',
  // Hot Shots (Juniors)
  GROUP_TERM_JUNIOR: 'Hot Shots Tennis',
  MATCHPLAY:         'Hot Shots Matchplay',
  // Adult Coaching
  GROUP_TERM_ADULT:  'Adult Beginner Group',
  // Fitness
  CARDIO_SESSION:    'Cardio Tennis',
  CARDIO_TERM:       'Cardio Tennis (Term)',
  // Other
  CLINIC:            'Clinic',
  ASSESSMENT:        'Assessment',
  // Legacy fallbacks
  PRIVATE:           'Private Coaching',
  GROUP:             'Group Session',
  GROUP_CASUAL:      'Group Session',
  ACADEMY:           'Academy Program',
}

export const SESSION_COLOURS: Record<string, { text: string; bg: string; border: string }> = {
  PRIVATE_30:        { text: '#c084fc', bg: 'rgba(168,85,247,.14)',   border: 'rgba(168,85,247,.35)'   },
  PRIVATE_60:        { text: '#a855f7', bg: 'rgba(168,85,247,.20)',   border: 'rgba(168,85,247,.42)'   },
  SEMI_PRIVATE:      { text: '#818cf8', bg: 'rgba(79,70,229,.15)',    border: 'rgba(79,70,229,.38)'    },
  GROUP_TERM_JUNIOR: { text: '#4ade80', bg: 'rgba(22,163,74,.13)',    border: 'rgba(22,163,74,.32)'    },
  MATCHPLAY:         { text: '#34d399', bg: 'rgba(16,185,129,.12)',   border: 'rgba(16,185,129,.30)'   },
  GROUP_TERM_ADULT:  { text: '#60a5fa', bg: 'rgba(37,99,235,.13)',    border: 'rgba(37,99,235,.32)'    },
  CARDIO_SESSION:    { text: '#fb923c', bg: 'rgba(249,115,22,.13)',   border: 'rgba(249,115,22,.32)'   },
  CARDIO_TERM:       { text: '#f97316', bg: 'rgba(234,88,12,.14)',    border: 'rgba(234,88,12,.34)'    },
  CLINIC:            { text: '#7dd3fc', bg: 'rgba(14,165,233,.12)',   border: 'rgba(14,165,233,.30)'   },
  ASSESSMENT:        { text: '#94a3b8', bg: 'rgba(100,116,139,.13)',  border: 'rgba(100,116,139,.30)'  },
  // Legacy fallbacks
  PRIVATE:           { text: '#c084fc', bg: 'rgba(168,85,247,.14)',   border: 'rgba(168,85,247,.35)'   },
  GROUP:             { text: '#4ade80', bg: 'rgba(22,163,74,.13)',    border: 'rgba(22,163,74,.32)'    },
  GROUP_CASUAL:      { text: '#4ade80', bg: 'rgba(22,163,74,.13)',    border: 'rgba(22,163,74,.32)'    },
  ACADEMY:           { text: '#fb923c', bg: 'rgba(249,115,22,.13)',   border: 'rgba(249,115,22,.32)'   },
}

// Fixed, finite colour palette for organisation-managed session types — a
// manager picks one of these keys, never raw CSS. Keep in sync with
// VALID_COLOUR_KEYS in app/api/dashboard/session-types/route.ts.
export const SESSION_TYPE_COLOUR_PALETTE: Record<string, { text: string; bg: string; border: string }> = {
  purple:  { text: '#c084fc', bg: 'rgba(168,85,247,.14)',  border: 'rgba(168,85,247,.35)'  },
  violet:  { text: '#a855f7', bg: 'rgba(168,85,247,.20)',  border: 'rgba(168,85,247,.42)'  },
  indigo:  { text: '#818cf8', bg: 'rgba(79,70,229,.15)',   border: 'rgba(79,70,229,.38)'   },
  green:   { text: '#4ade80', bg: 'rgba(22,163,74,.13)',   border: 'rgba(22,163,74,.32)'   },
  emerald: { text: '#34d399', bg: 'rgba(16,185,129,.12)',  border: 'rgba(16,185,129,.30)'  },
  blue:    { text: '#60a5fa', bg: 'rgba(37,99,235,.13)',   border: 'rgba(37,99,235,.32)'   },
  orange:  { text: '#fb923c', bg: 'rgba(249,115,22,.13)',  border: 'rgba(249,115,22,.32)'  },
  amber:   { text: '#f97316', bg: 'rgba(234,88,12,.14)',   border: 'rgba(234,88,12,.34)'   },
  sky:     { text: '#7dd3fc', bg: 'rgba(14,165,233,.12)',  border: 'rgba(14,165,233,.30)'  },
  slate:   { text: '#94a3b8', bg: 'rgba(100,116,139,.13)', border: 'rgba(100,116,139,.30)' },
  rose:    { text: '#fb7185', bg: 'rgba(244,63,94,.13)',   border: 'rgba(244,63,94,.32)'   },
  teal:    { text: '#2dd4bf', bg: 'rgba(20,184,166,.13)',  border: 'rgba(20,184,166,.32)'  },
}
export const SESSION_TYPE_COLOUR_KEYS = Object.keys(SESSION_TYPE_COLOUR_PALETTE)

// Both resolve against the live, organisation-scoped session types list
// first (fetched from /api/dashboard/session-types — includes archived
// types too, since a session saved against an archived type must keep
// resolving/displaying correctly), falling back to the hardcoded maps
// above for any type not yet backed by a session_types row (pre-migration,
// or a type created before this feature existed).
export function sessionLabel(type: string, types: SessionTypeRow[]): string {
  return types.find(t => t.slug === type)?.name ?? SESSION_LABELS[type] ?? type ?? 'Session'
}

export function sessionChip(type: string, types: SessionTypeRow[]): CSSProperties {
  const match = types.find(t => t.slug === type)
  const c = match ? SESSION_TYPE_COLOUR_PALETTE[match.colour_key] : SESSION_COLOURS[type]
  if (!c) return { color: 'rgba(255,255,255,.35)', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 8px', display: 'inline-block' }
  return { color: c.text, background: c.bg, border: `1px solid ${c.border}`, fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 8px', display: 'inline-block' }
}

// Just the accent colour (for a small dot/left-stripe next to a title that
// already spells the type name out in full) — used where sessionChip's
// full pill badge would just repeat text the title already shows.
export function sessionColourDot(type: string, types: SessionTypeRow[]): string {
  const match = types.find(t => t.slug === type)
  const c = match ? SESSION_TYPE_COLOUR_PALETTE[match.colour_key] : SESSION_COLOURS[type]
  return c?.text ?? '#94a3b8'
}

// Session Type is the primary visible identity everywhere in this UI (see
// sessionLabel above); the session's own stored `name` becomes an optional
// secondary label, shown only when it adds real information. A name that
// is empty, an exact match, or merely a shortened prefix of the resolved
// type name (e.g. "Hot Shot" against "Hot Shots Tennis", "Private" against
// "Private Coaching (30 min)" — exactly the two duplication patterns the
// production report called out) is treated as redundant and suppressed,
// so old sessions created before types existed don't force a second,
// near-identical line onto every calendar card. A genuinely distinct name
// (e.g. "Green Ball Advanced", or an arbitrary historical label like
// "Test 2") still renders — nothing stored is hidden, only literal
// near-duplicates of the title itself.
export function optionalLabel(name: string, type: string, types: SessionTypeRow[]): string | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const title = sessionLabel(type, types).trim().toLowerCase()
  const n = trimmed.toLowerCase()
  if (n === title || title.startsWith(n)) return null
  return trimmed
}
