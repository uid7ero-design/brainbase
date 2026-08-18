import { describe, it, expect } from 'vitest'
import {
  sessionLabel, optionalLabel, sessionColourDot, resolveSessionColourKey, validateSessionColourOverride,
  SESSION_TYPE_COLOUR_KEYS, SESSION_TYPE_COLOUR_PALETTE, SESSION_TYPE_COLOUR_NAMES,
  type SessionTypeRow,
} from '@/lib/sessionDisplay'

const hotShots: SessionTypeRow = { id: 't1', name: 'Hot Shots Tennis', slug: 'GROUP_TERM_JUNIOR', colour_key: 'green', active: true, sort_order: 0 }
const privateCoaching: SessionTypeRow = { id: 't2', name: 'Private Coaching (30 min)', slug: 'PRIVATE_30', colour_key: 'purple', active: true, sort_order: 1 }
const cardioTerm: SessionTypeRow = { id: 't3', name: 'Cardio Tennis (Term)', slug: 'CARDIO_TERM', colour_key: 'amber', active: true, sort_order: 2 }
const archivedType: SessionTypeRow = { id: 't4', name: 'Assessment', slug: 'ASSESSMENT', colour_key: 'slate', active: false, sort_order: 3 }

describe('sessionLabel — Session Type resolves as the primary display title', () => {
  it('resolves the org-scoped type name when a matching session_types row exists', () => {
    expect(sessionLabel('GROUP_TERM_JUNIOR', [hotShots])).toBe('Hot Shots Tennis')
  })

  it('falls back to the legacy hardcoded map for a type not backed by any session_types row (pre-migration or unmigrated)', () => {
    expect(sessionLabel('CARDIO_SESSION', [])).toBe('Cardio Tennis')
  })

  it('resolves archived types too — an archived type must still render correctly on existing sessions', () => {
    expect(sessionLabel('ASSESSMENT', [archivedType])).toBe('Assessment')
  })

  it('falls back to the raw slug for a completely unrecognised type', () => {
    expect(sessionLabel('SOME_NEW_TYPE_SLUG', [])).toBe('SOME_NEW_TYPE_SLUG')
  })
})

describe('optionalLabel — the two production duplication examples are suppressed', () => {
  it('"Hot Shot" against "Hot Shots Tennis" is suppressed (prefix duplicate)', () => {
    expect(optionalLabel('Hot Shot', 'GROUP_TERM_JUNIOR', [hotShots])).toBeNull()
  })

  it('"Private" against "Private Coaching (30 min)" is suppressed (prefix duplicate)', () => {
    expect(optionalLabel('Private', 'PRIVATE_30', [privateCoaching])).toBeNull()
  })

  it('an exact match (case-insensitive) is suppressed', () => {
    expect(optionalLabel('hot shots tennis', 'GROUP_TERM_JUNIOR', [hotShots])).toBeNull()
  })

  it('a blank/whitespace-only name renders no secondary line at all (not an empty string)', () => {
    expect(optionalLabel('', 'GROUP_TERM_JUNIOR', [hotShots])).toBeNull()
    expect(optionalLabel('   ', 'GROUP_TERM_JUNIOR', [hotShots])).toBeNull()
  })

  it('a genuinely distinct custom label renders, exactly as typed (trimmed)', () => {
    expect(optionalLabel('Green Ball Advanced', 'GROUP_TERM_JUNIOR', [hotShots])).toBe('Green Ball Advanced')
    expect(optionalLabel('  Advanced Adults  ', 'CARDIO_TERM', [cardioTerm])).toBe('Advanced Adults')
  })

  it('an arbitrary historical label that is not a duplicate (e.g. "Test 2") still renders — nothing stored is hidden except literal near-duplicates', () => {
    expect(optionalLabel('Test 2', 'CARDIO_TERM', [cardioTerm])).toBe('Test 2')
  })
})

describe('sessionColourDot — accent colour resolution', () => {
  it('resolves the org type\'s chosen colour_key to its palette colour', () => {
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [hotShots])).toBe('#4ade80') // green
  })

  it('falls back to the legacy colour map when no session_types row matches', () => {
    expect(sessionColourDot('CLINIC', [])).not.toBe('#94a3b8') // has its own legacy colour, not the generic fallback
  })

  it('falls back to a neutral colour for a completely unrecognised type', () => {
    expect(sessionColourDot('UNKNOWN_TYPE', [])).toBe('#94a3b8')
  })
})

