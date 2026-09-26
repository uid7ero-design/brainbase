import { describe, it, expect } from 'vitest'
import {
  scopeIdsAreWellFormed,
  resultFromRows,
  type ValidationRow,
  type OrganiserItemReorderScope,
} from '@/lib/organiser/reorderTransactions'

// Phase D.4.7E (Slice E1) — real executed tests for the parts of
// lib/organiser/reorderTransactions.ts that do not require a live database:
// pre-SQL id well-formedness gating, and interpretation of the validation
// row(s) the real SQL statement returns. This deliberately does NOT (and
// cannot) prove the SQL text itself — that is
// organiserReorderTransaction.integration.test.ts's job, against a real
// Postgres instance. Narrowing what's provable here to exactly these two
// pure functions is what keeps the "not empirically run against a live DB"
// disclosure in this phase's report honestly scoped to just the SQL,
// rather than to this whole module.

const UUID_A = '11111111-1111-1111-1111-111111111111'
const UUID_B = '22222222-2222-2222-2222-222222222222'
const UUID_C = '33333333-3333-3333-3333-333333333333'

describe('scopeIdsAreWellFormed', () => {
  const groupScope = (boardId: string, groupId: string | null): OrganiserItemReorderScope => ({
    type: 'top_level_group', organisationId: 'org-a', boardId, groupId,
  })
  const subitemScope = (boardId: string, parentItemId: string): OrganiserItemReorderScope => ({
    type: 'subitems', organisationId: 'org-a', boardId, parentItemId,
  })

  it('accepts a well-formed top_level_group scope with a real group and well-formed requested ids', () => {
    expect(scopeIdsAreWellFormed(groupScope(UUID_A, UUID_B), [UUID_C])).toBe(true)
  })

  it('accepts a top_level_group scope with groupId: null (the "No group" bucket)', () => {
    expect(scopeIdsAreWellFormed(groupScope(UUID_A, null), [UUID_C])).toBe(true)
  })

  it('accepts a well-formed subitems scope', () => {
    expect(scopeIdsAreWellFormed(subitemScope(UUID_A, UUID_B), [UUID_C])).toBe(true)
  })

  it('rejects a non-UUID-shaped boardId', () => {
    expect(scopeIdsAreWellFormed(groupScope('not-a-uuid', UUID_B), [UUID_C])).toBe(false)
  })

  it('rejects a non-UUID-shaped groupId (when not null)', () => {
    expect(scopeIdsAreWellFormed(groupScope(UUID_A, 'not-a-uuid'), [UUID_C])).toBe(false)
  })

  it('rejects a non-UUID-shaped parentItemId', () => {
    expect(scopeIdsAreWellFormed(subitemScope(UUID_A, 'not-a-uuid'), [UUID_C])).toBe(false)
  })

  it('rejects a non-UUID-shaped id anywhere in the requested list', () => {
    expect(scopeIdsAreWellFormed(groupScope(UUID_A, UUID_B), [UUID_C, 'not-a-uuid'])).toBe(false)
  })

  it('accepts an empty requested list against a well-formed scope', () => {
    expect(scopeIdsAreWellFormed(groupScope(UUID_A, UUID_B), [])).toBe(true)
  })
})

describe('resultFromRows', () => {
  const okRow = (overrides: Partial<ValidationRow> = {}): ValidationRow => ({
    no_duplicates: true, no_foreign: true, no_missing: true, count_matches: true,
    id: null, position: null,
    ...overrides,
  })

  it('an empty row array is treated as a (structurally unreachable) count_mismatch rejection, never a crash', () => {
    expect(resultFromRows([])).toEqual({ ok: false, reason: 'count_mismatch' })
  })

  it('no_duplicates=false takes precedence and reports "duplicate"', () => {
    expect(resultFromRows([okRow({ no_duplicates: false })])).toEqual({ ok: false, reason: 'duplicate' })
  })

  it('no_foreign=false reports "extra"', () => {
    expect(resultFromRows([okRow({ no_foreign: false })])).toEqual({ ok: false, reason: 'extra' })
  })

  it('no_missing=false reports "missing"', () => {
    expect(resultFromRows([okRow({ no_missing: false })])).toEqual({ ok: false, reason: 'missing' })
  })

  it('count_matches=false reports "count_mismatch"', () => {
    expect(resultFromRows([okRow({ count_matches: false })])).toEqual({ ok: false, reason: 'count_mismatch' })
  })

  it('duplicate is reported even if OTHER flags are also false (precedence order)', () => {
    expect(resultFromRows([okRow({ no_duplicates: false, no_foreign: false, no_missing: false, count_matches: false })]))
      .toEqual({ ok: false, reason: 'duplicate' })
  })

  it('all flags true, one resequenced row present — success, with that row in `order`', () => {
    const result = resultFromRows([okRow({ id: UUID_A, position: 0 })])
    expect(result).toEqual({ ok: true, order: [{ id: UUID_A, position: 0 }] })
  })

  it('all flags true, multiple resequenced rows (validation flags repeated per the LEFT JOIN) — collapses to one `order` entry per row, not deduplicated away', () => {
    const result = resultFromRows([
      okRow({ id: UUID_A, position: 0 }),
      okRow({ id: UUID_B, position: 1 }),
      okRow({ id: UUID_C, position: 2 }),
    ])
    expect(result).toEqual({
      ok: true,
      order: [
        { id: UUID_A, position: 0 },
        { id: UUID_B, position: 1 },
        { id: UUID_C, position: 2 },
      ],
    })
  })

  it('all flags true but id/position are null (the zero-siblings edge case: an empty scope + empty request) — succeeds with an empty order, never a phantom entry', () => {
    expect(resultFromRows([okRow()])).toEqual({ ok: true, order: [] })
  })
})
