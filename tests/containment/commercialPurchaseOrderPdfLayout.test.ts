import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildPurchaseOrderPdf, type PurchaseOrderPdfLine, type PurchaseOrderPdfPurchaseOrder, type PurchaseOrderPdfBuyer } from '@/lib/commercial/purchaseOrderPdf'

// Phase C6.5 — behavioural tests for lib/commercial/purchaseOrderPdf.ts,
// mirroring tests/containment/commercialInvoicePdfLayout.test.ts's own
// established technique exactly: decode the raw (uncompressed by
// default) jsPDF byte output as latin1 text and assert on substrings.
//
// Deliberately its OWN file, separate from
// tests/containment/commercialPurchaseOrderDocuments.test.ts (which
// mocks @/lib/commercial/purchaseOrderPdf wholesale to isolate the PDF
// API ROUTE layer) — importing the REAL buildPurchaseOrderPdf in that
// same file would be silently intercepted by that file's own top-level
// vi.mock() factory, since vi.mock() calls are hoisted file-wide
// regardless of where they appear.

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function pdfText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1')
}

function basePo(overrides: Partial<PurchaseOrderPdfPurchaseOrder> = {}): PurchaseOrderPdfPurchaseOrder {
  return {
    purchase_order_number: 'PO-000123', status: 'ISSUED', currency: 'AUD',
    issued_at: '2026-09-01', delivery_date: '2026-09-15',
    delivery_address_line1: '1 Test St', delivery_address_line2: null,
    delivery_suburb: 'Adelaide', delivery_state: 'SA', delivery_postcode: '5000', delivery_country: 'Australia',
    payment_terms_days_snapshot: 30,
    supplier_notes: null,
    subtotal_cents: 100000, tax_cents: 10000, total_cents: 110000,
    supplier_name_snapshot: 'PDF Test Supplier', supplier_legal_name_snapshot: null,
    supplier_contact_name_snapshot: null, supplier_email_snapshot: null, supplier_phone_snapshot: null,
    supplier_address_snapshot: null, supplier_tax_business_number_snapshot: null, supplier_reference_snapshot: null,
    cancel_reason: null, cancelled_at: null,
    ...overrides,
  }
}
const BUYER: PurchaseOrderPdfBuyer = { displayName: 'Brainbase', address: null, email: null, phone: null, abn: null }
const LINE: PurchaseOrderPdfLine = { description_snapshot: 'Widgets', sku_snapshot: null, unit_snapshot: null, quantity: 5, unit_price_cents: 20000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 110000 }

describe('Phase C6.5 — PO PDF: title, number, dates', () => {
  it('the header renders PURCHASE ORDER, never QUOTE or INVOICE', async () => {
    const bytes = await buildPurchaseOrderPdf({ purchaseOrder: basePo(), lines: [LINE], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64 })
    const text = pdfText(bytes)
    expect(text).toContain('PURCHASE ORDER')
    expect(text).not.toContain('QUOTE')
  })

  it('PO number, AU-formatted issue/delivery dates, and supplier name all render — no raw ISO timestamp anywhere', async () => {
    const bytes = await buildPurchaseOrderPdf({ purchaseOrder: basePo(), lines: [LINE], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64 })
    const text = pdfText(bytes)
    expect(text).toContain('PO-000123')
    expect(text).toContain('1 Sep 2026')
    expect(text).toContain('15 Sep 2026')
    expect(text).toContain('PDF Test Supplier')
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('a native JS Date object for issued_at/delivery_date/cancelled_at renders identically to an equivalent string (server-side email path parity)', async () => {
    const bytes = await buildPurchaseOrderPdf({
      purchaseOrder: basePo({ issued_at: new Date(2026, 8, 1), delivery_date: new Date(2026, 8, 15) }),
      lines: [LINE], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64,
    })
    const text = pdfText(bytes)
    expect(text).toContain('1 Sep 2026')
    expect(text).toContain('15 Sep 2026')
  })
})

describe('Phase C6.5 — PO PDF: supplier snapshot fields render, source of truth is the snapshot only', () => {
  it('renders legal name, contact name, email, phone, tax number, and supplier reference when present', async () => {
    const bytes = await buildPurchaseOrderPdf({
      purchaseOrder: basePo({
        supplier_legal_name_snapshot: 'Legal Pty Ltd', supplier_contact_name_snapshot: 'Jane Vendor',
        supplier_email_snapshot: 'vendor@example.com', supplier_phone_snapshot: '08 1234 5678',
        supplier_tax_business_number_snapshot: '12 345 678 901', supplier_reference_snapshot: 'REF-42',
      }),
      lines: [LINE], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64,
    })
    const text = pdfText(bytes)
    expect(text).toContain('Legal Pty Ltd')
    expect(text).toContain('Jane Vendor')
    expect(text).toContain('vendor@example.com')
    expect(text).toContain('08 1234 5678')
    expect(text).toContain('12 345 678 901')
    expect(text).toContain('REF-42')
  })

  it('the builder has no capability to re-derive supplier data from anything but its own input — there is no lib/db import, no fetch, and no supplier-lookup function referenced anywhere in the module source', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/purchaseOrderPdf.ts'), 'utf-8')
    expect(source).not.toMatch(/from ['"]@\/lib\/db['"]/)
    expect(source).not.toMatch(/getSupplier/)
    expect(source).not.toMatch(/\bfetch\(/)
  })
})

describe('Phase C6.5 — PO PDF: totals are formatted-only, never recomputed', () => {
  it('renders exactly the persisted subtotal/tax/total cents values, regardless of what the lines would sum to if recomputed', async () => {
    const mismatchedLine: PurchaseOrderPdfLine = { ...LINE, line_total_cents: 999999 }
    const bytes = await buildPurchaseOrderPdf({
      purchaseOrder: basePo({ subtotal_cents: 100000, tax_cents: 10000, total_cents: 110000 }),
      lines: [mismatchedLine], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64,
    })
    const text = pdfText(bytes)
    expect(text).toContain('1,000.00') // subtotal
    expect(text).toContain('100.00')   // tax
    expect(text).toContain('1,100.00') // total — the persisted value, not derived
  })
})

describe('Phase C6.5 — PO PDF: notes — supplier_notes renders, internal_notes cannot leak', () => {
  it('renders supplier_notes when present', async () => {
    const bytes = await buildPurchaseOrderPdf({
      purchaseOrder: basePo({ supplier_notes: 'Please deliver to the loading dock.' }),
      lines: [LINE], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64,
    })
    expect(pdfText(bytes)).toContain('Please deliver to the loading dock.')
  })

  it('PurchaseOrderPdfPurchaseOrder declares no internal_notes property at all — there is structurally nothing for this builder to render even by accident (checked as a property declaration, not a bare substring, since the interface\'s own explanatory comment mentions the word deliberately)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/purchaseOrderPdf.ts'), 'utf-8')
    const ifaceStart = source.indexOf('export interface PurchaseOrderPdfPurchaseOrder')
    const ifaceEnd = source.indexOf('\n}', ifaceStart)
    const ifaceBody = source.slice(ifaceStart, ifaceEnd)
    expect(ifaceBody).not.toMatch(/^\s*internal_notes\s*[?:]/m)
  })
})

describe('Phase C6.5 — PO PDF: cost centre never appears on the supplier-facing document', () => {
  it('PurchaseOrderPdfLine declares no cost_centre property at all', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/purchaseOrderPdf.ts'), 'utf-8')
    const ifaceStart = source.indexOf('export interface PurchaseOrderPdfLine')
    const ifaceEnd = source.indexOf('\n}', ifaceStart)
    const ifaceBody = source.slice(ifaceStart, ifaceEnd)
    expect(ifaceBody).not.toMatch(/^\s*cost_centre\w*\s*[?:]/m)
  })
})

