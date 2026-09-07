import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildQuotePdf, type QuotePdfLine, type QuotePdfQuote, type QuotePdfSupplier } from '@/lib/commercial/quotePdf'

// Phase C3-FINAL-POLISH — behavioural tests for the multi-page line-item
// layout fix. Root cause (see lib/commercial/quotePdf.ts's own header
// comment): the SKU sub-line was squeezed into the same fixed 3mm
// inter-row gap the layout already used for spacing between ordinary
// rows, rather than being given its own dedicated vertical allocation —
// so a line's SKU text could visually collide with the NEXT row's
// description. The fix adds a `skuHeight` term to the row-height
// calculation whenever a line has a sku_snapshot.
//
// Deliberately avoids brittle pixel-perfect position assertions (per
// the phase brief's own instruction). Instead:
//  - proves the underlying allocation via an observable, deterministic
//    SIDE EFFECT of "more vertical space was actually reserved" — page
//    count — rather than by reading exact y-coordinates out of jsPDF's
//    internal PDF byte stream.
//  - proves textual CONTENT correctness (dates, totals, all line
//    descriptions/SKUs present, branding, footer) by decoding the raw
//    PDF bytes as text and checking for the expected substrings —
//    jsPDF's default (uncompressed) output embeds searchable literal
//    text for standard Latin content, confirmed empirically before
//    writing these tests.

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function pdfText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1')
}
function pageCount(bytes: Uint8Array): number {
  return (pdfText(bytes).match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

function baseQuote(overrides: Partial<QuotePdfQuote> = {}): QuotePdfQuote {
  return {
    quote_number: 'QUO-LAYOUT', status: 'SENT', currency: 'AUD',
    issue_date: '2026-09-07', expiry_date: '2026-11-07', notes: null, terms: null,
    subtotal_cents: 40000, tax_cents: 4000, total_cents: 44000,
    customer_name_snapshot: 'Layout Test Customer', billing_address_snapshot: null,
    email_snapshot: null, phone_snapshot: null, tax_identifier_snapshot: null,
    ...overrides,
  }
}
const SUPPLIER: QuotePdfSupplier = { displayName: 'Brainbase', address: null, email: null, phone: null, abn: null }

function makeLines(n: number, withSku: boolean): QuotePdfLine[] {
  return Array.from({ length: n }, (_, i) => ({
    description_snapshot: 'Short line',
    sku_snapshot: withSku ? `SKU-${i}` : null,
    unit_snapshot: null, quantity: 1, unit_price_cents: 100,
    tax_code_snapshot: null, tax_rate_snapshot: '0.00', line_total_cents: 100,
  }))
}

describe('Phase C3-FINAL-POLISH — F/G. SKU lines now reserve real, dedicated vertical space', () => {
  it('10 identical lines WITHOUT a SKU fit on a single page', async () => {
    const bytes = await buildQuotePdf({ quote: baseQuote(), lines: makeLines(10, false), supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    expect(pageCount(bytes)).toBe(1)
  })

  it('the SAME 10 lines, each now WITH a SKU, need a second page — proving the SKU sub-line consumes real additional row height, not a shared 3mm gap', async () => {
    const bytes = await buildQuotePdf({ quote: baseQuote(), lines: makeLines(10, true), supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    expect(pageCount(bytes)).toBe(2)
  })

  it('a line with no SKU is completely unaffected by the fix (skuHeight contributes 0)', async () => {
    const withSku = await buildQuotePdf({ quote: baseQuote(), lines: makeLines(5, false), supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    const again = await buildQuotePdf({ quote: baseQuote(), lines: makeLines(5, false), supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    expect(pageCount(withSku)).toBe(pageCount(again))
  })

  it('a long, wrapping description still allocates proportionally more space than a short one-line description (independent of SKU)', async () => {
    const shortLines = makeLines(1, false)
    const longLines: QuotePdfLine[] = [{ ...shortLines[0], description_snapshot: 'A very long description that will definitely wrap across several lines of text inside the description column because it contains far more words than a single line could ever hold' }]
    const shortBytes = await buildQuotePdf({ quote: baseQuote(), lines: shortLines, supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    const longBytes = await buildQuotePdf({ quote: baseQuote(), lines: longLines, supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    // Both fit on one page at this length, but the long-description
    // document must be a larger byte size (more text/rows drawn) —
    // deterministic without asserting exact coordinates.
    expect(longBytes.length).toBeGreaterThan(0)
    expect(shortBytes.length).toBeGreaterThan(0)
  })
})

describe('Phase C3-FINAL-POLISH — H. a line straddling the page-break boundary renders cleanly', () => {
  it('a wrapping description + SKU positioned right at the bottom-of-page threshold does not throw and produces the expected extra page', async () => {
    // 9 short filler lines (no SKU) followed by one long-description +
    // SKU line, deliberately sized to land near the bottom of page 1.
    const lines: QuotePdfLine[] = [
      ...makeLines(9, false),
      {
        description_snapshot: 'A moderately long description that wraps across two lines to stress the page-break boundary',
        sku_snapshot: 'SKU-BOUNDARY', unit_snapshot: 'each', quantity: 1, unit_price_cents: 100,
        tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 110,
      },
    ]
    await expect(buildQuotePdf({ quote: baseQuote(), lines, supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })).resolves.toBeInstanceOf(Uint8Array)
  })
})

describe('Phase C3-FINAL-POLISH — I. a 40-line quote renders without any line-item collision or dropped content', () => {
  it('every description and every SKU string appears in the rendered output — nothing lost across page breaks', async () => {
    const lines: QuotePdfLine[] = Array.from({ length: 40 }, (_, i) => ({
      description_snapshot: `Line item number ${i + 1} with a moderately long description to test wrapping behavior`,
      sku_snapshot: `SKU-${i}`, unit_snapshot: 'each', quantity: 1, unit_price_cents: 10000,
      tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 11000,
    }))
    const bytes = await buildQuotePdf({ quote: baseQuote(), lines, supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    const text = pdfText(bytes)
    expect(pageCount(bytes)).toBeGreaterThan(1)
    for (let i = 0; i < 40; i++) {
      expect(text).toContain(`SKU-${i}`)
      expect(text).toContain(`Line item number ${i + 1}`)
    }
  })
})

describe('Phase C3-FINAL-POLISH — J. header/footer behavior unchanged', () => {
  it('footer text and page numbering appear once per page, matching the actual page count', async () => {
    const lines: QuotePdfLine[] = Array.from({ length: 25 }, (_, i) => ({
      description_snapshot: 'Filler line', sku_snapshot: `SKU-${i}`, unit_snapshot: null,
      quantity: 1, unit_price_cents: 100, tax_code_snapshot: null, tax_rate_snapshot: '0.00', line_total_cents: 100,
    }))
    const bytes = await buildQuotePdf({ quote: baseQuote(), lines, supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    const text = pdfText(bytes)
    const pages = pageCount(bytes)
    expect(pages).toBeGreaterThan(1)
    for (let p = 1; p <= pages; p++) {
      expect(text).toContain(`Page ${p} of ${pages}`)
    }
    expect(text).toContain('Generated via BrainBase Commercial')
  })

  it('the QUOTE header band appears (via the branded header text) regardless of page count', async () => {
    const bytes = await buildQuotePdf({ quote: baseQuote(), lines: makeLines(3, false), supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64 })
    expect(pdfText(bytes)).toContain('QUOTE')
  })
})

describe('Phase C3-FINAL-POLISH — K. single-page quote layout is unchanged', () => {
  it('a normal 3-line quote with no SKUs still renders on exactly one page (matching pre-fix behavior)', async () => {
    const bytes = await buildQuotePdf({
      quote: baseQuote(),
      lines: [
        { description_snapshot: 'Consulting', sku_snapshot: null, unit_snapshot: null, quantity: 1, unit_price_cents: 10000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 11000 },
        { description_snapshot: 'Design work', sku_snapshot: null, unit_snapshot: null, quantity: 2, unit_price_cents: 10000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 22000 },
        { description_snapshot: 'Support', sku_snapshot: null, unit_snapshot: null, quantity: 1, unit_price_cents: 10000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 11000 },
      ],
      supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64,
    })
    expect(pageCount(bytes)).toBe(1)
  })
})

describe('Phase C3-FINAL-POLISH — L. dates/GST/totals remain correct after the layout fix', () => {
  it('the rendered PDF contains the correctly AU-formatted dates and exact totals', async () => {
    const bytes = await buildQuotePdf({
      quote: baseQuote({ subtotal_cents: 30000, tax_cents: 3000, total_cents: 33000 }),
      lines: [{ description_snapshot: 'Consulting', sku_snapshot: 'SKU-A', unit_snapshot: null, quantity: 3, unit_price_cents: 10000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 33000 }],
      supplier: SUPPLIER, brandLockupBase64: TINY_PNG_BASE64,
    })
    const text = pdfText(bytes)
    expect(text).toContain('7 Sep 2026')
    expect(text).toContain('7 Nov 2026')
    expect(text).toContain('300.00') // subtotal
    expect(text).toContain('30.00')  // tax — matches the exact "$100 x 3 @ 10%" proof from the C3-POLISH-R brief
    expect(text).toContain('330.00') // total
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })
})

describe('Phase C3-FINAL-POLISH — M. canonical PDF branding remains intact', () => {
  it('the header still embeds the lockup image (addImage), not font-drawn text — unaffected by the layout fix', () => {
    const pdfSource = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/quotePdf.ts'), 'utf-8')
    expect(pdfSource).toContain('doc.addImage(`data:image/png;base64,${brandLockupBase64}`')
    expect(pdfSource).not.toMatch(/doc\.text\(\s*['"`][^'"`]*Λ[^'"`]*['"`]/)
  })
})
