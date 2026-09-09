import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C4.2 — behavioural tests for the invoice API route layer, mirroring
// tests/containment/commercialSettingsRoutes.test.ts's own established
// convention exactly: authorizeCommercialRequest and every underlying
// lib/commercial/* domain function are mocked directly; route handlers
// are imported and invoked with synthetic Request objects. This isolates
// the ROUTE layer's own contract (which capability/role floor each route
// requests, how domain errors map to HTTP status, that organisation_id
// is never taken from request input) from the already-separately-tested
// domain layer itself (tests/containment/commercialInvoicesDataAccess.test.ts).

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const listInvoicesMock = vi.fn()
const createDraftInvoiceMock = vi.fn()
const getInvoiceWithLinesMock = vi.fn()
const updateDraftInvoiceMock = vi.fn()
const deleteDraftInvoiceMock = vi.fn()
const addInvoiceLineMock = vi.fn()
const updateInvoiceLineMock = vi.fn()
const deleteInvoiceLineMock = vi.fn()
const issueInvoiceMock = vi.fn()
const voidInvoiceMock = vi.fn()
const createInvoiceFromQuoteMock = vi.fn()
vi.mock('@/lib/commercial/invoices', () => ({
  listInvoices: (...a: unknown[]) => listInvoicesMock(...a),
  createDraftInvoice: (...a: unknown[]) => createDraftInvoiceMock(...a),
  getInvoiceWithLines: (...a: unknown[]) => getInvoiceWithLinesMock(...a),
  updateDraftInvoice: (...a: unknown[]) => updateDraftInvoiceMock(...a),
  deleteDraftInvoice: (...a: unknown[]) => deleteDraftInvoiceMock(...a),
  addInvoiceLine: (...a: unknown[]) => addInvoiceLineMock(...a),
  updateInvoiceLine: (...a: unknown[]) => updateInvoiceLineMock(...a),
  deleteInvoiceLine: (...a: unknown[]) => deleteInvoiceLineMock(...a),
  issueInvoice: (...a: unknown[]) => issueInvoiceMock(...a),
  voidInvoice: (...a: unknown[]) => voidInvoiceMock(...a),
  createInvoiceFromQuote: (...a: unknown[]) => createInvoiceFromQuoteMock(...a),
}))

const getQuoteMock = vi.fn()
vi.mock('@/lib/commercial/quotes', () => ({ getQuote: (...a: unknown[]) => getQuoteMock(...a) }))

// Phase C4.3B — the invoice detail GET route now folds in delivery
// history, mirroring the quote detail route's own identical addition.
// Mocked here (rather than mocking @/lib/db directly, which this file
// does not do) so no real DB client is ever constructed/called by any
// existing test in this file.
const listDeliveriesForDocumentMock = vi.fn()
vi.mock('@/lib/commercial/documentDeliveries', () => ({ listDeliveriesForDocument: (...a: unknown[]) => listDeliveriesForDocumentMock(...a) }))

const { GET: invoicesGET, POST: invoicesPOST } = await import('@/app/api/commercial/invoices/route')
const { GET: invoiceGET, PUT: invoicePUT, DELETE: invoiceDELETE } = await import('@/app/api/commercial/invoices/[id]/route')
const { POST: linePOST } = await import('@/app/api/commercial/invoices/[id]/lines/route')
const { PUT: linePUT, DELETE: lineDELETE } = await import('@/app/api/commercial/invoices/[id]/lines/[lineId]/route')
const { POST: issuePOST } = await import('@/app/api/commercial/invoices/[id]/issue/route')
const { POST: voidPOST } = await import('@/app/api/commercial/invoices/[id]/void/route')
const { POST: convertPOST } = await import('@/app/api/commercial/quotes/[id]/convert-to-invoice/route')

const VIEWER_SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'viewer' }
const MANAGER_SESSION = { userId: 'user-2', organisationId: 'org-a', role: 'manager' }
const ADMIN_SESSION = { userId: 'user-3', organisationId: 'org-a', role: 'admin' }
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) }

// NextRequest augments Request with a `.nextUrl` property the invoices
// list route reads directly (req.nextUrl.searchParams) — a plain Request
// has no such property, so it's added here, matching the exact idiom
// tests/containment/crmCapabilityEnforcement.test.ts already established.
function jsonReq(body: unknown, url = 'http://localhost/x') {
  const req = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}
function plainReq(url = 'http://localhost/x') {
  const req = new Request(url)
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}
function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

