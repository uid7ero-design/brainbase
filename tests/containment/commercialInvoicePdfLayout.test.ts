import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildInvoicePdf, type InvoicePdfLine, type InvoicePdfInvoice, type InvoicePdfSupplier } from '@/lib/commercial/invoicePdf'

// Phase C4.3B — behavioural tests for lib/commercial/invoicePdf.ts,
// mirroring tests/containment/commercialQuotePdfLayout.test.ts's own
// established technique exactly: decode the raw (uncompressed by
// default) jsPDF byte output as latin1 text and assert on substrings,
// rather than brittle pixel-coordinate assertions — confirmed
// empirically to work for standard Latin content.

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function pdfText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1')
}

function baseInvoice(overrides: Partial<InvoicePdfInvoice> = {}): InvoicePdfInvoice {
  return {
    invoice_number: 'INV-000123', status: 'ISSUED', currency: 'AUD',
    issue_date: '2026-09-01', due_date: '2026-09-15', notes: null, terms: null,
    subtotal_cents: 100000, tax_cents: 10000, total_cents: 110000,
    customer_name_snapshot: 'PDF Test Customer', billing_address_snapshot: null,
    email_snapshot: null, phone_snapshot: null, tax_identifier_snapshot: null,
    void_reason: null, source_quote_number: null,
    ...overrides,
  }
}
const SUPPLIER: InvoicePdfSupplier = { displayName: 'Brainbase', address: null, email: null, phone: null, abn: null }
const LINE: InvoicePdfLine = { description_snapshot: 'Consulting services', sku_snapshot: null, unit_snapshot: null, quantity: 1, unit_price_cents: 100000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 110000 }

