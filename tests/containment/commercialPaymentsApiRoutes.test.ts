import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C5.2 — route-layer tests for the new payments API surface,
// mirroring tests/containment/commercialInvoiceApiRoutes.test.ts's own
// established convention exactly: authorizeCommercialRequest and the
// underlying lib/commercial/payments functions are mocked directly, and
// route handlers are invoked with synthetic Request objects. This
// isolates the ROUTE layer's own contract (capability/role floor,
// domain-error-to-HTTP-status mapping, organisation_id never taken from
// request input) from the already-separately-tested domain layer
// (commercialPaymentsDomain.test.ts).

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const recordInvoicePaymentMock = vi.fn()
const reverseInvoicePaymentMock = vi.fn()
const isValidPaymentMethodMock = vi.fn()
vi.mock('@/lib/commercial/payments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/payments')>()
  return {
    ...actual,
    recordInvoicePayment: (...a: unknown[]) => recordInvoicePaymentMock(...a),
    reverseInvoicePayment: (...a: unknown[]) => reverseInvoicePaymentMock(...a),
    isValidPaymentMethod: (...a: unknown[]) => isValidPaymentMethodMock(...a),
    getInvoicePaymentSummary: vi.fn().mockResolvedValue({ amount_paid_cents: 0, outstanding_balance_cents: 0, payment_state: 'UNPAID', payments: [] }),
  }
})

const getInvoiceMock = vi.fn()
vi.mock('@/lib/commercial/invoices', () => ({ getInvoice: (...a: unknown[]) => getInvoiceMock(...a) }))

const { POST: paymentsPOST } = await import('@/app/api/commercial/invoices/[id]/payments/route')
const { POST: reversePOST } = await import('@/app/api/commercial/invoices/[id]/payments/[paymentId]/reverse/route')

const MANAGER_SESSION = { userId: 'user-2', organisationId: 'org-a', role: 'manager' }
const ADMIN_SESSION = { userId: 'user-3', organisationId: 'org-a', role: 'admin' }
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) }

function jsonReq(body: unknown, url = 'http://localhost/x') {
  const req = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}
function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) }
}

beforeEach(() => {
  authorizeMock.mockReset()
  recordInvoicePaymentMock.mockReset()
  reverseInvoicePaymentMock.mockReset()
  isValidPaymentMethodMock.mockReset()
  isValidPaymentMethodMock.mockImplementation((v: unknown) => ['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER'].includes(v as string))
  getInvoiceMock.mockReset()
  getInvoiceMock.mockResolvedValue({ id: 'inv-1', organisation_id: 'org-a', total_cents: 13200 })
})