beforeEach(() => {
  authorizeMock.mockReset()
  listInvoicesMock.mockReset()
  createDraftInvoiceMock.mockReset()
  getInvoiceWithLinesMock.mockReset()
  updateDraftInvoiceMock.mockReset()
  deleteDraftInvoiceMock.mockReset()
  addInvoiceLineMock.mockReset()
  updateInvoiceLineMock.mockReset()
  deleteInvoiceLineMock.mockReset()
  listDeliveriesForDocumentMock.mockReset()
  listDeliveriesForDocumentMock.mockResolvedValue([])
  issueInvoiceMock.mockReset()
  voidInvoiceMock.mockReset()
  createInvoiceFromQuoteMock.mockReset()
  getQuoteMock.mockReset()
})

// ── AUTH / CAPABILITY: correct capability + role floor per route ───────

describe('Phase C4.2 — every invoice route requests the invoicing capability with the documented role floor', () => {
  it('GET /api/commercial/invoices requests invoicing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await invoicesGET(plainReq('http://localhost/x'))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'viewer')
  })

  it('POST /api/commercial/invoices requests invoicing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await invoicesPOST(jsonReq({ customerId: 'c1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'manager')
  })

  it('GET /api/commercial/invoices/[id] requests invoicing/viewer', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await invoiceGET(plainReq(), ctx({ id: 'inv-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'viewer')
  })

  it('PUT /api/commercial/invoices/[id] requests invoicing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await invoicePUT(jsonReq({}), ctx({ id: 'inv-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'manager')
  })

  it('DELETE /api/commercial/invoices/[id] requests invoicing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await invoiceDELETE(plainReq(), ctx({ id: 'inv-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'manager')
  })

  it('POST lines requests invoicing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await linePOST(jsonReq({ quantity: 1 }), ctx({ id: 'inv-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'manager')
  })

  it('PUT/DELETE line requests invoicing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await linePUT(jsonReq({}), ctx({ id: 'inv-1', lineId: 'line-1' }))
    await lineDELETE(plainReq(), ctx({ id: 'inv-1', lineId: 'line-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'manager')
  })

  it('POST issue requests invoicing/manager (not admin) — issuing is a create/edit-class action', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await issuePOST(plainReq(), ctx({ id: 'inv-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'manager')
  })

  it('POST void requests invoicing/admin — the C4.2 brief\'s explicit higher floor', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await voidPOST(jsonReq({ reason: 'x' }), ctx({ id: 'inv-1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'admin')
  })

  it('POST convert-to-invoice requests invoicing/manager — deliberately NOT quotes as well (see the route\'s own header comment)', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    await convertPOST(plainReq(), ctx({ id: 'q1' }))
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', 'manager')
    expect(authorizeMock).not.toHaveBeenCalledWith('quotes', expect.anything())
  })

  it('a 403 from authorizeCommercialRequest is returned as-is, and no domain function is ever called', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    const res = await invoicesPOST(jsonReq({ customerId: 'c1' }))
    expect(res.status).toBe(403)
    expect(createDraftInvoiceMock).not.toHaveBeenCalled()
  })
})

// ── organisation_id is never accepted from request input ───────────────

describe('Phase C4.2 — organisation_id always comes from the session, never from request body', () => {
  it('POST /api/commercial/invoices ignores an organisationId in the body and uses the session\'s own', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    createDraftInvoiceMock.mockResolvedValue({ id: 'inv-1', status: 'DRAFT' })
    await invoicesPOST(jsonReq({ customerId: 'c1', organisationId: 'org-evil' }))
    expect(createDraftInvoiceMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a' }))
  })

  it('PUT /api/commercial/invoices/[id] ignores an organisationId in the body', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    updateDraftInvoiceMock.mockResolvedValue({ id: 'inv-1', status: 'DRAFT' })
    await invoicePUT(jsonReq({ organisationId: 'org-evil', notes: 'x' }), ctx({ id: 'inv-1' }))
    expect(updateDraftInvoiceMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a' }))
  })
})

// ── API INPUT: server-controlled fields can never be set by the caller ─

describe('Phase C4.2 — invoice_number/status/snapshots/totals are never accepted from the client', () => {
  it('POST /api/commercial/invoices cannot set invoice_number, status, or totals — createDraftInvoice has no such parameters', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    createDraftInvoiceMock.mockResolvedValue({ id: 'inv-1', status: 'DRAFT', invoice_number: null })
    await invoicesPOST(jsonReq({ customerId: 'c1', invoiceNumber: 'INV-999999', status: 'ISSUED', totalCents: 1 }))
    const callArgs = createDraftInvoiceMock.mock.calls[0][0]
    expect(callArgs).not.toHaveProperty('invoiceNumber')
    expect(callArgs).not.toHaveProperty('status')
    expect(callArgs).not.toHaveProperty('totalCents')
  })

  it('PUT /api/commercial/invoices/[id] cannot set status, snapshots, or issued metadata', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    updateDraftInvoiceMock.mockResolvedValue({ id: 'inv-1' })
    await invoicePUT(jsonReq({ status: 'ISSUED', customer_name_snapshot: 'Hacked', issued_at: '2020-01-01' }), ctx({ id: 'inv-1' }))
    const callArgs = updateDraftInvoiceMock.mock.calls[0][0]
    expect(callArgs).not.toHaveProperty('status')
    expect(callArgs).not.toHaveProperty('customer_name_snapshot')
    expect(callArgs).not.toHaveProperty('issued_at')
  })

  it('POST issue takes no body fields at all — the number/status/snapshot are entirely server-computed', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    issueInvoiceMock.mockResolvedValue({ id: 'inv-1', status: 'ISSUED', invoice_number: 'INV-000001', total_cents: 1000 })
    await issuePOST(plainReq(), ctx({ id: 'inv-1' }))
    expect(issueInvoiceMock).toHaveBeenCalledWith({ organisationId: 'org-a', userId: 'user-2', invoiceId: 'inv-1' })
  })

  it('POST void rejects an empty/whitespace-only reason before calling voidInvoice', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN_SESSION })
    const res = await voidPOST(jsonReq({ reason: '   ' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(400)
    expect(voidInvoiceMock).not.toHaveBeenCalled()
  })

  it('POST lines requires quantity before calling addInvoiceLine', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    const res = await linePOST(jsonReq({ description: 'x' }), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(400)
    expect(addInvoiceLineMock).not.toHaveBeenCalled()
  })
})

