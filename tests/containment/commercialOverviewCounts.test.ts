import { describe, it, expect } from 'vitest'
import { resolveResourceCount } from '@/lib/commercial/overviewCounts'

// Phase C4.4A (blocker fix) — behavioral coverage for the pure rule
// behind each Commercial Overview stat card. Unlike
// commercialOverviewCapabilityAware.test.ts (necessarily static-text,
// since this repo's vitest config has no DOM/fetch-mounting harness —
// see CLAUDE.md), this file calls the real, exported
// resolveResourceCount() function directly with concrete inputs and
// asserts on its actual return value — a genuine behavioral test, not
// a source-text pattern match.

describe('Phase C4.4A (blocker fix) — resolveResourceCount three-way state', () => {
  it('1. disabled capability -> "unavailable", regardless of ok/length', () => {
    expect(resolveResourceCount(false, true, 5)).toBe('unavailable')
    expect(resolveResourceCount(false, false, undefined)).toBe('unavailable')
  })

  it('2. enabled + successful EMPTY response -> the real value 0, not "error" and not "unavailable"', () => {
    expect(resolveResourceCount(true, true, 0)).toBe(0)
  })

  it('3. enabled + successful NON-EMPTY response -> the real count', () => {
    expect(resolveResourceCount(true, true, 7)).toBe(7)
  })

  it('4. enabled + failed fetch (ok: false) -> "error", never 0', () => {
    const result = resolveResourceCount(true, false, undefined)
    expect(result).toBe('error')
    expect(result).not.toBe(0)
  })

  it('4b. enabled + ok reported true but length missing (defensive) -> "error", never silently 0', () => {
    const result = resolveResourceCount(true, true, undefined)
    expect(result).toBe('error')
  })

  it('5. one failed enabled resource does not affect an unrelated, independently-succeeding resource', () => {
    // Simulates the Overview's real per-resource independence: quotes'
    // own fetch fails while invoices' own fetch succeeds. Each call is
    // given only its own (enabled, ok, length) triple — there is no
    // shared mutable state between them, so a failure in one can never
    // leak into another's result.
    const quotes = resolveResourceCount(true, false, undefined)
    const invoices = resolveResourceCount(true, true, 3)
    const customers = resolveResourceCount(true, true, 0)
    expect(quotes).toBe('error')
    expect(invoices).toBe(3)
    expect(customers).toBe(0)
  })
})
