import { describe, it, expect } from 'vitest'
import { sessionLabel, optionalLabel, sessionColourDot, type SessionTypeRow } from '@/lib/sessionDisplay'

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
