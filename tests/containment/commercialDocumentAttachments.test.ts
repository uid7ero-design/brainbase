import { describe, it, expect, vi, beforeEach } from 'vitest'

// C6.9 remediation 4 — PO Supporting Document attachments, domain-layer
// behaviour. Covers:
//  (1) the domain module's tenant-ownership assertion, upload/remove
//      validation, and store<->DB compensation behaviour
// (Storage-adapter-layer tests — the key builder and the composition
// root's fail-closed env resolution — live in the SEPARATE
// commercialAttachmentStorage.test.ts, deliberately: this file mocks
// '@/lib/commercial/attachmentStorage' wholesale, and vi.mock is
// hoisted/file-scoped, so a real, unmocked import of that same module's
// own pure functions cannot coexist with this file's mock.)

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args) }))

const storePutMock = vi.fn()
const storeGetMock = vi.fn()
const storeDeleteMock = vi.fn()
vi.mock('@/lib/commercial/attachmentStorage', () => ({
  createCommercialAttachmentStore: () => ({ put: storePutMock, get: storeGetMock, delete: storeDeleteMock, head: vi.fn(), provider: 'test' }),
  buildCommercialAttachmentKey: (org: string, type: string, doc: string, att: string) => `org_${org}/${type}_${doc}/${att}`,
}))

const logUploadedMock = vi.fn()
const logRemovedMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({
  logCommercialAttachmentUploaded: (...a: unknown[]) => logUploadedMock(...a),
  logCommercialAttachmentRemoved: (...a: unknown[]) => logRemovedMock(...a),
}))

beforeEach(() => {
  sqlMock.mockReset()
  storePutMock.mockReset().mockResolvedValue({ key: 'k', size: 10 })
  storeGetMock.mockReset()
  storeDeleteMock.mockReset().mockResolvedValue(undefined)
  logUploadedMock.mockReset()
  logRemovedMock.mockReset()
})

const PO = { id: 'po-1', organisation_id: 'org-a' }

describe('uploadPurchaseOrderAttachment — validation and tenant ownership', () => {
  it('rejects a cross-tenant parent PO before any store/DB call', async () => {
    const { uploadPurchaseOrderAttachment } = await import('@/lib/commercial/documentAttachments')
    await expect(uploadPurchaseOrderAttachment({
      organisationId: 'org-a', userId: 'u1', purchaseOrder: { id: 'po-1', organisation_id: 'org-B' },
      category: 'SUPPLIER_QUOTE', originalFilename: 'f.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]),
    })).rejects.toThrow(/Tenant mismatch/)
    expect(storePutMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid category', async () => {
    const { uploadPurchaseOrderAttachment } = await import('@/lib/commercial/documentAttachments')
    const result = await uploadPurchaseOrderAttachment({
      organisationId: 'org-a', userId: 'u1', purchaseOrder: PO,
      category: 'NOT_A_REAL_CATEGORY', originalFilename: 'f.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]),
    })
    expect(result.ok).toBe(false)
    expect(storePutMock).not.toHaveBeenCalled()
  })

  it('rejects a disallowed MIME type', async () => {
    const { uploadPurchaseOrderAttachment } = await import('@/lib/commercial/documentAttachments')
    const result = await uploadPurchaseOrderAttachment({
      organisationId: 'org-a', userId: 'u1', purchaseOrder: PO,
      category: 'SUPPLIER_QUOTE', originalFilename: 'f.exe', mimeType: 'application/x-msdownload', bytes: new Uint8Array([1]),
    })
    expect(result.ok).toBe(false)
    expect(storePutMock).not.toHaveBeenCalled()
  })

  it('rejects an empty file', async () => {
    const { uploadPurchaseOrderAttachment } = await import('@/lib/commercial/documentAttachments')
    const result = await uploadPurchaseOrderAttachment({
      organisationId: 'org-a', userId: 'u1', purchaseOrder: PO,
      category: 'SUPPLIER_QUOTE', originalFilename: 'f.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([]),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a file over the size limit', async () => {
    const { uploadPurchaseOrderAttachment, MAX_ATTACHMENT_BYTES } = await import('@/lib/commercial/documentAttachments')
    const result = await uploadPurchaseOrderAttachment({
      organisationId: 'org-a', userId: 'u1', purchaseOrder: PO,
      category: 'SUPPLIER_QUOTE', originalFilename: 'f.pdf', mimeType: 'application/pdf', bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1),
    })
    expect(result.ok).toBe(false)
    expect(storePutMock).not.toHaveBeenCalled()
  })

  it('on success: stores the object, inserts the DB row, and audits — in that order', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'att-1', organisation_id: 'org-a', document_type: 'purchase_order', document_id: 'po-1', category: 'SUPPLIER_QUOTE', original_filename: 'quote.pdf', mime_type: 'application/pdf', size_bytes: 3, storage_key: 'org_org-a/purchase_order_po-1/att-1', uploaded_by: 'u1', created_at: 'now' }])
    const { uploadPurchaseOrderAttachment } = await import('@/lib/commercial/documentAttachments')
    const result = await uploadPurchaseOrderAttachment({
      organisationId: 'org-a', userId: 'u1', purchaseOrder: PO,
      category: 'SUPPLIER_QUOTE', originalFilename: 'quote.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]),
    })
    expect(result.ok).toBe(true)
    expect(storePutMock).toHaveBeenCalledTimes(1)
    expect(logUploadedMock).toHaveBeenCalledTimes(1)
  })

  it('compensates (deletes the just-uploaded object) if the DB insert fails after a successful store write', async () => {
    sqlMock.mockRejectedValueOnce(new Error('db down'))
    const { uploadPurchaseOrderAttachment } = await import('@/lib/commercial/documentAttachments')
    const result = await uploadPurchaseOrderAttachment({
      organisationId: 'org-a', userId: 'u1', purchaseOrder: PO,
      category: 'SUPPLIER_QUOTE', originalFilename: 'quote.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]),
    })
    expect(result.ok).toBe(false)
    expect(storePutMock).toHaveBeenCalledTimes(1)
    expect(storeDeleteMock).toHaveBeenCalledTimes(1)
    expect(logUploadedMock).not.toHaveBeenCalled()
  })
})

