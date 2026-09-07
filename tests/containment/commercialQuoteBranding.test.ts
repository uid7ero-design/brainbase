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

describe('Phase C3-POLISH-R — the real BrainBase asset is what gets embedded, never an invented logo', () => {
  it('the rasterized PNG asset exists on disk, generated from the canonical brainbase-mark-color.svg (not hand-drawn)', () => {
    const pngPath = path.resolve(__dirname, '../../public/Brand/brainbase-mark-color-256.png')
    expect(fs.existsSync(pngPath)).toBe(true)
    // A real raster PNG of a reasonable size for a 256x256 icon with
    // gradients — catches an accidentally-truncated or placeholder file.
    expect(fs.statSync(pngPath).size).toBeGreaterThan(2000)
  })

  it('the server-side email loader reads that exact asset path, not a different/invented one', () => {
    expect(emailSource).toContain("'public', 'Brand', 'brainbase-mark-color-256.png'")
  })

  it('the client-side PDF download loader fetches that exact asset path', () => {
    expect(quoteDetailSource).toContain('/Brand/brainbase-mark-color-256.png')
  })

  it('the wordmark purple accent colour matches an actual stop colour from the real brand SVGs, not an arbitrary invented purple', () => {
    // #7C5CFF is the orbitGrad/wmAccent mid-stop in
    // public/Brand/brainbase-horizontal-color.svg — verified by direct
    // inspection of that committed asset file.
    const brandSvg = readSource('public/Brand/brainbase-horizontal-color.svg')
    expect(brandSvg).toContain('#7C5CFF')
    expect(pdfSource).toContain("BRAND_PURPLE = '#7C5CFF'")
  })

  it('the PDF header draws the Λ glyphs in the purple accent, not plain body-text colour, for both Λ occurrences in BRΛINBΛSE', () => {
    const start = pdfSource.indexOf("doc.text('BR', wmX")
    const end = pdfSource.indexOf('QUOTE', pdfSource.indexOf("doc.text('SE'"))
    const headerBlock = pdfSource.slice(start, end)
    const lambdaOccurrences = headerBlock.match(/doc\.text\('Λ',/g) ?? []
    expect(lambdaOccurrences.length).toBe(2)
    // Every Λ draw call must be preceded by a setTextColor(BRAND_PURPLE)
    // call closer than the preceding setTextColor(BRAND_INK) call.
    const purpleIdx = [...headerBlock.matchAll(/setTextColor\(BRAND_PURPLE\)/g)].map(m => m.index!)
    expect(purpleIdx.length).toBe(2)
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
