import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.resolve(__dirname, '../../app/privacy/page.tsx'),
  'utf-8',
)

describe('A.3 Privacy reference-screen migration', () => {
  it('uses shared primitives and canonical BrainBase tokens', () => {
    expect(source).toContain("from '@/components/ui'")
    expect(source).toContain('<PageCanvas')
    expect(source).toContain('<PageContainer')
    expect(source).toContain('<ProseSection')
    expect(source).toContain('<SectionHeader')
    expect(source).toContain('<Surface')
    expect(source).toContain('<TextLink')
    expect(source).toContain("style={{ padding: '48px 24px 90px' }}")
    expect(source).toContain('maxWidth={720}')
  })

  it('preserves page metadata', () => {
    expect(source).toContain("title: 'Privacy Policy'")
    expect(source).toContain(
      "'How Brainbase (trading as BRΛINBΛSE) collects, uses and protects information across our website and platform.'",
    )
  })

  it('preserves all 17 policy section headings', () => {
    for (const title of [
      '1. About this policy',
      '2. What information we may collect',
      '3. How we collect information',
      '4. Why we use information',
      '5. Customer Data',
      '6. AI-assisted features',
      '7. Third-party service providers',
      '8. Overseas processing',
      '9. Website enquiries and marketing',
      '10. Children and minors',
      '11. Security',
      '12. Data retention',
      '13. Access, correction and deletion requests',
      '14. Data breaches and security incidents',
      '15. Cookies and analytics',
      '16. Changes to this policy',
      '17. Contact',
    ]) {
      expect(source).toContain(`<ProseSection title="${title}">`)
    }
  })

  it('preserves navigation, contact destination, and last-updated date', () => {
    expect(source).toContain('href="/"')
    expect(source).toContain('← Back to BRΛINBΛSE')
    expect(source).toContain('href="mailto:hello@thebrainbase.com.au"')
    expect(source).toContain('hello@thebrainbase.com.au')
    expect(source).toContain('Last updated: 24 August 2026')
  })

  it('preserves key privacy-policy claims and service-provider references', () => {
    for (const text of [
      'Australian Privacy Principles',
      'Customer Data',
      'Vercel — website and application hosting',
      'Neon — database hosting',
      'Microsoft 365 — business email and productivity tools',
      'Resend — transactional email delivery',
      'Microsoft Clarity',
      'Office of the Australian Information',
      'Commissioner (OAIC)',
      "Neon's point-in-time database recovery capability",
    ]) {
      expect(source).toContain(text)
    }
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