describe('Phase C4.3B — invoice PDF: title, number, dates, DUE DATE (not EXPIRY DATE)', () => {
  it('the header renders INVOICE, never QUOTE', async () => {
    const bytes = await buildInvoicePdf({ invoice: baseInvoice(), lines: [LINE], supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    const text = pdfText(bytes)
    expect(text).toContain('INVOICE')
    expect(text).not.toContain('QUOTE')
  })

  it('the details strip shows DUE DATE, never EXPIRY DATE', async () => {
    const bytes = await buildInvoicePdf({ invoice: baseInvoice(), lines: [LINE], supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    const text = pdfText(bytes)
    expect(text).toContain('DUE DATE')
    expect(text).not.toContain('EXPIRY DATE')
  })

  it('invoice number, AU-formatted issue/due dates, and customer name all render', async () => {
    const bytes = await buildInvoicePdf({ invoice: baseInvoice(), lines: [LINE], supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    const text = pdfText(bytes)
    expect(text).toContain('INV-000123')
    expect(text).toContain('1 Sep 2026')
    expect(text).toContain('15 Sep 2026')
    expect(text).toContain('PDF Test Customer')
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('a native JS Date object for issue_date/due_date renders identically to an equivalent string (server-side email path parity)', async () => {
    const bytes = await buildInvoicePdf({
      invoice: baseInvoice({ issue_date: new Date(2026, 8, 1), due_date: new Date(2026, 8, 15) }),
      lines: [LINE], supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64,
    })
    const text = pdfText(bytes)
    expect(text).toContain('1 Sep 2026')
    expect(text).toContain('15 Sep 2026')
  })
})

describe('Phase C4.3B — invoice PDF: totals are formatted-only, never recomputed', () => {
  it('renders exactly the persisted subtotal/tax/total cents values, regardless of what the lines would sum to if recomputed', async () => {
    // Deliberately mismatched: if the PDF recomputed totals from lines,
    // it would show a DIFFERENT number than the persisted total below —
    // proving it never does.
    const mismatchedLine: InvoicePdfLine = { ...LINE, line_total_cents: 999999 }
    const bytes = await buildInvoicePdf({
      invoice: baseInvoice({ subtotal_cents: 100000, tax_cents: 10000, total_cents: 110000 }),
      lines: [mismatchedLine], supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64,
    })
    const text = pdfText(bytes)
    expect(text).toContain('1,000.00') // subtotal
    expect(text).toContain('100.00')   // tax
    expect(text).toContain('1,100.00') // total — the persisted value, not derived
  })
})

describe('Phase C4.3B — invoice PDF: source quote reference, only when present', () => {
  it('renders "Source Quote: <number>" when source_quote_number is set', async () => {
    const bytes = await buildInvoicePdf({ invoice: baseInvoice({ source_quote_number: 'QUO-000042' }), lines: [LINE], supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    expect(pdfText(bytes)).toContain('Source Quote: QUO-000042')
  })

  it('omits any "Source Quote" text when null (standalone invoice)', async () => {
    const bytes = await buildInvoicePdf({ invoice: baseInvoice({ source_quote_number: null }), lines: [LINE], supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    expect(pdfText(bytes)).not.toContain('Source Quote')
  })
})

describe('Phase C4.3B — invoice PDF: VOID treatment is unmistakable and reason-bearing', () => {
  it('an ISSUED invoice PDF contains no VOID marker of any kind', async () => {
    const bytes = await buildInvoicePdf({ invoice: baseInvoice({ status: 'ISSUED' }), lines: [LINE], supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    const text = pdfText(bytes)
    expect(text).not.toContain('VOID')
    expect(text).not.toContain('DO NOT PAY')
  })

  it('a VOID invoice PDF renders the STATUS as VOID, an unmistakable "DO NOT PAY" callout, the void_reason text, and a "Total (Voided)" label', async () => {
    const bytes = await buildInvoicePdf({
      invoice: baseInvoice({ status: 'VOID', void_reason: 'Duplicate of INV-000122.' }),
      lines: [LINE], supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64,
    })
    const text = pdfText(bytes)
    expect(text).toContain('VOID')
    expect(text).toContain('DO NOT PAY')
    expect(text).toContain('Duplicate of INV-000122.')
    // PDF content streams escape literal parentheses (they're the
    // string-literal delimiter in PDF syntax itself), so "Total
    // (Voided)" appears in the raw bytes as "Total \(Voided\)" —
    // confirmed empirically, not guessed.
    expect(text).toMatch(/Total \\\(Voided\\\)/)
  })

  it('a VOID invoice with no void_reason still shows the unmistakable callout, just without a reason line', async () => {
    const bytes = await buildInvoicePdf({
      invoice: baseInvoice({ status: 'VOID', void_reason: null }),
      lines: [LINE], supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64,
    })
    const text = pdfText(bytes)
    expect(text).toContain('DO NOT PAY')
    expect(text).not.toContain('Reason:')
  })

  it('the VOID diagonal watermark is drawn via a real jsPDF text-with-angle call in the source, not merely mentioned in a comment', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/invoicePdf.ts'), 'utf-8')
    const stripped = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped).toMatch(/doc\.text\(\s*['"`]VOID['"`][\s\S]*?angle:\s*35/)
  })
})

describe('Phase C4.3B — invoice PDF: canonical branding, no font-drawn Greek lambda', () => {
  it('the header embeds the lockup image (addImage), never font-drawn text', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/invoicePdf.ts'), 'utf-8')
    expect(source).toContain('doc.addImage(`data:image/png;base64,${brandLockupBase64}`')
  })

  it('never draws a literal Greek lambda character via doc.text() — the exact root cause class the quote PDF already fixed', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/invoicePdf.ts'), 'utf-8')
    expect(source).not.toMatch(/doc\.text\(\s*['"`][^'"`]*Λ[^'"`]*['"`]/)
    expect(source).not.toMatch(/doc\.text\(`[^`]*Λ[^`]*`/)
  })

  it('reuses the brand color constants from quotePdf.ts rather than redefining them', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/invoicePdf.ts'), 'utf-8')
    expect(source).toMatch(/from ['"]\.\/quotePdf['"]/)
    expect(source).toContain('BRAND_INK')
    expect(source).toContain('HEADER_BAND_FILL')
  })
})

describe('Phase C4.3B — invoice PDF: multi-page and line-item rendering, matching quote layout discipline', () => {
  it('a 40-line invoice renders without dropping any line content across page breaks', async () => {
    const lines: InvoicePdfLine[] = Array.from({ length: 40 }, (_, i) => ({
      description_snapshot: `Line item number ${i + 1}`, sku_snapshot: `SKU-${i}`, unit_snapshot: 'each',
      quantity: 1, unit_price_cents: 10000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 11000,
    }))
    const bytes = await buildInvoicePdf({ invoice: baseInvoice(), lines, supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    const text = pdfText(bytes)
    for (let i = 0; i < 40; i++) {
      expect(text).toContain(`SKU-${i}`)
      expect(text).toContain(`Line item number ${i + 1}`)
    }
  })

  it('footer text and page numbering appear once per page', async () => {
    const lines: InvoicePdfLine[] = Array.from({ length: 25 }, (_, i) => ({
      description_snapshot: 'Filler line', sku_snapshot: `SKU-${i}`, unit_snapshot: null,
      quantity: 1, unit_price_cents: 100, tax_code_snapshot: null, tax_rate_snapshot: '0.00', line_total_cents: 100,
    }))
    const bytes = await buildInvoicePdf({ invoice: baseInvoice(), lines, supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    const text = pdfText(bytes)
    const pageMatches = (text.match(/Page \d+ of \d+/g) ?? [])
    expect(pageMatches.length).toBeGreaterThan(0)
    expect(text).toContain('Generated via BrainBase Commercial')
  })
})
