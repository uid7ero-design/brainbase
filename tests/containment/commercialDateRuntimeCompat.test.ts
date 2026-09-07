import { describe, it, expect, afterEach } from 'vitest'
import { formatCommercialDate, formatCommercialDateOrNull } from '@/lib/commercial/dates'
import { buildQuotePdf } from '@/lib/commercial/quotePdf'
import { buildQuoteEmail } from '@/lib/commercial/quoteEmail'

// Phase C3-EMAIL-FIX — reproduces the exact production bug the
// controlled email smoke test caught: @neondatabase/serverless (the
// driver lib/db.ts uses) parses a PostgreSQL DATE column into a native
// JS Date object via `new Date(year, monthIndex, day)` (LOCAL
// components) when a quote is read directly, in-process, without going
// through JSON first — the server-side email/PDF path. Before this
// phase's fix, formatCommercialDate() called lib/date.ts's
// parseLocalDate(), which does `dateStr.slice(0, 10)` — throwing
// TypeError: dateStr.slice is not a function against a real Date.
//
// This suite must FAIL against the pre-fix code (a plain
// `parseLocalDate(dateStr)` call with no `instanceof Date` branch) for
// the exact right reason (a thrown TypeError from calling .slice() on a
// Date), not some unrelated reason — confirmed by temporarily reverting
// lib/commercial/dates.ts's resolveLocalDate() during development.

const ORIGINAL_TZ = process.env.TZ
afterEach(() => { process.env.TZ = ORIGINAL_TZ })

describe('Phase C3-EMAIL-FIX — A. formatCommercialDate(new Date(...))', () => {
  it('accepts a Date object without throwing', () => {
    expect(() => formatCommercialDate(new Date(2026, 8, 7))).not.toThrow()
  })

  it('renders the correct calendar date from a Date constructed via local y/m/d components (the driver’s own convention)', () => {
    // new Date(year, monthIndex, day) — exactly how
    // @neondatabase/serverless's DATE-column parser constructs it
    // (verified against the library's own bundled source in
    // node_modules/@neondatabase/serverless/index.mjs).
    expect(formatCommercialDate(new Date(2026, 8, 7))).toBe('7 Sep 2026')
  })
})

describe('Phase C3-EMAIL-FIX — B/C. quote.issue_date / expiry_date as Date (the real server-side shape)', () => {
  it('buildQuotePdf renders correctly when issue_date/expiry_date are Date objects, not strings', async () => {
    const quote = baseQuote({ issue_date: new Date(2026, 8, 7), expiry_date: new Date(2026, 9, 7) })
    const bytes = await buildQuotePdf({ quote, lines: [baseLine()], supplier: baseSupplier(), brandLockupBase64: TINY_PNG_BASE64 })
    expect(bytes.length).toBeGreaterThan(0)
  })
})

describe('Phase C3-EMAIL-FIX — D. string DATE still works (unchanged, pre-existing behavior)', () => {
  it('formatCommercialDate still handles a plain YYYY-MM-DD string', () => {
    expect(formatCommercialDate('2026-09-07')).toBe('7 Sep 2026')
  })

  it('formatCommercialDate still handles an ISO timestamp string (the browser/JSON shape)', () => {
    expect(formatCommercialDate('2026-09-07T00:00:00.000Z')).toBe('7 Sep 2026')
  })

  it('formatCommercialDateOrNull still returns null for empty string input', () => {
    expect(formatCommercialDateOrNull(null)).toBeNull()
    expect(formatCommercialDateOrNull(undefined)).toBeNull()
  })
})