describe('sessionColourDot / resolveSessionColourKey — session-level colour override precedence (session override → type colour → fallback)', () => {
  it('a session with no override resolves to its type colour, exactly as before overrides existed', () => {
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [hotShots], null)).toBe('#4ade80') // green
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [hotShots], undefined)).toBe('#4ade80')
  })

  it('a valid session override wins over the type colour', () => {
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [hotShots], 'orange')).toBe(SESSION_TYPE_COLOUR_PALETTE.orange.text)
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [hotShots], 'orange')).not.toBe('#4ade80')
  })

  it('an override key that somehow is not in the palette is ignored, falling back to the type colour rather than breaking', () => {
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [hotShots], 'not-a-real-key')).toBe('#4ade80')
  })

  it('an empty-string override is treated as "no override" (same as null) — the type colour still wins', () => {
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [hotShots], '')).toBe('#4ade80')
  })

  it('when a session has no override, changing the type\'s colour_key changes what this resolves to on the very next call — nothing is cached against the session', () => {
    const recoloured: SessionTypeRow = { ...hotShots, colour_key: 'rose' }
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [hotShots], null)).toBe('#4ade80')
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [recoloured], null)).toBe(SESSION_TYPE_COLOUR_PALETTE.rose.text)
  })

  it('when a session HAS an override, changing the type\'s colour_key does not touch it', () => {
    const recoloured: SessionTypeRow = { ...hotShots, colour_key: 'rose' }
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [hotShots], 'orange')).toBe(SESSION_TYPE_COLOUR_PALETTE.orange.text)
    expect(sessionColourDot('GROUP_TERM_JUNIOR', [recoloured], 'orange')).toBe(SESSION_TYPE_COLOUR_PALETTE.orange.text)
  })

  it('resolveSessionColourKey returns the KEY (not the rendered colour) with the same precedence, for UI that needs to show/compare the resolved key', () => {
    expect(resolveSessionColourKey('GROUP_TERM_JUNIOR', [hotShots], null)).toBe('green')
    expect(resolveSessionColourKey('GROUP_TERM_JUNIOR', [hotShots], 'orange')).toBe('orange')
    expect(resolveSessionColourKey('UNKNOWN_TYPE', [], null)).toBeNull()
  })
})

describe('validateSessionColourOverride — server-side acceptance rule shared by both sessions routes', () => {
  it('null, undefined, and blank string all mean "inherit" and are accepted as null', () => {
    expect(validateSessionColourOverride(null)).toBeNull()
    expect(validateSessionColourOverride(undefined)).toBeNull()
    expect(validateSessionColourOverride('')).toBeNull()
  })

  it('every real palette key is accepted as itself', () => {
    for (const key of SESSION_TYPE_COLOUR_KEYS) {
      expect(validateSessionColourOverride(key)).toBe(key)
    }
  })

  it('an unknown key, raw hex, or arbitrary string is rejected as the literal sentinel \'INVALID\' — never silently accepted', () => {
    expect(validateSessionColourOverride('not-a-real-colour')).toBe('INVALID')
    expect(validateSessionColourOverride('#ff0000')).toBe('INVALID')
    expect(validateSessionColourOverride('rgb(255,0,0)')).toBe('INVALID')
    expect(validateSessionColourOverride('javascript:alert(1)')).toBe('INVALID')
  })
})

describe('expanded safe colour palette (~18-20 keys, Tailwind-family names, dark-theme-safe)', () => {
  it('has between 18 and 20 keys', () => {
    expect(SESSION_TYPE_COLOUR_KEYS.length).toBeGreaterThanOrEqual(18)
    expect(SESSION_TYPE_COLOUR_KEYS.length).toBeLessThanOrEqual(20)
  })

  it('the original 12 keys used by existing session_types rows are unchanged, so no existing type/session silently re-colours', () => {
    const original: Record<string, { text: string; bg: string; border: string }> = {
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
    for (const [key, value] of Object.entries(original)) {
      expect(SESSION_TYPE_COLOUR_PALETTE[key]).toEqual(value)
    }
  })

  it('every palette key has a distinct rendered text colour — no two keys are visually identical', () => {
    const textColours = SESSION_TYPE_COLOUR_KEYS.map(k => SESSION_TYPE_COLOUR_PALETTE[k].text)
    expect(new Set(textColours).size).toBe(textColours.length)
  })

  it('every palette key has a human-readable name (no raw key ever shown bare in the picker)', () => {
    for (const key of SESSION_TYPE_COLOUR_KEYS) {
      expect(SESSION_TYPE_COLOUR_NAMES[key]).toBeTruthy()
      expect(SESSION_TYPE_COLOUR_NAMES[key]).not.toBe(key) // a real capitalised name, not just the key echoed back
    }
  })

  it('only finite, pre-defined {text,bg,border} colour objects exist — no hex/rgb is accepted as a key itself', () => {
    for (const key of SESSION_TYPE_COLOUR_KEYS) {
      expect(key).toMatch(/^[a-z]+$/) // lowercase word keys only, never "#fff" or "rgb(...)"
    }
  })

  it('SESSION_TYPE_COLOUR_KEYS and SESSION_TYPE_COLOUR_NAMES stay in lockstep — every key has exactly one name, no orphans either direction', () => {
    expect(Object.keys(SESSION_TYPE_COLOUR_NAMES).sort()).toEqual([...SESSION_TYPE_COLOUR_KEYS].sort())
  })
})
