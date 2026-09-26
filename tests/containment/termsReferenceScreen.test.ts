import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(path.resolve(__dirname, '../../app/terms/page.tsx'), 'utf-8')

describe('A.3 Terms reference-screen migration after public-site convergence', () => {
  it('uses the current shared public legal-document system', () => {
    expect(source).toContain("from '@/components/public/legal/LegalDocument'")
    expect(source).toContain('<LegalDocument title="Terms of Use" lastUpdated="24 August 2026" sections={SECTIONS}>')
    expect(source).toContain('<LegalList')
    expect(source).toContain('<LegalLink href="/privacy">')
  })

  it('preserves page metadata and all 14 legal section headings', () => {
    expect(source).toContain("title: 'Terms of Use'")
    for (const title of [
      '1. Acceptance of terms','2. About the website','3. Information only / no guaranteed availability',
      '4. Intellectual property','5. Acceptable use','6. Third-party links and services',
      '7. Demo and example data','8. AI-generated and demo content','9. Website availability',
      '10. Liability','11. Privacy','12. Changes to the website and these terms',
      '13. Governing law','14. Contact',
    ]) expect(source).toContain(`<LegalSection title="${title}">`)
  })

  it('preserves privacy/contact destinations and governing-law copy', () => {
    expect(source).toContain('href="/privacy"')
    expect(source).toContain('href="mailto:hello@thebrainbase.com.au"')
    expect(source).toContain('These terms are governed by the laws of South Australia')
    expect(source).toContain('the courts of South Australia.')
  })

  it('remains static and behavior-free at the page level', () => {
    expect(source).not.toContain("'use client'")
    expect(source).not.toContain('useState')
    expect(source).not.toContain('useEffect')
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('onClick=')
  })
})