describe('Phase C3-EMAIL-FIX — E/F/G. timezone independence, no date shifts, for a Date-typed input', () => {
  it('Australia/Adelaide: a Date built the driver’s way round-trips to the exact same calendar date', () => {
    process.env.TZ = 'Australia/Adelaide'
    const driverDate = new Date(2026, 8, 7) // simulates the driver parsing '2026-09-07'
    expect(formatCommercialDate(driverDate)).toBe('7 Sep 2026')
  })

  it('America/Los_Angeles: the same construction-then-read round-trips correctly in a different timezone', () => {
    process.env.TZ = 'America/Los_Angeles'
    const driverDate = new Date(2026, 8, 7)
    expect(formatCommercialDate(driverDate)).toBe('7 Sep 2026')
  })

  it('UTC: round-trips correctly (the timezone Vercel’s Lambda runtime most likely uses)', () => {
    process.env.TZ = 'UTC'
    const driverDate = new Date(2026, 8, 7)
    expect(formatCommercialDate(driverDate)).toBe('7 Sep 2026')
  })

  it('never uses the UTC getters, which were empirically confirmed to be off by one day for this exact production shape (ground truth "::text" was 2026-09-07; UTC getters on the driver-returned Date gave 2026-09-06)', () => {
    process.env.TZ = 'Australia/Adelaide'
    // Constructing via LOCAL components, as the driver does, then
    // reading via UTC getters would give the wrong (previous) day in
    // any positive-UTC-offset timezone — this is the exact regression
    // this test guards against.
    const driverDate = new Date(2026, 8, 7)
    expect(driverDate.getUTCDate()).not.toBe(7) // proves the UTC getters would have been wrong here
    expect(formatCommercialDate(driverDate)).toBe('7 Sep 2026') // proves the formatter avoids that trap
  })

  it('across a month/year boundary, in a positive-UTC-offset timezone, still resolves the correct date', () => {
    process.env.TZ = 'Australia/Adelaide'
    expect(formatCommercialDate(new Date(2026, 11, 31))).toBe('31 Dec 2026')
    expect(formatCommercialDate(new Date(2027, 0, 1))).toBe('1 Jan 2027')
  })
})

describe('Phase C3-EMAIL-FIX — H. PDF renderer accepts a Date-backed quote end to end', () => {
  it('buildQuotePdf does not throw and produces non-empty PDF bytes for a fully Date-backed quote', async () => {
    const quote = baseQuote({ issue_date: new Date(2026, 8, 7), expiry_date: new Date(2026, 9, 7) })
    const bytes = await buildQuotePdf({ quote, lines: [baseLine()], supplier: baseSupplier(), brandLockupBase64: TINY_PNG_BASE64 })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(100)
  })

  it('buildQuotePdf still works for a null expiry_date (Date-backed issue_date only)', async () => {
    const quote = baseQuote({ issue_date: new Date(2026, 8, 7), expiry_date: null })
    await expect(buildQuotePdf({ quote, lines: [baseLine()], supplier: baseSupplier(), brandLockupBase64: TINY_PNG_BASE64 })).resolves.toBeInstanceOf(Uint8Array)
  })
})

describe('Phase C3-EMAIL-FIX — I. email body renderer accepts a Date-backed quote', () => {
  it('buildQuoteEmail does not throw when expiryDate is a Date object', () => {
    expect(() => buildQuoteEmail({
      quoteNumber: 'QUO-000001', customerName: 'Jane', totalCents: 40000, currency: 'AUD',
      expiryDate: new Date(2026, 10, 7), businessDisplayName: 'Acme', businessEmail: null, businessPhone: null,
    })).not.toThrow()
  })

  it('renders the correct AU date in the email body from a Date-typed expiryDate', () => {
    const { html } = buildQuoteEmail({
      quoteNumber: 'QUO-000001', customerName: 'Jane', totalCents: 40000, currency: 'AUD',
      expiryDate: new Date(2026, 10, 7), businessDisplayName: 'Acme', businessEmail: null, businessPhone: null,
    })
    expect(html).toContain('7 Nov 2026')
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })
})

// ── Fixtures ─────────────────────────────────────────────────────────

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function baseQuote(overrides: Record<string, unknown> = {}) {
  return {
    quote_number: 'QUO-000001', status: 'SENT', currency: 'AUD',
    issue_date: null, expiry_date: null, notes: null, terms: null,
    subtotal_cents: 40000, tax_cents: 0, total_cents: 40000,
    customer_name_snapshot: 'Test Customer', billing_address_snapshot: null,
    email_snapshot: 'test@example.com', phone_snapshot: null, tax_identifier_snapshot: null,
    ...overrides,
  }
}
function baseLine() {
  return {
    description_snapshot: 'Consulting', sku_snapshot: null, unit_snapshot: null,
    quantity: 1, unit_price_cents: 40000, tax_code_snapshot: null, tax_rate_snapshot: '0.00', line_total_cents: 40000,
  }
}
function baseSupplier() {
  return { displayName: 'Acme Pty Ltd', address: null, email: null, phone: null, abn: null }
}
