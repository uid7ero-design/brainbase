import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C6.5 — behavioural + containment tests for the Purchase Order
// document API ROUTE layer (PDF route, email route) and client/server
// boundary containment. Real PDF content/layout behavior is covered
// separately in tests/containment/commercialPurchaseOrderPdfLayout.test.ts
// (this file mocks @/lib/commercial/purchaseOrderPdf wholesale to
// isolate the route layer, so it cannot also exercise the real
// builder — see that file's own header comment for why they are split).
// Mirrors tests/containment/commercialInvoiceSendEmailRoute.test.ts's
// own established convention: mock every sibling module, exercise the
// route handler directly.

describe('Phase C6.5 — purchaseOrderPdf.ts is guarded as server-only', () => {
  it('imports the server-only package as its very first import', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/purchaseOrderPdf.ts'), 'utf-8')
    const firstImportLine = source.split('\n').find((l) => l.trim().startsWith('import '))?.trim()
    expect(firstImportLine).toMatch(/^import ['"]server-only['"];?$/)
  })
})

describe('Phase C6.5 — purchaseOrderEmail.ts is guarded as server-only', () => {
  it('imports the server-only package as its very first import', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/purchaseOrderEmail.ts'), 'utf-8')
    const firstImportLine = source.split('\n').find((l) => l.trim().startsWith('import '))?.trim()
    expect(firstImportLine).toMatch(/^import ['"]server-only['"];?$/)
  })
})

describe('Phase C6.5 — no client component anywhere in the repo imports the PDF/email server modules', () => {
  const ROOT = path.resolve(__dirname, '../../')
  const SCAN_DIRS = ['app', 'components', 'lib']

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full)
    }
    return out
  }

  it('every "use client" file is free of @/lib/db, @/lib/commercial/purchaseOrderPdf, and @/lib/commercial/purchaseOrderEmail imports', () => {
    const violations: string[] = []
    for (const dir of SCAN_DIRS) {
      const full = path.join(ROOT, dir)
      if (!fs.existsSync(full)) continue
      for (const file of walk(full)) {
        const text = fs.readFileSync(file, 'utf-8')
        if (!text.includes("'use client'")) continue
        if (
          /from ['"]@\/lib\/db['"]/.test(text) ||
          /from ['"]@\/lib\/commercial\/purchaseOrderPdf['"]/.test(text) ||
          /from ['"]@\/lib\/commercial\/purchaseOrderEmail['"]/.test(text)
        ) {
          violations.push(path.relative(ROOT, file))
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('the PO detail page fetches the PDF via a plain same-origin link, never by importing jsPDF or the PDF builder directly', () => {
    const source = fs.readFileSync(path.resolve(ROOT, "app/commercial/purchasing/purchase-orders/[id]/page.tsx"), 'utf-8')
    expect(source).not.toMatch(/from ['"]jspdf['"]/)
    expect(source).not.toMatch(/buildPurchaseOrderPdf/)
    expect(source).toMatch(/\/api\/commercial\/purchase-orders\/\$\{id\}\/pdf/)
  })
})

// ── PDF API route ────────────────────────────────────────────────────

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const getPurchaseOrderWithLinesMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrders', () => ({ getPurchaseOrderWithLines: (...a: unknown[]) => getPurchaseOrderWithLinesMock(...a) }))

const getBusinessProfileMock = vi.fn()
vi.mock('@/lib/commercial/businessProfile', () => ({ getBusinessProfile: (...a: unknown[]) => getBusinessProfileMock(...a) }))

const buildPurchaseOrderPdfMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrderPdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/purchaseOrderPdf')>()
  return { ...actual, buildPurchaseOrderPdf: (...a: unknown[]) => buildPurchaseOrderPdfMock(...a) }
})

vi.mock('@/lib/commercial/documentEmail', () => ({
  loadBrandLockupBase64Server: vi.fn().mockResolvedValue('base64'),
  maskEmailForAudit: (email: string) => `${email[0]}***`,
  commercialEmailLayout: (body: string) => `<html>${body}</html>`,
  emailDetailRow: (label: string, value: string) => `<tr><td>${label}</td><td>${value}</td></tr>`,
}))

const { GET: pdfGET } = await import('@/app/api/commercial/purchase-orders/[id]/pdf/route')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'viewer' }
const ISSUED_PO = {
  purchaseOrder: {
    id: 'po1', organisation_id: 'org-a', status: 'ISSUED', purchase_order_number: 'PO-000001',
    currency: 'AUD', issued_at: '2026-09-01', delivery_date: null,
    delivery_address_line1: null, delivery_address_line2: null, delivery_suburb: null, delivery_state: null, delivery_postcode: null, delivery_country: null,
    payment_terms_days_snapshot: null, supplier_notes: null, subtotal_cents: 1000, tax_cents: 100, total_cents: 1100,
    supplier_name_snapshot: 'Acme Supplies', supplier_legal_name_snapshot: null, supplier_contact_name_snapshot: null,
    supplier_email_snapshot: 'supplier@example.com', supplier_phone_snapshot: null, supplier_address_snapshot: null,
    supplier_tax_business_number_snapshot: null, supplier_reference_snapshot: null, cancel_reason: null, cancelled_at: null,
  },
  lines: [],
}

function pdfCtx(id = 'po1') { return { params: Promise.resolve({ id }) } }
function plainReq(url = 'http://localhost/x') {
  const req = new Request(url)
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  authorizeMock.mockReset()
  getPurchaseOrderWithLinesMock.mockReset()
  getBusinessProfileMock.mockReset()
  buildPurchaseOrderPdfMock.mockReset()

  authorizeMock.mockResolvedValue({ ok: true, session: SESSION })
  getPurchaseOrderWithLinesMock.mockResolvedValue(ISSUED_PO)
  getBusinessProfileMock.mockResolvedValue({ organisationName: 'Acme', profile: { tradingName: null, address: null, email: null, phone: null, abn: null } })
  buildPurchaseOrderPdfMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
})

describe('Phase C6.5 — GET /api/commercial/purchase-orders/[id]/pdf — auth', () => {
  it('requests purchasing/viewer', async () => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    await pdfGET(plainReq(), pdfCtx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('a denial is returned as-is, no domain function is ever called', async () => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    const res = await pdfGET(plainReq(), pdfCtx())
    expect(res.status).toBe(403)
    expect(getPurchaseOrderWithLinesMock).not.toHaveBeenCalled()
  })
})

describe('Phase C6.5 — GET .../pdf — status gate: only ISSUED and CANCELLED produce a document', () => {
  it('ISSUED succeeds — 200, application/pdf, filename includes the PO number', async () => {
    const res = await pdfGET(plainReq(), pdfCtx())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('PO-000001.pdf')
  })

  it('CANCELLED succeeds — 200', async () => {
    getPurchaseOrderWithLinesMock.mockResolvedValue({ purchaseOrder: { ...ISSUED_PO.purchaseOrder, status: 'CANCELLED' }, lines: [] })
    const res = await pdfGET(plainReq(), pdfCtx())
    expect(res.status).toBe(200)
  })

  it('DRAFT is rejected — 409, never generates a document', async () => {
    getPurchaseOrderWithLinesMock.mockResolvedValue({ purchaseOrder: { ...ISSUED_PO.purchaseOrder, status: 'DRAFT', purchase_order_number: null }, lines: [] })
    const res = await pdfGET(plainReq(), pdfCtx())
    expect(res.status).toBe(409)
    expect(buildPurchaseOrderPdfMock).not.toHaveBeenCalled()
  })

  it('PENDING_APPROVAL is rejected — 409', async () => {
    getPurchaseOrderWithLinesMock.mockResolvedValue({ purchaseOrder: { ...ISSUED_PO.purchaseOrder, status: 'PENDING_APPROVAL', purchase_order_number: null }, lines: [] })
    const res = await pdfGET(plainReq(), pdfCtx())
    expect(res.status).toBe(409)
    expect(buildPurchaseOrderPdfMock).not.toHaveBeenCalled()
  })

  it('APPROVED is rejected — 409', async () => {
    getPurchaseOrderWithLinesMock.mockResolvedValue({ purchaseOrder: { ...ISSUED_PO.purchaseOrder, status: 'APPROVED', purchase_order_number: null }, lines: [] })
    const res = await pdfGET(plainReq(), pdfCtx())
    expect(res.status).toBe(409)
    expect(buildPurchaseOrderPdfMock).not.toHaveBeenCalled()
  })
})

describe('Phase C6.5 — GET .../pdf — tenant isolation', () => {
  it('a wrong-tenant/missing PO id 404s, never reaches PDF generation', async () => {
    getPurchaseOrderWithLinesMock.mockResolvedValue(null)
    const res = await pdfGET(plainReq(), pdfCtx('po-owned-by-org-b'))
    expect(res.status).toBe(404)
    expect(buildPurchaseOrderPdfMock).not.toHaveBeenCalled()
  })
})

describe('Phase C6.5 — GET .../pdf — the builder is fed the PO\'s own persisted snapshot, never a fresh supplier lookup', () => {
  it('passes purchaseOrder straight through from getPurchaseOrderWithLines — no supplier re-fetch of any kind happens in this route', async () => {
    await pdfGET(plainReq(), pdfCtx())
    expect(buildPurchaseOrderPdfMock).toHaveBeenCalledWith(expect.objectContaining({
      purchaseOrder: expect.objectContaining({ supplier_name_snapshot: 'Acme Supplies', purchase_order_number: 'PO-000001' }),
    }))
  })

  it('a rendering failure returns a safe 500, never leaks the underlying error', async () => {
    buildPurchaseOrderPdfMock.mockRejectedValue(new Error('jsPDF internal failure: DATABASE_URL=postgres://real:secret@host/db'))
    const res = await pdfGET(plainReq(), pdfCtx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).not.toContain('DATABASE_URL')
    expect(body.error).not.toContain('secret')
  })
})

// ── Email API route ──────────────────────────────────────────────────

const sendPurchaseOrderEmailMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrderEmail', () => ({ sendPurchaseOrderEmail: (...a: unknown[]) => sendPurchaseOrderEmailMock(...a) }))

const logPurchaseOrderEmailSentMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({ logPurchaseOrderEmailSent: (...a: unknown[]) => logPurchaseOrderEmailSentMock(...a) }))

const recordPurchaseOrderDeliveryAttemptMock = vi.fn()
const secondsSinceLastAttemptMock = vi.fn()
const listDeliveriesForDocumentMock = vi.fn()
vi.mock('@/lib/commercial/documentDeliveries', () => ({
  recordPurchaseOrderDeliveryAttempt: (...a: unknown[]) => recordPurchaseOrderDeliveryAttemptMock(...a),
  secondsSinceLastAttempt: (...a: unknown[]) => secondsSinceLastAttemptMock(...a),
  listDeliveriesForDocument: (...a: unknown[]) => listDeliveriesForDocumentMock(...a),
}))

const { POST: emailPOST } = await import('@/app/api/commercial/purchase-orders/[id]/email/route')
const { GET: poDetailGET } = await import('@/app/api/commercial/purchase-orders/[id]/route')

const MANAGER_SESSION = { userId: 'user-2', organisationId: 'org-a', role: 'manager' }

function emailReq(body: unknown = { channel: 'EMAIL' }) {
  return new Request('http://localhost/api/commercial/purchase-orders/po1/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  sendPurchaseOrderEmailMock.mockReset()
  logPurchaseOrderEmailSentMock.mockReset()
  recordPurchaseOrderDeliveryAttemptMock.mockReset()
  secondsSinceLastAttemptMock.mockReset()
  listDeliveriesForDocumentMock.mockReset()

  authorizeMock.mockResolvedValue({ ok: true, session: MANAGER_SESSION })
  getPurchaseOrderWithLinesMock.mockResolvedValue(ISSUED_PO)
  getBusinessProfileMock.mockResolvedValue({ organisationName: 'Acme', profile: { tradingName: null, address: null, email: null, phone: null, abn: null } })
  secondsSinceLastAttemptMock.mockResolvedValue(null)
  recordPurchaseOrderDeliveryAttemptMock.mockResolvedValue({ id: 'd1' })
  logPurchaseOrderEmailSentMock.mockResolvedValue(undefined)
  listDeliveriesForDocumentMock.mockResolvedValue([])
})

describe('Phase C6.5 — GET .../purchase-orders/[id]: delivery history is folded into the existing detail response', () => {
  it('includes deliveries resolved via listDeliveriesForDocument, scoped to documentType purchase_order and this PO\'s own id/organisationId', async () => {
    const deliveryRows = [{ id: 'd1', channel: 'EMAIL', status: 'SENT', recipient: 'supplier@example.com', attempted_at: '2026-09-08T00:00:00Z' }]
    listDeliveriesForDocumentMock.mockResolvedValue(deliveryRows)
    const res = await poDetailGET(plainReq(), pdfCtx())
    const body = await res.json()
    expect(body.deliveries).toEqual(deliveryRows)
    expect(listDeliveriesForDocumentMock).toHaveBeenCalledWith({ organisationId: 'org-a', documentType: 'purchase_order', documentId: 'po1' })
  })

  it('a wrong-tenant/missing PO never reaches the delivery lookup at all — the 404 happens first', async () => {
    getPurchaseOrderWithLinesMock.mockResolvedValue(null)
    const res = await poDetailGET(plainReq(), pdfCtx('po-owned-by-org-b'))
    expect(res.status).toBe(404)
    expect(listDeliveriesForDocumentMock).not.toHaveBeenCalled()
  })
})

describe('Phase C6.5 — POST .../email — auth: purchasing capability, manager+ floor (matches quote/invoice convention)', () => {
  it('calls authorizeCommercialRequest with purchasing and manager+ (createEdit)', async () => {
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await emailPOST(emailReq(), pdfCtx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('unauthorized -> whatever authorizeCommercialRequest returns, no domain calls made', async () => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(403)
    expect(getPurchaseOrderWithLinesMock).not.toHaveBeenCalled()
  })

  it('an unauthenticated (401) denial is returned as-is', async () => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(401)
  })
})

describe('Phase C6.5 — POST .../email — SMS accepted by the model, transport disabled', () => {
  it('rejects channel: "SMS" with a clear 400 — never silently sends EMAIL instead', async () => {
    const res = await emailPOST(emailReq({ channel: 'SMS' }), pdfCtx())
    expect(res.status).toBe(400)
    expect(sendPurchaseOrderEmailMock).not.toHaveBeenCalled()
  })
})

describe('Phase C6.5 — POST .../email — status gate: ISSUED only, CANCELLED explicitly rejected as a normal send', () => {
  it('DRAFT -> 409, never calls the provider', async () => {
    getPurchaseOrderWithLinesMock.mockResolvedValue({ purchaseOrder: { ...ISSUED_PO.purchaseOrder, status: 'DRAFT' }, lines: [] })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(409)
    expect(sendPurchaseOrderEmailMock).not.toHaveBeenCalled()
  })

  it('CANCELLED -> 409 with a distinct message — a cancelled PO must never be sent as an active order', async () => {
    getPurchaseOrderWithLinesMock.mockResolvedValue({ purchaseOrder: { ...ISSUED_PO.purchaseOrder, status: 'CANCELLED' }, lines: [] })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(409)
    expect(sendPurchaseOrderEmailMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.error).toMatch(/cancel/i)
  })

  it('ISSUED proceeds past the status gate', async () => {
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(200)
  })
})

describe('Phase C6.5 — POST .../email — recipient resolution: supplier_email_snapshot only', () => {
  it('refuses to send when the issued PO has no supplier_email_snapshot (never falls back to a live supplier lookup)', async () => {
    getPurchaseOrderWithLinesMock.mockResolvedValue({ purchaseOrder: { ...ISSUED_PO.purchaseOrder, supplier_email_snapshot: null }, lines: [] })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(409)
    expect(sendPurchaseOrderEmailMock).not.toHaveBeenCalled()
  })

  it('sends to exactly supplier_email_snapshot — no recipient override from the request body', async () => {
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await emailPOST(emailReq({ channel: 'EMAIL', to: 'attacker@evil.example' }), pdfCtx())
    expect(sendPurchaseOrderEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'supplier@example.com' }))
  })
})

describe('Phase C6.5 — POST .../email — duplicate-send cooldown (60s, matches quote/invoice)', () => {
  it('returns 429 with retry_after_seconds inside the cooldown window', async () => {
    secondsSinceLastAttemptMock.mockResolvedValue(10)
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.retry_after_seconds).toBe(50)
    expect(sendPurchaseOrderEmailMock).not.toHaveBeenCalled()
  })

  it('allows a send once the cooldown has elapsed', async () => {
    secondsSinceLastAttemptMock.mockResolvedValue(61)
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(200)
  })
})

describe('Phase C6.5 — POST .../email — outcome-to-response mapping and delivery/audit recording', () => {
  it('sent: 200, records exactly one SENT delivery row (purchase_order type, via the dedicated helper) and one "sent" audit entry', async () => {
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(200)
    expect(recordPurchaseOrderDeliveryAttemptMock).toHaveBeenCalledTimes(1)
    expect(recordPurchaseOrderDeliveryAttemptMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'SENT', channel: 'EMAIL', purchaseOrder: ISSUED_PO.purchaseOrder }))
    expect(logPurchaseOrderEmailSentMock).toHaveBeenCalledTimes(1)
    expect(logPurchaseOrderEmailSentMock).toHaveBeenCalledWith(expect.objectContaining({ result: 'sent', purchaseOrderId: 'po1' }))
  })

  it('DELIVERED is never written for any outcome this route can produce', async () => {
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await emailPOST(emailReq(), pdfCtx())
    for (const call of recordPurchaseOrderDeliveryAttemptMock.mock.calls) {
      expect((call[0] as { status: string }).status).not.toBe('DELIVERED')
    }
  })

  it('failed (definite provider rejection): 502, records a FAILED delivery row', async () => {
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'failed', error: 'rejected' })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(502)
    expect(recordPurchaseOrderDeliveryAttemptMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }))
  })

  it('unknown (ambiguous provider outcome): 504, still records FAILED, never claims success', async () => {
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'unknown', error: 'ambiguous' })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(504)
    expect(recordPurchaseOrderDeliveryAttemptMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }))
  })

  it('not_configured: 503, never reported as sent', async () => {
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'not_configured' })
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('critical case: provider sent but audit write fails — 500, distinct "sent_audit_failed"', async () => {
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    logPurchaseOrderEmailSentMock.mockRejectedValue(new Error('db down'))
    const res = await emailPOST(emailReq(), pdfCtx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.result).toBe('sent_audit_failed')
  })

  it('error responses never leak a raw provider/DB error string', async () => {
    sendPurchaseOrderEmailMock.mockResolvedValue({ result: 'failed', error: 'Connection refused, DATABASE_URL=postgresql://real:secret@host/db' })
    const res = await emailPOST(emailReq(), pdfCtx())
    const body = await res.json()
    expect(body.error).not.toContain('DATABASE_URL')
    expect(body.error).not.toContain('secret')
    expect(body.error).toBe('The email could not be sent. Please try again.')
  })
})