describe('removePurchaseOrderAttachment', () => {
  it('rejects a cross-tenant parent PO before any DB/store call', async () => {
    const { removePurchaseOrderAttachment } = await import('@/lib/commercial/documentAttachments')
    await expect(removePurchaseOrderAttachment({
      organisationId: 'org-a', userId: 'u1', purchaseOrder: { id: 'po-1', organisation_id: 'org-B' }, attachmentId: 'att-1',
    })).rejects.toThrow(/Tenant mismatch/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('deletes the DB row first, audits, then best-effort deletes the store object', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'att-1', category: 'SUPPLIER_QUOTE', original_filename: 'quote.pdf', storage_key: 'k' }])
    const { removePurchaseOrderAttachment } = await import('@/lib/commercial/documentAttachments')
    const ok = await removePurchaseOrderAttachment({ organisationId: 'org-a', userId: 'u1', purchaseOrder: PO, attachmentId: 'att-1' })
    expect(ok).toBe(true)
    expect(logRemovedMock).toHaveBeenCalledTimes(1)
    expect(storeDeleteMock).toHaveBeenCalledWith('k')
  })

  it('returns false (no audit, no store call) when the row does not exist / wrong tenant / wrong PO', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { removePurchaseOrderAttachment } = await import('@/lib/commercial/documentAttachments')
    const ok = await removePurchaseOrderAttachment({ organisationId: 'org-a', userId: 'u1', purchaseOrder: PO, attachmentId: 'att-1' })
    expect(ok).toBe(false)
    expect(logRemovedMock).not.toHaveBeenCalled()
    expect(storeDeleteMock).not.toHaveBeenCalled()
  })

  it('a store-delete failure does not fail the operation — the DB row is already gone and already audited', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'att-1', category: 'SUPPLIER_QUOTE', original_filename: 'quote.pdf', storage_key: 'k' }])
    storeDeleteMock.mockRejectedValueOnce(new Error('provider hiccup'))
    const { removePurchaseOrderAttachment } = await import('@/lib/commercial/documentAttachments')
    const ok = await removePurchaseOrderAttachment({ organisationId: 'org-a', userId: 'u1', purchaseOrder: PO, attachmentId: 'att-1' })
    expect(ok).toBe(true)
  })
})
