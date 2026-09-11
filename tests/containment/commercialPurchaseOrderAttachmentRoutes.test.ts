import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// C6.9 remediation 4 — attachment API route contract (auth floor,
// DRAFT-only mutation eligibility, tenant scoping), plus schema and UI
// containment.

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const getPurchaseOrderMock = vi.fn()
vi.mock('@/lib/commercial/purchaseOrders', () => ({ getPurchaseOrder: (...a: unknown[]) => getPurchaseOrderMock(...a) }))

const listAttachmentsMock = vi.fn()
const uploadAttachmentMock = vi.fn()
const getAttachmentMock = vi.fn()
const downloadAttachmentBytesMock = vi.fn()
const removeAttachmentMock = vi.fn()
vi.mock('@/lib/commercial/documentAttachments', () => ({
  listAttachmentsForPurchaseOrder: (...a: unknown[]) => listAttachmentsMock(...a),
  uploadPurchaseOrderAttachment: (...a: unknown[]) => uploadAttachmentMock(...a),
  getPurchaseOrderAttachment: (...a: unknown[]) => getAttachmentMock(...a),
  downloadPurchaseOrderAttachmentBytes: (...a: unknown[]) => downloadAttachmentBytesMock(...a),
  removePurchaseOrderAttachment: (...a: unknown[]) => removeAttachmentMock(...a),
  MAX_ATTACHMENT_BYTES: 20 * 1024 * 1024,
}))

const { GET: listGET, POST: uploadPOST } = await import('@/app/api/commercial/purchase-orders/[id]/attachments/route')
const { GET: downloadGET, DELETE: removeDELETE } = await import('@/app/api/commercial/purchase-orders/[id]/attachments/[attachmentId]/route')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager' }
const ALLOWED = { ok: true as const, session: SESSION }
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) }

function ctx(id = 'po-1', attachmentId = 'att-1') {
  return { params: Promise.resolve({ id, attachmentId }) }
}
function uploadReq(file: File | null, category = 'SUPPLIER_QUOTE') {
  const fd = new FormData()
  if (file) fd.append('file', file)
  fd.append('category', category)
  const req = new Request('http://localhost/x', { method: 'POST', body: fd })
  return req as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  authorizeMock.mockReset()
  getPurchaseOrderMock.mockReset()
  listAttachmentsMock.mockReset().mockResolvedValue([])
  uploadAttachmentMock.mockReset()
  getAttachmentMock.mockReset()
  downloadAttachmentBytesMock.mockReset()
  removeAttachmentMock.mockReset()
})

describe('GET attachments list — available in every PO status (retention requirement)', () => {
  it('authorizes at the view floor', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue({ id: 'po-1', organisation_id: 'org-a', status: 'ISSUED' })
    const res = await listGET({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(200)
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer')
  })

  it('404s for a wrong-tenant/missing PO before ever listing attachments', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue(null)
    const res = await listGET({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(404)
    expect(listAttachmentsMock).not.toHaveBeenCalled()
  })

  it('works for CANCELLED too (retention)', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue({ id: 'po-1', organisation_id: 'org-a', status: 'CANCELLED' })
    const res = await listGET({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(200)
  })
})

describe('POST upload — DRAFT only', () => {
  it('authorizes at the createEdit (manager+) floor', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue({ id: 'po-1', organisation_id: 'org-a', status: 'DRAFT' })
    uploadAttachmentMock.mockResolvedValue({ ok: true, attachment: { id: 'att-1' } })
    const file = new File(['x'], 'quote.pdf', { type: 'application/pdf' })
    await uploadPOST(uploadReq(file), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'manager')
  })

  it('succeeds while DRAFT', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue({ id: 'po-1', organisation_id: 'org-a', status: 'DRAFT' })
    uploadAttachmentMock.mockResolvedValue({ ok: true, attachment: { id: 'att-1' } })
    const file = new File(['x'], 'quote.pdf', { type: 'application/pdf' })
    const res = await uploadPOST(uploadReq(file), ctx())
    expect(res.status).toBe(201)
  })

  it.each(['PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'CANCELLED'])('rejects with 409 while %s', async (status) => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue({ id: 'po-1', organisation_id: 'org-a', status })
    const file = new File(['x'], 'quote.pdf', { type: 'application/pdf' })
    const res = await uploadPOST(uploadReq(file), ctx())
    expect(res.status).toBe(409)
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
  })

  it('rejects with 400 when no file is provided', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue({ id: 'po-1', organisation_id: 'org-a', status: 'DRAFT' })
    const res = await uploadPOST(uploadReq(null), ctx())
    expect(res.status).toBe(400)
  })

  it('404s for a wrong-tenant/missing PO before any file processing', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue(null)
    const file = new File(['x'], 'quote.pdf', { type: 'application/pdf' })
    const res = await uploadPOST(uploadReq(file), ctx())
    expect(res.status).toBe(404)
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
  })
})