describe('Phase C6.5 — POST .../email — never mutates the purchase order: no lifecycle function is imported', () => {
  it('the route file imports none of submit/approve/return/issue/cancelPurchaseOrder (import lines only — prose in comments is fine)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/commercial/purchase-orders/[id]/email/route.ts'), 'utf-8')
    const importLines = source.split('\n').filter((l) => l.trim().startsWith('import '))
    for (const line of importLines) {
      expect(line, line).not.toMatch(/submitPurchaseOrder|approvePurchaseOrder|returnPurchaseOrderToDraft|issuePurchaseOrder|cancelPurchaseOrder/)
    }
  })
})

// ── UI action matrix (source-text containment — this repo's vitest
// config has no jsdom/component-render harness, matching
// tests/containment/commercialInvoiceUiContract.test.ts's own
// established idiom) ────────────────────────────────────────────────

describe('Phase C6.5 — PO detail page: Download PDF / Email / Cancel action visibility by status', () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../app/commercial/purchasing/purchase-orders/[id]/page.tsx"), 'utf-8')

  it('Download PDF is offered on ISSUED and CANCELLED only — the exact "(isIssued || isCancelled)" condition gates the link', () => {
    expect(source).toMatch(/\{\(isIssued \|\| isCancelled\) && \(\s*<a href=\{`\/api\/commercial\/purchase-orders\/\$\{id\}\/pdf`\}/)
  })

  it('Email Purchase Order requires isIssued, manager+ (canEdit), and a supplier email on file — never offered on CANCELLED or any pre-ISSUED status', () => {
    expect(source).toContain('{isIssued && canEdit && po.supplier_email_snapshot && !confirmingEmail && (')
  })

  it('Cancel Purchase Order remains gated on isIssued && isAdmin, unchanged from C6.4', () => {
    expect(source).toMatch(/\{isIssued && isAdmin && !confirmingCancel && \(/)
  })

  it('no Download PDF / Email action condition ever references isDraft, isPendingApproval, or isApproved as a positive gate', () => {
    const pdfBlockStart = source.indexOf('{(isIssued || isCancelled) && (')
    const emailBlockStart = source.indexOf('{isIssued && canEdit && po.supplier_email_snapshot')
    const pdfBlockEnd = source.indexOf('\n          )}', pdfBlockStart)
    const emailBlockEnd = source.indexOf('\n          )}', emailBlockStart)
    const pdfBlock = source.slice(pdfBlockStart, pdfBlockEnd)
    const emailBlock = source.slice(emailBlockStart, emailBlockEnd)
    for (const block of [pdfBlock, emailBlock]) {
      expect(block).not.toMatch(/isDraft \|\||&& isDraft/)
      expect(block).not.toMatch(/isPendingApproval \|\||&& isPendingApproval/)
      expect(block).not.toMatch(/isApproved \|\||&& isApproved/)
    }
  })
})
