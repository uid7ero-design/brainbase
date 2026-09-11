import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// C6.9 remediation 4 — lib/commercial/attachmentStorage.ts, the
// composition root for the dedicated, PRIVATE Commercial attachment
// Blob store. Deliberately a SEPARATE file from
// commercialDocumentAttachments.test.ts (which mocks this whole module)
// so these tests can exercise the module's real, unmocked functions.

describe('buildCommercialAttachmentKey (pure)', () => {
  it('composes org_<org>/<type>_<doc>/<attachment> with no client-controlled fragment (never the filename)', async () => {
    // Generous timeout, not a slow-logic concern: this is the first test
    // in the process to import @vercel/blob's full module graph (via
    // attachmentStorage -> vercelBlobFileStore), and that cold
    // transform/import cost alone can exceed vitest's 5s default —
    // every subsequent test in this file re-uses the now-warm cache and
    // stays fast (see this file's other tests, all well under 1s).
    const { buildCommercialAttachmentKey } = await import('@/lib/commercial/attachmentStorage')
    const key = buildCommercialAttachmentKey('org-a', 'purchase_order', 'po-1', 'att-1')
    expect(key).toBe('org_org-a/purchase_order_po-1/att-1')
  }, 20000)

  it('rejects a component containing "/" (component-injection guard, mirrors buildImportBatchKey)', async () => {
    const { buildCommercialAttachmentKey } = await import('@/lib/commercial/attachmentStorage')
    expect(() => buildCommercialAttachmentKey('org-a/evil', 'purchase_order', 'po-1', 'att-1')).toThrow(TypeError)
  })

  it('rejects an empty component', async () => {
    const { buildCommercialAttachmentKey } = await import('@/lib/commercial/attachmentStorage')
    expect(() => buildCommercialAttachmentKey('', 'purchase_order', 'po-1', 'att-1')).toThrow(TypeError)
  })
})

describe("createCommercialAttachmentStore — fails closed (never falls back to another store's env vars)", () => {
  const ORIGINAL_ENV = { ...process.env }
  afterEach(() => { process.env = { ...ORIGINAL_ENV } })

  it('throws CommercialAttachmentConfigurationError when COMMERCIAL_BLOB_STORE_ID is missing', async () => {
    vi.resetModules()
    delete process.env.COMMERCIAL_BLOB_STORE_ID
    delete process.env.COMMERCIAL_BLOB_READ_WRITE_TOKEN
    const { createCommercialAttachmentStore, CommercialAttachmentConfigurationError } = await import('@/lib/commercial/attachmentStorage')
    expect(() => createCommercialAttachmentStore()).toThrow(CommercialAttachmentConfigurationError)
  })

  it('never reads DATAHUB_ or BLOB_ (Events) env vars as a fallback', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/commercial/attachmentStorage.ts'), 'utf8')
    expect(src).not.toContain('DATAHUB_BLOB')
    expect(src).not.toMatch(/process\.env\.BLOB_/)
    expect(src).toContain('COMMERCIAL_BLOB_STORE_ID')
    expect(src).toContain('COMMERCIAL_BLOB_READ_WRITE_TOKEN')
  })

  it('an explicit override bypasses env resolution entirely (the sanctioned test seam)', async () => {
    vi.resetModules()
    delete process.env.COMMERCIAL_BLOB_STORE_ID
    delete process.env.COMMERCIAL_BLOB_READ_WRITE_TOKEN
    const { createCommercialAttachmentStore } = await import('@/lib/commercial/attachmentStorage')
    // vercel_blob_rw_<storeid>_<secret> shape, matching the adapter's own
    // verifyTokenStoreIdConsistency() expectations.
    expect(() => createCommercialAttachmentStore({ storeId: 'teststore', token: 'vercel_blob_rw_teststore_abc123' })).not.toThrow()
  })
})
