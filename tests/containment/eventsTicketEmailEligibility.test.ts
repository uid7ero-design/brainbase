import { describe, it, expect } from 'vitest'
import { isOrderEligibleForTicketEmail, type TicketEmailEligibilityOrder } from '@/lib/events/ticketEmailEligibility'

// Phase 7 §4 — eligibility rule: eligible ONLY when status='CONFIRMED',
// payment_status IN ('NOT_REQUIRED','PAID'), purchaser_email is
// non-empty, and at least one attendee has an existing ticket_token.

function order(overrides: Partial<TicketEmailEligibilityOrder> = {}): TicketEmailEligibilityOrder {
  return {
    status: 'CONFIRMED',
    payment_status: 'PAID',
    purchaser_email: 'jane@example.com',
    attendees: [{ ticket_token: 'a'.repeat(64) }],
    ...overrides,
  }
}

describe('isOrderEligibleForTicketEmail — eligible cases', () => {
  it('CONFIRMED + NOT_REQUIRED (free order) with a token is eligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ payment_status: 'NOT_REQUIRED' }))).toBe(true)
  })

  it('CONFIRMED + PAID with a token is eligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ payment_status: 'PAID' }))).toBe(true)
  })

  it('eligible when at least one of several attendees has a token', () => {
    expect(isOrderEligibleForTicketEmail(order({ attendees: [{ ticket_token: null }, { ticket_token: 'b'.repeat(64) }] }))).toBe(true)
  })
})

describe('isOrderEligibleForTicketEmail — ineligible order states', () => {
  it('PENDING payment_status is ineligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ payment_status: 'PENDING' }))).toBe(false)
  })

  it('FAILED payment_status is ineligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ payment_status: 'FAILED' }))).toBe(false)
  })

  it('EXPIRED payment_status is ineligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ payment_status: 'EXPIRED' }))).toBe(false)
  })

  it('REFUNDED payment_status is ineligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ payment_status: 'REFUNDED' }))).toBe(false)
  })

  it('CANCELLED order status is ineligible even if payment_status is PAID', () => {
    expect(isOrderEligibleForTicketEmail(order({ status: 'CANCELLED', payment_status: 'PAID' }))).toBe(false)
  })

  it('PENDING order status is ineligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ status: 'PENDING', payment_status: 'NOT_REQUIRED' }))).toBe(false)
  })
})

describe('isOrderEligibleForTicketEmail — missing email / missing tokens', () => {
  it('null purchaser_email is ineligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ purchaser_email: null }))).toBe(false)
  })

  it('empty-string purchaser_email is ineligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ purchaser_email: '' }))).toBe(false)
  })

  it('whitespace-only purchaser_email is ineligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ purchaser_email: '   ' }))).toBe(false)
  })

  it('no attendees at all is ineligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ attendees: [] }))).toBe(false)
  })

  it('attendees present but none have a ticket_token is ineligible', () => {
    expect(isOrderEligibleForTicketEmail(order({ attendees: [{ ticket_token: null }, { ticket_token: null }] }))).toBe(false)
  })
})