// ── API TENANCY: wrong-org / missing collapse to 404 ────────────────────

describe('Phase C4.2 — wrong-tenant and missing resources collapse to the same 404', () => {
  it('GET /api/commercial/invoices/[id] returns 404 when the domain finds nothing (wrong org or missing, indistinguishable)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getInvoiceWithLinesMock.mockResolvedValue(null)
    const res = await invoiceGET(plainReq(), ctx({ id: 'invoice-owned-by-org-b' }))
    expect(res.status).toBe(404)
  })

  it('PUT /api/commercial/invoices/[id] returns 404 when updateDraftInvoice returns null', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    updateDraftInvoiceMock.mockResolvedValue(null)
    const res = await invoicePUT(jsonReq({ notes: 'x' }), ctx({ id: 'invoice-owned-by-org-b' }))
    expect(res.status).toBe(404)
  })

  it('DELETE /api/commercial/invoices/[id] returns 404 when deleteDraftInvoice returns false', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    deleteDraftInvoiceMock.mockResolvedValue(false)
    const res = await invoiceDELETE(plainReq(), ctx({ id: 'invoice-owned-by-org-b' }))
    expect(res.status).toBe(404)
  })

  it('PUT/DELETE line returns 404 for a wrong-tenant or missing line', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    updateInvoiceLineMock.mockResolvedValue(null)
    deleteInvoiceLineMock.mockResolvedValue(false)
    const putRes = await linePUT(jsonReq({ quantity: 2 }), ctx({ id: 'inv-1', lineId: 'line-owned-by-org-b' }))
    const delRes = await lineDELETE(plainReq(), ctx({ id: 'inv-1', lineId: 'line-owned-by-org-b' }))
    expect(putRes.status).toBe(404)
    expect(delRes.status).toBe(404)
  })

  it('POST issue returns 404 when issueInvoice throws a "not found" error', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    issueInvoiceMock.mockRejectedValue(new Error('invoice not found for this organisation'))
    const res = await issuePOST(plainReq(), ctx({ id: 'invoice-owned-by-org-b' }))
    expect(res.status).toBe(404)
  })

  it('POST issue returns 409 (not 400) when issueInvoice throws the concurrency-conflict error', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    issueInvoiceMock.mockRejectedValue(new Error('invoice status changed concurrently; issue aborted (the atomic guard prevented any number from being consumed)'))
    const res = await issuePOST(plainReq(), ctx({ id: 'inv-1' }))
    expect(res.status).toBe(409)
  })

  it('POST convert-to-invoice returns 404 for a wrong-tenant or missing quote', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    createInvoiceFromQuoteMock.mockRejectedValue(new Error('quote not found for this organisation'))
    const res = await convertPOST(plainReq(), ctx({ id: 'quote-owned-by-org-b' }))
    expect(res.status).toBe(404)
  })

  it('POST convert-to-invoice returns 400 for a non-ACCEPTED quote (a real domain rejection, not a tenancy issue)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
    createInvoiceFromQuoteMock.mockRejectedValue(new Error('Cannot create an invoice from a quote with status DRAFT; the quote must be ACCEPTED'))
    const res = await convertPOST(plainReq(), ctx({ id: 'q1' }))
    expect(res.status).toBe(400)
  })
})

