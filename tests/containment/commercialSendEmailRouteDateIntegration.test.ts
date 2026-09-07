import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C3-EMAIL-FIX — M. end-to-end regression test for the exact bug
// the controlled production email smoke test caught. Unlike
// commercialQuoteSendEmailRoute.test.ts (which mocks
// '@/lib/commercial/quoteEmail' entirely, so it only proves the ROUTE's
// own logic), this file leaves lib/commercial/quoteEmail.ts and
// lib/commercial/quotePdf.ts and lib/commercial/dates.ts REAL — only the
// network boundary (lib/email.ts's sendEmail) and the filesystem read
// for the brand-mark PNG are mocked. A Date-typed issue_date/expiry_date
// (the exact real production shape — see this phase's own report) is
// fed all the way through getQuoteWithLines -> the real sendQuoteEmail
// -> the real buildQuotePdf/buildQuoteEmail -> back to the route, and
// the route must return a normal structured JSON response, never an
// unhandled exception / framework-level 500.

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const getQuoteWithLinesMock = vi.fn()
vi.mock('@/lib/commercial/quotes', () => ({ getQuoteWithLines: (...a: unknown[]) => getQuoteWithLinesMock(...a) }))

const getBusinessProfileMock = vi.fn()
vi.mock('@/lib/commercial/businessProfile', () => ({ getBusinessProfile: (...a: unknown[]) => getBusinessProfileMock(...a) }))

const logQuoteEmailSentMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({ logQuoteEmailSent: (...a: unknown[]) => logQuoteEmailSentMock(...a) }))

const recordDeliveryAttemptMock = vi.fn()
const secondsSinceLastAttemptMock = vi.fn()
vi.mock('@/lib/commercial/documentDeliveries', () => ({
  recordDeliveryAttempt: (...a: unknown[]) => recordDeliveryAttemptMock(...a),
  secondsSinceLastAttempt: (...a: unknown[]) => secondsSinceLastAttemptMock(...a),
}))

// The ONLY two things mocked from the real rendering/sending path: the
// network call itself, and the filesystem read for the brand-mark PNG
// (so this test doesn't depend on public/Brand/ existing on disk from
// the test runner's cwd).
const sendEmailMock = vi.fn()
vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>()
  return { ...actual, sendEmail: (...args: unknown[]) => sendEmailMock(...args) }
})
// A real (if trivial) 1x1 transparent PNG — jsPDF's addImage() parses
// actual PNG header/IHDR bytes, so an arbitrary non-PNG buffer (e.g.
// Buffer.from('fake-png-bytes')) throws inside addImage() for a reason
// UNRELATED to the date bug this test exists to prove is fixed, which
// would make this test's pass/fail meaningless for its stated purpose.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
vi.mock('node:fs/promises', () => ({ default: { readFile: vi.fn().mockResolvedValue(Buffer.from(TINY_PNG_BASE64, 'base64')) } }))

const { POST } = await import('@/app/api/commercial/quotes/[id]/send-email/route')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager' }

// The exact real production shape: issue_date/expiry_date as native
// Date objects (not strings) — see this phase's report for how
// @neondatabase/serverless produces this for a server-side, in-process
// read (as opposed to a browser fetch, which goes through JSON first).
const DATE_BACKED_QUOTE = {
  quote: {
    id: 'q1', organisation_id: 'org-a', status: 'SENT', quote_number: 'QUO-000001',
    email_snapshot: 'jane@example.com', customer_name_snapshot: 'Jane', total_cents: 40000, currency: 'AUD',
    subtotal_cents: 40000, tax_cents: 0, notes: null, terms: null,
    issue_date: new Date(2026, 8, 7), expiry_date: new Date(2026, 9, 7),
    billing_address_snapshot: null, phone_snapshot: null, tax_identifier_snapshot: null,
  },
  lines: [{
    description_snapshot: 'Consulting', sku_snapshot: null, unit_snapshot: null,
    quantity: 1, unit_price_cents: 40000, tax_code_snapshot: null, tax_rate_snapshot: '0.00', line_total_cents: 40000,
  }],
}

function ctx(id = 'q1') { return { params: Promise.resolve({ id }) } }
function req(body: unknown = { channel: 'EMAIL' }) {
  return new Request('http://localhost/api/commercial/quotes/q1/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  authorizeMock.mockReset()
  getQuoteWithLinesMock.mockReset()
  getBusinessProfileMock.mockReset()
  logQuoteEmailSentMock.mockReset()
  recordDeliveryAttemptMock.mockReset()
  secondsSinceLastAttemptMock.mockReset()
  sendEmailMock.mockReset()

  authorizeMock.mockResolvedValue({ ok: true, session: SESSION })
  getQuoteWithLinesMock.mockResolvedValue(DATE_BACKED_QUOTE)
  getBusinessProfileMock.mockResolvedValue({ organisationName: 'Acme', profile: { tradingName: null, address: null, email: null, phone: null, abn: null } })
  secondsSinceLastAttemptMock.mockResolvedValue(null)
  recordDeliveryAttemptMock.mockResolvedValue({ id: 'd1' })
  logQuoteEmailSentMock.mockResolvedValue(undefined)
})

describe('Phase C3-EMAIL-FIX — M. end-to-end: real rendering path with Date-typed quote dates, through the real route', () => {
  it('returns a normal 200 JSON response — no unhandled exception — for a Date-backed quote (the exact bug this phase fixes)', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: 'resend-msg-1' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, result: 'sent' })
  })

  it('the actual PDF attachment was built successfully (non-empty base64 content) despite Date-typed dates', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: null })
    await POST(req(), ctx())
    const arg = sendEmailMock.mock.calls[0][0] as { attachments: { filename: string; contentBase64: string }[] }
    expect(arg.attachments[0].filename).toBe('QUO-000001.pdf')
    expect(arg.attachments[0].contentBase64.length).toBeGreaterThan(0)
  })

  it('the email HTML body contains the correctly-formatted AU date, not a thrown error, for a Date-typed expiry', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: null })
    await POST(req(), ctx())
    const arg = sendEmailMock.mock.calls[0][0] as { html: string }
    expect(arg.html).toContain('7 Oct 2026')
  })

  it('records a SENT delivery row (proving the full path completed, not a silently-swallowed exception)', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: 'resend-msg-1' })
    await POST(req(), ctx())
    expect(recordDeliveryAttemptMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'SENT' }))
  })
})
