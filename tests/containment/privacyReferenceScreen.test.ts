import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(path.resolve(__dirname, '../../app/privacy/page.tsx'), 'utf-8')

describe('A.3 Privacy reference-screen migration after public-site convergence', () => {
  it('uses the current shared public legal-document system', () => {
    expect(source).toContain("from '@/components/public/legal/LegalDocument'")
    expect(source).toContain('<LegalDocument title="Privacy Policy" lastUpdated="24 August 2026" sections={SECTIONS}>')
    expect(source).toContain('<LegalList')
    expect(source).toContain('<LegalLink href="mailto:hello@thebrainbase.com.au">')
  })

  it('preserves page metadata and all 17 policy section headings', () => {
    expect(source).toContain("title: 'Privacy Policy'")
    for (const title of [
      '1. About this policy','2. What information we may collect','3. How we collect information',
      '4. Why we use information','5. Customer Data','6. AI-assisted features',
      '7. Third-party service providers','8. Overseas processing','9. Website enquiries and marketing',
      '10. Children and minors','11. Security','12. Data retention',
      '13. Access, correction and deletion requests','14. Data breaches and security incidents',
      '15. Cookies and analytics','16. Changes to this policy','17. Contact',
    ]) expect(source).toContain(`<LegalSection title="${title}">`)
  })

  it('preserves key policy claims and providers', () => {
    for (const text of [
      'Australian Privacy Principles','Customer Data','Vercel — website and application hosting',
      'Neon — database hosting','Microsoft 365 — business email and productivity tools',
      'Resend — transactional email delivery','Microsoft Clarity','Office of the Australian Information',
      'Commissioner (OAIC)',"Neon's point-in-time database recovery capability",
    ]) expect(source).toContain(text)
  })

  it('remains static and behavior-free at the page level', () => {
    expect(source).not.toContain("'use client'")
    expect(source).not.toContain('useState')
    expect(source).not.toContain('useEffect')
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('onClick=')
  })
})