describe('Phase C5.2 — POST .../payments requests invoicing/manager (same floor as every other invoice mutation)', () => {
  it('unauthenticated/forbidden session is rejected before recordInvoicePayment is ever called', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    const res = await paymentsPOST(jsonReq({ amount_cents: 100, method: 'CASH' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(403)
    expect(recordInvoicePaymentMock).not.toHaveBeenCalled()
  })

  it('requests exactly invoicing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await paymentsPOST(jsonReq({ amount_cents: 100, method: 'CASH' }), ctx({ id: 'inv-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'manager')
  })

  it('a viewer-role session (below the floor) never reaches this route\'s own logic — authorizeCommercialRequest itself enforces the floor and returns FORBIDDEN', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN) // authorizeCommercialRequest is the actual enforcement point; this route trusts it entirely
    const res = await paymentsPOST(jsonReq({ amount_cents: 100, method: 'CASH' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(403)
  })
})

describe('Phase C5.2 — POST .../payments validation', () => {
  it('rejects a missing amount_cents', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    const res = await paymentsPOST(jsonReq({ method: 'CASH' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(400)
    expect(recordInvoicePaymentMock).not.toHaveBeenCalled()
  })

  it('rejects a non-positive amount_cents', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    const res = await paymentsPOST(jsonReq({ amount_cents: 0, method: 'CASH' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(400)
  })

  it('rejects a non-integer amount_cents', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    const res = await paymentsPOST(jsonReq({ amount_cents: 100.5, method: 'CASH' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(400)
  })

  it('rejects an invalid payment method', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    const res = await paymentsPOST(jsonReq({ amount_cents: 100, method: 'STRIPE' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(400)
    expect(recordInvoicePaymentMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid received_at', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    const res = await paymentsPOST(jsonReq({ amount_cents: 100, method: 'CASH', received_at: 'not-a-date' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(400)
  })

  it('never accepts provider/provider_reference from this request body at all — even if supplied, recordInvoicePayment is called without them', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    recordInvoicePaymentMock.mockResolvedValue({ payment: { id: 'pay-1' }, summary: {} })
    await paymentsPOST(jsonReq({ amount_cents: 100, method: 'CASH', provider: 'stripe', provider_reference: 'evt_123' }), ctx({ id: 'inv-1' }))
    const callArgs = recordInvoicePaymentMock.mock.calls[0][0]
    expect(callArgs).not.toHaveProperty('provider')
    expect(callArgs).not.toHaveProperty('providerReference')
  })
})

describe('Phase C5.2 — POST .../payments organisation scoping', () => {
  it('organisationId always comes from the session, never from the request body', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    recordInvoicePaymentMock.mockResolvedValue({ payment: { id: 'pay-1' }, summary: {} })
    await paymentsPOST(jsonReq({ amount_cents: 100, method: 'CASH', organisation_id: 'org-HOSTILE', organisationId: 'org-HOSTILE' }), ctx({ id: 'inv-1' }))
    expect(recordInvoicePaymentMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a' }))
  })
})

describe('Phase C5.2 — POST .../payments success and error mapping', () => {
  it('valid payment returns 201 with the payment and invoice_payment_summary', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    recordInvoicePaymentMock.mockResolvedValue({
      payment: { id: 'pay-1', amount_cents: 13200, status: 'RECORDED' },
      summary: { amount_paid_cents: 13200, outstanding_balance_cents: 0, payment_state: 'PAID', payments: [] },
    })
    const res = await paymentsPOST(jsonReq({ amount_cents: 13200, method: 'BANK_TRANSFER' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.payment.id).toBe('pay-1')
    expect(body.invoice_payment_summary.payment_state).toBe('PAID')
  })

  it('maps "not found" to 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    recordInvoicePaymentMock.mockRejectedValue(new Error('invoice not found for this organisation'))
    const res = await paymentsPOST(jsonReq({ amount_cents: 100, method: 'CASH' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(404)
  })

  it('maps a DRAFT-invoice rejection to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    recordInvoicePaymentMock.mockRejectedValue(new Error('cannot record a payment against a DRAFT invoice'))
    const res = await paymentsPOST(jsonReq({ amount_cents: 100, method: 'CASH' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(409)
  })

  it('maps a VOID-invoice rejection to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    recordInvoicePaymentMock.mockRejectedValue(new Error('cannot record a payment against a VOID invoice'))
    const res = await paymentsPOST(jsonReq({ amount_cents: 100, method: 'CASH' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(409)
  })

  it('maps an overpayment rejection to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    recordInvoicePaymentMock.mockRejectedValue(new Error('payment amount exceeds remaining balance (remaining: 5000 cents)'))
    const res = await paymentsPOST(jsonReq({ amount_cents: 9000, method: 'CASH' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(409)
  })
})

describe('Phase C5.2 — POST .../payments/[paymentId]/reverse', () => {
  it('requests exactly invoicing/admin (same floor as Void Invoice)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await reversePOST(jsonReq({ reason: 'x' }), ctx({ id: 'inv-1', paymentId: 'pay-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'admin')
  })

  it('rejects a missing/empty reason before calling reverseInvoicePayment', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    const res = await reversePOST(jsonReq({ reason: '   ' }), ctx({ id: 'inv-1', paymentId: 'pay-1' }))
    expect(res.status).toBe(400)
    expect(reverseInvoicePaymentMock).not.toHaveBeenCalled()
  })

  it('organisationId comes from the session, never the request body', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    reverseInvoicePaymentMock.mockResolvedValue({ id: 'pay-1', status: 'REVERSED' })
    await reversePOST(jsonReq({ reason: 'oops', organisationId: 'org-HOSTILE' }), ctx({ id: 'inv-1', paymentId: 'pay-1' }))
    expect(reverseInvoicePaymentMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a' }))
  })

  it('valid reversal returns 200 with the updated payment and derived summary', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    reverseInvoicePaymentMock.mockResolvedValue({ id: 'pay-1', status: 'REVERSED', reversal_reason: 'oops' })
    const res = await reversePOST(jsonReq({ reason: 'oops' }), ctx({ id: 'inv-1', paymentId: 'pay-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payment.status).toBe('REVERSED')
    expect(body.invoice_payment_summary).toBeTruthy()
  })

  it('maps "not found" to 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    reverseInvoicePaymentMock.mockRejectedValue(new Error('payment not found for this invoice and organisation'))
    const res = await reversePOST(jsonReq({ reason: 'oops' }), ctx({ id: 'inv-1', paymentId: 'pay-1' }))
    expect(res.status).toBe(404)
  })

  it('maps "already reversed" to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    reverseInvoicePaymentMock.mockRejectedValue(new Error('payment already reversed, or changed concurrently'))
    const res = await reversePOST(jsonReq({ reason: 'oops' }), ctx({ id: 'inv-1', paymentId: 'pay-1' }))
    expect(res.status).toBe(409)
  })
})

describe('Phase C5.2 — no DELETE/update payment route exists', () => {
  it('the payments collection route module exports no PUT/PATCH/DELETE/GET handler', async () => {
    const mod: Record<string, unknown> = await import('@/app/api/commercial/invoices/[id]/payments/route')
    for (const method of ['PUT', 'PATCH', 'DELETE', 'GET']) {
      expect(method in mod).toBe(false)
    }
  })

  it('the reversal route module exports no other handler besides POST', async () => {
    const mod: Record<string, unknown> = await import('@/app/api/commercial/invoices/[id]/payments/[paymentId]/reverse/route')
    for (const method of ['PUT', 'PATCH', 'DELETE', 'GET']) {
      expect(method in mod).toBe(false)
    }
  })
})
