import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { RESERVATION_HOLD_GRACE_SECONDS, reservationHoldSeconds } from '@/lib/events/services/reservationHold'

// Late-webhook race: a payment completed near the end of the Checkout Session could be
// finalised by a DELAYED webhook after the seat hold had lapsed and the seat had been
// resold (a paid order with no capacity). The database hold now outlasts the payable
// window by a grace, so a webhook arriving within it always finds the seat held.
// (The capacity gate and its PENDING-hold predicate are proven against real Postgres by
// the existing concurrency scripts; this file pins the timing rule and where it applies.)

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('reservation hold outlasts the payable window', () => {
  it('the hold is the payment window plus a positive grace', () => {
    expect(RESERVATION_HOLD_GRACE_SECONDS).toBeGreaterThanOrEqual(30 * 60)
    expect(reservationHoldSeconds(31 * 60)).toBe(31 * 60 + RESERVATION_HOLD_GRACE_SECONDS)
    expect(reservationHoldSeconds(31 * 60)).toBeGreaterThan(31 * 60)
  })

  it('every PENDING reservation (first checkout AND retry) is held for the longer duration', () => {
    expect(strip(read('lib/events/services/paidCheckout.ts'))).toMatch(/NOW\(\) \+ make_interval\(secs => \$\{reservationHoldSeconds\(RESERVATION_WINDOW_SECONDS\)\}\)/)
    expect(strip(read('lib/events/services/retryCheckout.ts'))).toMatch(/NOW\(\) \+ make_interval\(secs => \$\{reservationHoldSeconds\(RESERVATION_WINDOW_SECONDS\)\}\)/)
  })

  it('the Stripe session itself still ends after the UNCHANGED payment window (so buyers are not given longer to pay)', () => {
    const stripeSrc = strip(read('lib/events/stripe.ts'))
    expect(stripeSrc).toMatch(/export const RESERVATION_WINDOW_SECONDS = 31 \* 60;/)
    expect(stripeSrc).toMatch(/expires_at: Math\.floor\(Date\.now\(\) \/ 1000\) \+ RESERVATION_WINDOW_SECONDS/)
  })

  it('abandoned sessions still release promptly: checkout.session.expired cancels the order (the grace only matters if that webhook is lost)', () => {
    const stripeSrc = strip(read('lib/events/stripe.ts'))
    expect(stripeSrc).toMatch(/SET status = 'CANCELLED', payment_status = 'EXPIRED'[\s\S]*?AND payment_status = 'PENDING'/)
  })

  it('the capacity gate is unchanged: a PENDING order holds capacity until expires_at, a cancelled one never does', () => {
    const src = read('lib/events/services/paidCheckout.ts')
    expect(src).toMatch(/eo\.status <> 'CANCELLED' AND \(eo\.payment_status <> 'PENDING' OR eo\.expires_at > NOW\(\)\)/)
  })

  it('free registrations are unaffected (their orders are never PENDING)', () => {
    expect(read('lib/events/services/freeRegistration.ts')).not.toMatch(/reservationHold/)
  })
})
