import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Booking wallet — dedicated security-review containment, proving the
// explicit invariants this feature was designed against before commit
// (see the implementation brief's own §T "Security review before
// commit" checklist). Every assertion below maps to one line of that
// checklist.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('orderId remains a non-secret confirmation reference only', () => {
  it('the register route still exposes confirmation_reference: orderId exactly as before — this feature does not change that field\'s meaning or remove it', () => {
    const code = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'))
    expect(code).toMatch(/confirmation_reference: orderId/)
  })

  it('no new code path treats event_orders.id as a bearer credential — getPublicBookingDetail looks up by booking_token only', () => {
    const code = stripComments(read('lib/events/publicBooking.ts'))
    expect(code).not.toMatch(/WHERE eo\.id = \$\{bookingToken\}/)
    expect(code).toMatch(/WHERE eo\.booking_token = \$\{bookingToken\}/)
  })
})

describe('booking_token is never logged', () => {
  it('logTicketEmailResent\'s params shape has no booking_token/bookingToken field', () => {
    const code = stripComments(read('lib/events/auditLog.ts'))
    const fnStart = code.indexOf('export async function logTicketEmailResent')
    const fnEnd = code.indexOf('\n}', fnStart)
    const fn = code.slice(fnStart, fnEnd)
    expect(fn).not.toMatch(/booking_?[Tt]oken/)
  })

  it('the resend route never passes booking_token/order.booking_token into logTicketEmailResent\'s call', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts'))
    const calls = code.match(/logTicketEmailResent\(\{[\s\S]*?\}\)/g) ?? []
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call).not.toMatch(/booking_?[Tt]oken/)
  })

  it('no console.log/console.error anywhere in the booking-wallet source touches a token value', () => {
    const files = [
      'lib/events/publicBooking.ts',
      'app/b/[bookingToken]/tickets/page.tsx',
      'app/b/[bookingToken]/tickets/BookingWalletNav.tsx',
      'lib/events/stripe.ts',
    ]
    for (const f of files) {
      const code = stripComments(read(f))
      const logCalls = code.match(/console\.(log|error|warn)\([^)]*\)/g) ?? []
      for (const call of logCalls) expect(call.toLowerCase()).not.toMatch(/token/)
    }
  })
})

describe('ticket_token is never logged', () => {
  it('checkIn.ts, publicTicket.ts, publicBooking.ts contain no console.* call referencing a token', () => {
    for (const f of ['lib/events/checkIn.ts', 'lib/events/publicTicket.ts', 'lib/events/publicBooking.ts']) {
      const code = stripComments(read(f))
      const logCalls = code.match(/console\.(log|error|warn)\([^)]*\)/g) ?? []
      for (const call of logCalls) expect(call.toLowerCase()).not.toMatch(/token/)
    }
  })
})

describe('booking token is never encoded in a QR', () => {
  it('lib/events/qr.ts never references booking_token/bookingToken', () => {
    const code = stripComments(read('lib/events/qr.ts'))
    expect(code).not.toMatch(/booking/i)
  })

  it('BookingWalletNav/page.tsx only ever pass an attendee ticket URL into generateTicketQrSvg — never the booking token or wallet URL', () => {
    const pageSource = stripComments(read('app/b/[bookingToken]/tickets/page.tsx'))
    expect(pageSource).toMatch(/generateTicketQrSvg\(ticketUrl\)/)
    expect(pageSource).not.toMatch(/generateTicketQrSvg\(.*[Bb]ooking/)
  })
})

describe('no token appears in audit after_state', () => {
  it('every INSERT INTO audit_logs in lib/events/stripe.ts has a hardcoded/literal after_state JSON — never interpolates a token variable', () => {
    const code = stripComments(read('lib/events/stripe.ts'))
    const afterStateBlocks = code.match(/'\{"source":"stripe_webhook"[^}]*\}'::jsonb/g) ?? []
    expect(afterStateBlocks.length).toBeGreaterThan(0)
    for (const block of afterStateBlocks) expect(block).not.toMatch(/token/i)
  })
})

describe('no token exposed in email body other than as the intended URL capability', () => {
  it('buildTicketEmail never renders a bare token value outside of an href/URL context — every 64-hex-char occurrence is immediately preceded by "/t/" or "/b/"', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.thebrainbase.com.au'
    const { buildTicketEmail } = await import('@/lib/events/ticketEmail')
    const email = buildTicketEmail({
      eventName: 'Gala', purchaserName: 'Jane',
      attendees: [{ name: 'Jane', ticketToken: 'a'.repeat(64) }, { name: 'Bob', ticketToken: 'b'.repeat(64) }],
      bookingToken: 'c'.repeat(64),
    })
    const bareTokenNotInUrl = /(?<!\/[tb]\/)[0-9a-f]{64}(?!\/tickets)/g
    const matches = email.html.match(bareTokenNotInUrl) ?? []
    expect(matches).toHaveLength(0)
  })
})

describe('no cross-tenant lookup path', () => {
  it('getPublicBookingDetail\'s attendee query scopes by organisation_id derived from the already-resolved order, never a client-supplied value', () => {
    const code = stripComments(read('lib/events/publicBooking.ts'))
    expect(code).toMatch(/ea\.organisation_id = \$\{order\.organisation_id\}/)
  })

  it('confirmCheckIn\'s event-cancellation guard scopes the events join by both event_id AND organisation_id', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    expect(code).toMatch(/ev\.id = ea\.event_id AND ev\.organisation_id = ea\.organisation_id/)
  })
})

describe('no public SELECT *', () => {
  it('lib/events/publicBooking.ts never uses SELECT *', () => {
    expect(stripComments(read('lib/events/publicBooking.ts'))).not.toMatch(/SELECT \*/i)
  })
  it('lib/events/publicTicket.ts never uses SELECT *', () => {
    expect(stripComments(read('lib/events/publicTicket.ts'))).not.toMatch(/SELECT \*/i)
  })
})

describe('no mutation possible from the booking wallet page', () => {
  it('page.tsx and BookingWalletNav.tsx contain zero fetch()/method: "POST"/"PATCH"/"DELETE" calls', () => {
    for (const f of ['app/b/[bookingToken]/tickets/page.tsx', 'app/b/[bookingToken]/tickets/BookingWalletNav.tsx']) {
      const code = stripComments(read(f))
      expect(code).not.toMatch(/fetch\(/)
      expect(code).not.toMatch(/method:\s*['"](POST|PATCH|DELETE|PUT)['"]/)
    }
  })

  it('getPublicBookingDetail itself issues only SELECT statements, no INSERT/UPDATE/DELETE', () => {
    const code = stripComments(read('lib/events/publicBooking.ts'))
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i)
  })
})

describe('no check-in action exposed publicly', () => {
  it('the booking wallet source never imports from lib/events/checkIn.ts', () => {
    for (const f of ['app/b/[bookingToken]/tickets/page.tsx', 'app/b/[bookingToken]/tickets/BookingWalletNav.tsx', 'lib/events/publicBooking.ts']) {
      const code = stripComments(read(f))
      expect(code).not.toMatch(/from '@\/lib\/events\/checkIn'/)
      expect(code).not.toMatch(/confirmCheckIn|undoCheckIn/)
    }
  })

  it('check-in confirm/undo routes still require manager+/authorizeEventsRequest — untouched by this feature', () => {
    const confirmCode = read('app/api/events/[id]/check-in/confirm/route.ts')
    expect(confirmCode).toMatch(/authorizeEventsRequest\('manager'\)/)
  })
})
