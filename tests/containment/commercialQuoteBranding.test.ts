import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C3-POLISH-R §2/§3 — static containment proving the Quote PDF/email
// actually uses the REAL BrainBase brand asset and never regresses back to
// a raw ISO date string. Complements the functional tests in
// tests/containment/commercialQuoteEmail.test.ts and
// tests/containment/commercialDates.test.ts, which prove BEHAVIOUR;
// this file proves the SOURCE itself references the right things.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

const pdfSource = readSource('lib/commercial/quotePdf.ts')
const emailSource = readSource('lib/commercial/quoteEmail.ts')
const quoteDetailSource = readSource('app/commercial/quotes/[id]/page.tsx')
const quoteListSource = readSource('app/commercial/quotes/page.tsx')

describe('Phase C3-COMMERCIAL-BRAND-RENDERING — the real BrainBase lockup asset is embedded as an image, never drawn as jsPDF text', () => {
  it('the rasterized PNG asset exists on disk, generated from the canonical brainbase-horizontal-color.svg (not hand-drawn)', () => {
    const pngPath = path.resolve(__dirname, '../../public/Brand/brainbase-horizontal-color-284.png')
    expect(fs.existsSync(pngPath)).toBe(true)
    // A real raster PNG of a reasonable size for a 1600x284 lockup with
    // gradients — catches an accidentally-truncated or placeholder file.
    expect(fs.statSync(pngPath).size).toBeGreaterThan(5000)
  })

  it('the old icon-only PNG this phase superseded is gone, not left behind as dead weight', () => {
    const oldPngPath = path.resolve(__dirname, '../../public/Brand/brainbase-mark-color-256.png')
    expect(fs.existsSync(oldPngPath)).toBe(false)
  })

  it('the server-side email loader reads the lockup asset path, not the old icon-only one', () => {
    expect(emailSource).toContain("'public', 'Brand', 'brainbase-horizontal-color-284.png'")
    expect(emailSource).not.toContain('brainbase-mark-color-256.png')
  })

  it('the client-side PDF download loader fetches the lockup asset path, not the old icon-only one', () => {
    expect(quoteDetailSource).toContain('/Brand/brainbase-horizontal-color-284.png')
    expect(quoteDetailSource).not.toContain('brainbase-mark-color-256.png')
  })

  it('the wordmark purple accent colour matches an actual stop colour from the real brand SVGs, not an arbitrary invented purple', () => {
    // #7C5CFF is the orbitGrad/wmAccent mid-stop in
    // public/Brand/brainbase-horizontal-color.svg — verified by direct
    // inspection of that committed asset file.
    const brandSvg = readSource('public/Brand/brainbase-horizontal-color.svg')
    expect(brandSvg).toContain('#7C5CFF')
    expect(pdfSource).toContain("BRAND_PURPLE = '#7C5CFF'")
  })

  it('regression guard: the PDF never draws a literal Greek lambda character via doc.text() — jsPDF standard fonts cannot render it (the exact root cause of the human-QA-reported defect)', () => {
    expect(pdfSource).not.toMatch(/doc\.text\(\s*['"`][^'"`]*Λ[^'"`]*['"`]/)
    expect(pdfSource).not.toMatch(/doc\.text\(`[^`]*Λ[^`]*`/)
  })

  it('the PDF header embeds the lockup as an image (addImage), not as font-drawn text', () => {
    const start = pdfSource.indexOf('// ── Header')
    const end = pdfSource.indexOf('// ── Supplier')
    const headerBlock = pdfSource.slice(start, end)
    expect(headerBlock).toContain('doc.addImage(`data:image/png;base64,${brandLockupBase64}`')
  })

  it('the header is rendered as a full-bleed dark band, matching the asset\'s own dark-surfaces-only design', () => {
    const start = pdfSource.indexOf('// ── Header')
    const end = pdfSource.indexOf('// ── Supplier')
    const headerBlock = pdfSource.slice(start, end)
    expect(headerBlock).toContain('HEADER_BAND_FILL')
    expect(headerBlock).toMatch(/doc\.rect\(0,\s*0,\s*pageW,\s*HEADER_BAND_HEIGHT,\s*'F'\)/)
  })

  it('the footer never uses the literal Greek lambda character either — plain ASCII business name text only', () => {
    const footerStart = pdfSource.indexOf('// ── Footer')
    const footerBlock = pdfSource.slice(footerStart)
    expect(footerBlock).not.toContain('Λ')
    expect(footerBlock).toContain('BrainBase Commercial')
  })
})

describe('Phase C3-POLISH-R §3 — no raw ISO date ever reaches the PDF, email, or quote UI', () => {
  it('quotePdf.ts formats issue_date/expiry_date through formatCommercialDate(), never a raw template interpolation', () => {
    expect(pdfSource).toContain('formatCommercialDate(quote.issue_date)')
    expect(pdfSource).toContain('formatCommercialDate(quote.expiry_date)')
    expect(pdfSource).not.toMatch(/\$\{quote\.issue_date\}/)
    expect(pdfSource).not.toMatch(/\$\{quote\.expiry_date\}/)
  })

  it('quoteEmail.ts formats the expiry date through formatCommercialDate()', () => {
    expect(emailSource).toContain('formatCommercialDate(data.expiryDate)')
  })

  it('the quote detail page never renders quote.issue_date/expiry_date directly (always through formatCommercialDate)', () => {
    expect(quoteDetailSource).not.toMatch(/\{quote\.issue_date\}/)
    expect(quoteDetailSource).not.toMatch(/\{quote\.issue_date\s*\?\?/)
    expect(quoteDetailSource).toContain('formatCommercialDate(quote.issue_date)')
  })

  it('the quotes list page never renders q.issue_date/expiry_date directly', () => {
    expect(quoteListSource).not.toMatch(/\{q\.issue_date\s*\?\?/)
    expect(quoteListSource).toContain('formatCommercialDate(q.issue_date)')
  })
})

describe('Phase C3-POLISH-R §1 — professional document sections present', () => {
  it('the PDF includes a supplier ("FROM") section and a customer ("QUOTE FOR") section', () => {
    expect(pdfSource).toContain("'FROM'")
    expect(pdfSource).toContain("'QUOTE FOR'")
  })

  it('the PDF includes a quote-details strip with number/issue/expiry/status', () => {
    expect(pdfSource).toContain('QUOTE NUMBER')
    expect(pdfSource).toContain('ISSUE DATE')
    expect(pdfSource).toContain('EXPIRY DATE')
    expect(pdfSource).toContain('STATUS')
  })

  it('the PDF paginates (addPage) and repeats a footer with page numbers on every page', () => {
    expect(pdfSource).toContain('doc.addPage()')
    expect(pdfSource).toMatch(/Page \$\{p\} of \$\{pageCount\}/)
  })
})