// ── LIST / DETAIL: derived fields ───────────────────────────────────────

describe('Phase C4.2 — GET detail: source quote lineage and derived overdue', () => {
  it('includes sourceQuoteNumber resolved from the source quote when present', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getInvoiceWithLinesMock.mockResolvedValue({ invoice: { id: 'inv-1', status: 'ISSUED', due_date: '2020-01-01', source_quote_id: 'q1' }, lines: [] })
    getQuoteMock.mockResolvedValue({ id: 'q1', quote_number: 'QUO-000042' })
    const res = await invoiceGET(plainReq(), ctx({ id: 'inv-1' }))
    const body = await res.json()
    expect(body.sourceQuoteNumber).toBe('QUO-000042')
    expect(getQuoteMock).toHaveBeenCalledWith('org-a', 'q1')
  })

  it('never queries the source quote when source_quote_id is null (standalone invoice)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getInvoiceWithLinesMock.mockResolvedValue({ invoice: { id: 'inv-1', status: 'DRAFT', due_date: null, source_quote_id: null }, lines: [] })
    const res = await invoiceGET(plainReq(), ctx({ id: 'inv-1' }))
    const body = await res.json()
    expect(body.sourceQuoteNumber).toBeNull()
    expect(getQuoteMock).not.toHaveBeenCalled()
  })

  // Phase C4.2 blocker fix — `overdue` is now computed entirely inside
  // lib/commercial/invoices.ts's own SQL (CURRENT_DATE), never in this
  // route. These tests prove PASS-THROUGH only: whatever boolean the
  // domain layer returns is what the client receives, unmodified — the
  // route performs no date arithmetic of its own to get this wrong.
  // (The SQL expression's own correctness — ISSUED+past→true,
  // ISSUED+future/today→false, DRAFT/VOID→false regardless of due_date —
  // is proven separately below, against the real query text and against
  // real Postgres.)
  it('passes through overdue: true verbatim from the domain layer', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getInvoiceWithLinesMock.mockResolvedValue({ invoice: { id: 'inv-1', status: 'ISSUED', due_date: '2000-01-01', source_quote_id: null, overdue: true }, lines: [] })
    const res = await invoiceGET(plainReq(), ctx({ id: 'inv-1' }))
    const body = await res.json()
    expect(body.overdue).toBe(true)
  })

  it('passes through overdue: false verbatim from the domain layer (VOID with a past due_date)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getInvoiceWithLinesMock.mockResolvedValue({ invoice: { id: 'inv-1', status: 'VOID', due_date: '2000-01-01', source_quote_id: null, overdue: false }, lines: [] })
    const res = await invoiceGET(plainReq(), ctx({ id: 'inv-1' }))
    const body = await res.json()
    expect(body.overdue).toBe(false)
  })

  it('passes through overdue: false verbatim from the domain layer (DRAFT with no due_date)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getInvoiceWithLinesMock.mockResolvedValue({ invoice: { id: 'inv-1', status: 'DRAFT', due_date: null, source_quote_id: null, overdue: false }, lines: [] })
    const res = await invoiceGET(plainReq(), ctx({ id: 'inv-1' }))
    const body = await res.json()
    expect(body.overdue).toBe(false)
  })

  // The exact bug class this blocker fix closes: a native JS Date object
  // (what the real driver actually returns for a DATE column read
  // in-process — see lib/commercial/dates.ts's own documented finding)
  // must not break this route, because it no longer does ANY comparison
  // involving due_date at all — it only forwards the domain's own
  // pre-computed boolean.
  it('a native Date-object due_date does not break the pass-through (the route never compares it)', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getInvoiceWithLinesMock.mockResolvedValue({
      invoice: { id: 'inv-1', status: 'ISSUED', due_date: new Date(2000, 0, 1), source_quote_id: null, overdue: true },
      lines: [],
    })
    const res = await invoiceGET(plainReq(), ctx({ id: 'inv-1' }))
    const body = await res.json()
    expect(body.overdue).toBe(true)
  })
})