describe('GET (download) — available in every status, never exposes a raw store URL', () => {
  it('streams bytes back through this route (no redirect, no URL field)', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue({ id: 'po-1', organisation_id: 'org-a', status: 'ISSUED' })
    getAttachmentMock.mockResolvedValue({ id: 'att-1', mime_type: 'application/pdf', original_filename: 'quote.pdf' })
    downloadAttachmentBytesMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const res = await downloadGET({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('quote.pdf')
  })

  it('404s for an attachment belonging to a different PO/organisation (tenant/parent scoping)', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue({ id: 'po-1', organisation_id: 'org-a', status: 'ISSUED' })
    getAttachmentMock.mockResolvedValue(null)
    const res = await downloadGET({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(404)
    expect(downloadAttachmentBytesMock).not.toHaveBeenCalled()
  })
})

describe('DELETE (remove) — DRAFT only', () => {
  it('succeeds while DRAFT', async () => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue({ id: 'po-1', organisation_id: 'org-a', status: 'DRAFT' })
    removeAttachmentMock.mockResolvedValue(true)
    const res = await removeDELETE({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(200)
  })

  it.each(['PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'CANCELLED'])('rejects with 409 while %s', async (status) => {
    authorizeMock.mockResolvedValue(ALLOWED)
    getPurchaseOrderMock.mockResolvedValue({ id: 'po-1', organisation_id: 'org-a', status })
    const res = await removeDELETE({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(409)
    expect(removeAttachmentMock).not.toHaveBeenCalled()
  })

  it('viewer is rejected before the domain function is ever called', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN)
    const res = await removeDELETE({} as unknown as import('next/server').NextRequest, ctx())
    expect(res.status).toBe(403)
    expect(removeAttachmentMock).not.toHaveBeenCalled()
  })
})

describe('schema — commercial_document_attachments (source containment)', () => {
  const SQL = fs.readFileSync(path.join(process.cwd(), 'scripts/create-commercial-document-attachments.sql'), 'utf8')

  it('document_type is polymorphic with no composite FK to a single parent table — matches commercial_document_deliveries\' established design', () => {
    expect(SQL).toContain("document_type     TEXT NOT NULL CHECK (document_type IN ('purchase_order'))")
    expect(SQL).not.toMatch(/FOREIGN KEY \(document_id/)
  })

  it('every mutating category is CHECK-constrained to the five required values', () => {
    expect(SQL).toContain("CHECK (category IN ('SUPPLIER_QUOTE', 'SPECIFICATION', 'SCOPE_OF_WORK', 'APPROVAL', 'OTHER'))")
  })

  it('organisation_id is a real FK to organisations (tenant anchor)', () => {
    expect(SQL).toContain('organisation_id   TEXT NOT NULL REFERENCES organisations(id)')
  })

  it('is idempotent (IF NOT EXISTS throughout)', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS commercial_document_attachments')
    expect(SQL).toContain('CREATE INDEX IF NOT EXISTS')
  })
})

describe('PO detail page — Supporting Documents UI (source containment)', () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), 'app/commercial/purchasing/purchase-orders/[id]/page.tsx'), 'utf8')

  it('renders a Supporting Documents section', () => {
    expect(SRC).toContain('Supporting Documents')
    expect(SRC).toContain('Attach Document')
  })

  it('upload form and Remove button are gated on isDraft && canEdit', () => {
    const start = SRC.indexOf('Supporting Documents')
    const end = SRC.indexOf('Delivery History')
    const region = SRC.slice(start, end)
    expect(region).toMatch(/isDraft && canEdit/)
  })

  it('the download link points at this app\'s own attachments route, never a raw external/Blob URL', () => {
    const start = SRC.indexOf('Supporting Documents')
    const end = SRC.indexOf('Delivery History')
    const region = SRC.slice(start, end)
    expect(region).toContain('/api/commercial/purchase-orders/${id}/attachments/${a.id}')
    expect(region).not.toMatch(/blob\.vercel-storage\.com/)
  })
})
