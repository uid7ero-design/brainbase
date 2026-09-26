import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.resolve(__dirname, '../../app/terms/page.tsx'),
  'utf-8',
)

describe('A.3 Terms reference-screen migration', () => {
  it('uses shared primitives and canonical BrainBase tokens', () => {
    expect(source).toContain("import { SectionHeader, Surface } from '@/components/ui'")
    expect(source).toContain('<SectionHeader')
    expect(source).toContain('<Surface')
    expect(source).toContain("background: 'var(--bb-canvas)'")
    expect(source).toContain("color: 'var(--bb-text-primary)'")
    expect(source).toContain("fontFamily: 'var(--bb-font-sans)'")
    expect(source).toContain("const linkStyle = { color: 'var(--bb-accent-400)' }")
  })

  it('preserves page metadata', () => {
    expect(source).toContain("title: 'Terms of Use'")
    expect(source).toContain(
      "'The website terms of use for Brainbase (trading as BRΛINBΛSE), covering use of thebrainbase.com.au.'",
    )
  })

  it('preserves all 14 legal section headings', () => {
    for (const title of [
      '1. Acceptance of terms',
      '2. About the website',
      '3. Information only / no guaranteed availability',
      '4. Intellectual property',
      '5. Acceptable use',
      '6. Third-party links and services',
      '7. Demo and example data',
      '8. AI-generated and demo content',
      '9. Website availability',
      '10. Liability',
      '11. Privacy',
      '12. Changes to the website and these terms',
      '13. Governing law',
      '14. Contact',
    ]) {
      expect(source).toContain(`<Section title="${title}">`)
    }
  })

  it('preserves navigation and contact destinations', () => {
    expect(source).toContain('href="/"')
    expect(source).toContain('← Back to BRΛINBΛSE')
    expect(source).toContain('href="/privacy"')
    expect(source).toContain('href="mailto:hello@thebrainbase.com.au"')
    expect(source).toContain('hello@thebrainbase.com.au')
  })

  it('preserves the last-updated date and key governing-law copy', () => {
    expect(source).toContain('Last updated: 24 August 2026')
    expect(source).toContain('These terms are governed by the laws of South Australia')
    expect(source).toContain('the courts of South Australia.')
  })

  it('remains a static server-rendered informational screen with no behaviour added', () => {
    expect(source).not.toContain("'use client'")
    expect(source).not.toContain('"use client"')
    expect(source).not.toContain('useState')
    expect(source).not.toContain('useEffect')
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('onClick=')
    expect(source).not.toMatch(/@\/lib\//)
  })

  it('does not add any non-UI component dependency', () => {
    expect(source).not.toMatch(/@\/components\/(?!ui)/)
  })
})