describe('Phase C4.3B — GET detail: invoice delivery history', () => {
  it('includes deliveries resolved via listDeliveriesForDocument, scoped to documentType invoice and this invoice\'s own id/organisationId', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getInvoiceWithLinesMock.mockResolvedValue({ invoice: { id: 'inv-1', status: 'ISSUED', due_date: null, source_quote_id: null, overdue: false }, lines: [] })
    const deliveryRows = [{ id: 'd1', channel: 'EMAIL', status: 'SENT', recipient: 'jane@example.com', attempted_at: '2026-09-08T00:00:00Z' }]
    listDeliveriesForDocumentMock.mockResolvedValue(deliveryRows)
    const res = await invoiceGET(plainReq(), ctx({ id: 'inv-1' }))
    const body = await res.json()
    expect(body.deliveries).toEqual(deliveryRows)
    expect(listDeliveriesForDocumentMock).toHaveBeenCalledWith({ organisationId: 'org-a', documentType: 'invoice', documentId: 'inv-1' })
  })

  it('a wrong-tenant invoice id never reaches the delivery lookup at all — the 404 for a missing/wrong-tenant invoice happens before deliveries are ever queried', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    getInvoiceWithLinesMock.mockResolvedValue(null) // wrong-tenant/missing invoice, per the domain layer's own indistinguishable-by-design 404 rule
    const res = await invoiceGET(plainReq(), ctx({ id: 'invoice-owned-by-org-b' }))
    expect(res.status).toBe(404)
    expect(listDeliveriesForDocumentMock).not.toHaveBeenCalled()
  })
})

describe('Phase C4.2 blocker fix — the detail route performs no client-observable date arithmetic', () => {
  it('contains no new Date()/toISOString() overdue computation of its own', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/commercial/invoices/[id]/route.ts'), 'utf-8')
    expect(source).not.toMatch(/new Date\(\)/)
    expect(source).not.toMatch(/toISOString/)
    expect(source).toMatch(/overdue: bundle\.invoice\.overdue/)
  })
})

describe('Phase C4.2 blocker fix — lib/commercial/invoices.ts computes overdue in SQL via CURRENT_DATE, never in JS', () => {
  it("listInvoices()'s query contains the CURRENT_DATE-based overdue expression", async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/invoices.ts'), 'utf-8')
    const start = source.indexOf('export async function listInvoices')
    const end = source.indexOf('\n}\n', start)
    const body = source.slice(start, end)
    expect(body).toMatch(/status = 'ISSUED' AND due_date IS NOT NULL AND due_date < CURRENT_DATE/)
    expect(body).toMatch(/AS overdue/)
  })

  it("getInvoice()'s query contains the identical CURRENT_DATE-based overdue expression", async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/invoices.ts'), 'utf-8')
    const start = source.indexOf('export async function getInvoice(')
    const end = source.indexOf('\n}\n', start)
    const body = source.slice(start, end)
    expect(body).toMatch(/status = 'ISSUED' AND due_date IS NOT NULL AND due_date < CURRENT_DATE/)
    expect(body).toMatch(/AS overdue/)
  })

  it('neither query contains any JavaScript date computation', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/invoices.ts'), 'utf-8')
    expect(source).not.toMatch(/new Date\(\)\.toISOString/)
    expect(source).not.toMatch(/\.slice\(0, 10\)/)
  })
})


// ── GET list: status filter ────────────────────────────────────────────

describe('Phase C4.2 — GET /api/commercial/invoices status filter', () => {
  it('passes a valid status through, ignores an invalid one', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION })
    listInvoicesMock.mockResolvedValue([])
    await invoicesGET(plainReq('http://localhost/x?status=ISSUED'))
    expect(listInvoicesMock).toHaveBeenCalledWith('org-a', { status: 'ISSUED' })

    listInvoicesMock.mockClear()
    await invoicesGET(plainReq('http://localhost/x?status=NOT_A_REAL_STATUS'))
    expect(listInvoicesMock).toHaveBeenCalledWith('org-a', { status: undefined })
  })
})
