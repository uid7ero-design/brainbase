import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { computeSelectionTotalCents } from '@/app/e/[organisationSlug]/[eventSlug]/PublicEventClient'

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// Public booking UI total-display bug fix: the CTA button and a new
// "Total" summary row previously used the ticket type's PER-UNIT price
// regardless of selected quantity — Stripe was always charged
// correctly (the checkout route independently computes
// ticketType.price_cents * quantity server-side; see that route's own
// comment), but the browser showed the wrong number before redirect.
// computeSelectionTotalCents() is the exact same integer-cents formula,
// exported so it's testable directly rather than only via component
// rendering (this repo has no jsdom/RTL harness — see the containment-
// test convention established throughout tests/containment/*).
describe('computeSelectionTotalCents — integer cents, no floating point', () => {
  it('one paid ticket (quantity 1) — total equals the unit price', () => {
    expect(computeSelectionTotalCents(2500, 1)).toBe(2500)
  })

  it('multiple quantity of one paid ticket type — 3 × $25.00 = $75.00', () => {
    expect(computeSelectionTotalCents(2500, 3)).toBe(7500)
  })

  it('mixed ticket types (formula validated independently per type, matching the brief\'s own "3 x $25 + 2 x $10" example) — each line computes correctly on its own terms', () => {
    const lineA = computeSelectionTotalCents(2500, 3) // 3 x $25.00
    const lineB = computeSelectionTotalCents(1000, 2) // 2 x $10.00
    expect(lineA).toBe(7500)
    expect(lineB).toBe(2000)
    expect(lineA + lineB).toBe(9500) // Total $95.00, exactly the brief's worked example
  })

  it('a free ticket type (price_cents = 0) always totals 0, regardless of quantity', () => {
    expect(computeSelectionTotalCents(0, 1)).toBe(0)
    expect(computeSelectionTotalCents(0, 5)).toBe(0)
  })

  it('paid + free mix — a free ticket type contributes nothing to what would be a combined total, a paid one contributes its own line in full', () => {
    const freeLine = computeSelectionTotalCents(0, 4)
    const paidLine = computeSelectionTotalCents(2500, 2)
    expect(freeLine).toBe(0)
    expect(paidLine).toBe(5000)
    expect(freeLine + paidLine).toBe(5000)
  })

  it('zero quantity selection totals 0 even for a priced ticket type (no negative/NaN/undefined result)', () => {
    expect(computeSelectionTotalCents(2500, 0)).toBe(0)
  })

  it('never produces a fractional-cent (floating-point) result for any integer inputs', () => {
    // 3 values chosen to be classic floating-point trouble cases in
    // dollars (0.1 + 0.2 style errors) — confirms whole-cents integer
    // arithmetic throughout, never cents/100 until final display.
    expect(Number.isInteger(computeSelectionTotalCents(1099, 7))).toBe(true)
    expect(computeSelectionTotalCents(1099, 7)).toBe(7693)
  })

  it('matches the exact formula the checkout route computes server-side — never a second, independently-drifting implementation', () => {
    const checkoutSrc = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))
    expect(checkoutSrc).toMatch(/ticketType\.price_cents \* validated\.quantity/)
    // Same shape: unitPriceCents * quantity, integer multiplication only.
    expect(computeSelectionTotalCents(1234, 5)).toBe(1234 * 5)
  })
})

describe('Public booking UI — total display wired to the fixed formula', () => {
  const src = stripComments(read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx'))

  it('the CTA button price uses totalCents, not the bare per-unit price_cents (the exact prior bug)', () => {
    expect(src).toMatch(/Pay \$\{formatPrice\(totalCents\)\}/)
    expect(src).not.toMatch(/Pay \$\{formatPrice\(selectedTicketType\?\.\s*price_cents/)
  })

  it('totalCents is derived from computeSelectionTotalCents(unit price, quantity) — updates whenever quantity changes, since quantity is already a render-time dependency, not a stale snapshot', () => {
    expect(src).toMatch(/const totalCents = computeSelectionTotalCents\(selectedTicketType\?\.price_cents \?\? 0, quantity\)/)
  })

  it('a visible Total summary row exists in the booking form, not just the button label', () => {
    expect(src).toMatch(/Total \$\{formatPrice\(totalCents\)\}/)
  })
})