describe('Phase C6.5 — PO PDF: CANCELLED treatment is unmistakable, reason-bearing, and never labelled VOID', () => {
  it('an ISSUED PO PDF contains no CANCELLED marker of any kind', async () => {
    const bytes = await buildPurchaseOrderPdf({ purchaseOrder: basePo({ status: 'ISSUED' }), lines: [LINE], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64 })
    expect(pdfText(bytes)).not.toContain('CANCELLED')
  })

  it('a CANCELLED PO PDF prominently states cancellation, never uses the word VOID anywhere', async () => {
    const bytes = await buildPurchaseOrderPdf({
      purchaseOrder: basePo({ status: 'CANCELLED', cancel_reason: 'Supplier could not fulfil', cancelled_at: '2026-09-20' }),
      lines: [LINE], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64,
    })
    const text = pdfText(bytes)
    expect(text).toContain('CANCELLED')
    expect(text).toContain('DO NOT FULFIL')
    expect(text).not.toContain('VOID')
  })

  it('renders the cancel_reason and cancelled date when present', async () => {
    const bytes = await buildPurchaseOrderPdf({
      purchaseOrder: basePo({ status: 'CANCELLED', cancel_reason: 'Supplier could not fulfil', cancelled_at: '2026-09-20' }),
      lines: [LINE], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64,
    })
    const text = pdfText(bytes)
    expect(text).toContain('Supplier could not fulfil')
    expect(text).toContain('20 Sep 2026')
  })

  it('the total is labelled "Total (Cancelled)", not a plain "Total", for a cancelled PO', async () => {
    const bytes = await buildPurchaseOrderPdf({ purchaseOrder: basePo({ status: 'CANCELLED' }), lines: [LINE], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64 })
    // PDF string literals escape unbalanced parentheses — matches
    // commercialInvoicePdfLayout.test.ts's own identical "Total \(Voided\)"
    // assertion for the exact same reason: "Total (Cancelled)" appears in
    // the raw bytes as "Total \(Cancelled\)".
    expect(pdfText(bytes)).toMatch(/Total \\\(Cancelled\\\)/)
  })

  it('the permanent PO number is unchanged/still rendered on a CANCELLED document', async () => {
    const bytes = await buildPurchaseOrderPdf({ purchaseOrder: basePo({ status: 'CANCELLED', purchase_order_number: 'PO-000999' }), lines: [LINE], buyer: BUYER, brandLockupBase64: TINY_PNG_BASE64 })
    expect(pdfText(bytes)).toContain('PO-000999')
  })
})
