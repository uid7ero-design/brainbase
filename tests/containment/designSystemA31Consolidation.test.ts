import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf-8')

const terms = read('app/terms/page.tsx')
const privacy = read('app/privacy/page.tsx')
const proseSection = read('components/ui/ProseSection.tsx')
const proseList = read('components/ui/ProseList.tsx')
const pageCanvas = read('components/ui/PageCanvas.tsx')
const pageContainer = read('components/ui/PageContainer.tsx')
const textLink = read('components/ui/TextLink.tsx')
const barrel = read('components/ui/index.ts')

describe('A.3.1 shared prose, page layout, and link consolidation', () => {
  it('exports the new shared primitives from the UI barrel', () => {
    for (const component of [
      'ProseSection',
      'ProseList',
      'PageCanvas',
      'PageContainer',
      'TextLink',
    ]) {
      expect(barrel).toContain(`export { ${component} }`)
    }
  })

  it('keeps the prose primitives presentation-only and token-backed', () => {
    expect(proseSection).toContain("marginBottom: 'var(--bb-space-9)'")
    expect(proseSection).toContain("color: 'var(--bb-text-primary)'")
    expect(proseSection).toContain("color: 'var(--bb-text-secondary)'")
    expect(proseList).toContain("gap: 'var(--bb-space-3)'")
    expect(proseSection).not.toMatch(/use(State|Effect)|fetch\(/)
    expect(proseList).not.toMatch(/use(State|Effect)|fetch\(/)
  })

  it('keeps page layout primitives behavior-free and allows callers to preserve exact dimensions', () => {
    expect(pageCanvas).toContain("background: 'var(--bb-canvas)'")
    expect(pageCanvas).toContain("fontFamily: 'var(--bb-font-sans)'")
    expect(pageContainer).toContain("maxWidth = 720")
    expect(pageContainer).toContain("margin: '0 auto'")
    expect(pageCanvas).not.toMatch(/use(State|Effect)|fetch\(/)
    expect(pageContainer).not.toMatch(/use(State|Effect)|fetch\(/)
  })

  it('provides shared link treatment while preserving internal links and ordinary anchors', () => {
    expect(textLink).toContain("if (href.startsWith('/'))")
    expect(textLink).toContain('<Link href={href}')
    expect(textLink).toContain('<a href={href}')
    expect(textLink).toContain("accent: 'var(--bb-accent-400)'")
    expect(textLink).toContain("muted: 'var(--bb-text-muted)'")
    expect(textLink).toContain("primary: 'var(--bb-text-primary)'")
    expect(textLink).toContain("accent: 'underline'")
    expect(textLink).toContain("muted: 'none'")
    expect(textLink).not.toMatch(/use(State|Effect)|fetch\(/)
  })

  it('keeps the A.3.1 primitives available while Terms and Privacy follow the newer public legal system', () => {
    for (const component of ['PageCanvas', 'PageContainer', 'ProseSection', 'ProseList', 'TextLink']) {
      expect(barrel).toContain(`export { ${component} }`)
    }
    for (const legalSource of [terms, privacy]) {
      expect(legalSource).toContain("from '@/components/public/legal/LegalDocument'")
      expect(legalSource).toContain('<LegalDocument')
      expect(legalSource).toContain('<LegalSection')
      expect(legalSource).not.toContain('function Section(')
      expect(legalSource).not.toContain('function List(')
      expect(legalSource).not.toContain('const linkStyle')
    }
    expect(terms).toContain('href="/privacy"')
    expect(terms).toContain('href="mailto:hello@thebrainbase.com.au"')
    expect(privacy).toContain('href="mailto:hello@thebrainbase.com.au"')
  })

  it('does not introduce client state, API calls, auth, or data dependencies into the refactored legal screens', () => {
    for (const source of [terms, privacy]) {
      expect(source).not.toContain("'use client'")
      expect(source).not.toContain('"use client"')
      expect(source).not.toContain('useState')
      expect(source).not.toContain('useEffect')
      expect(source).not.toContain('fetch(')
      expect(source).not.toMatch(/@\/lib\//)
    }
  })
})
