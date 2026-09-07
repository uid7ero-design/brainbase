import { describe, it, expect } from 'vitest'
import { verificationEmail, passwordResetEmail, webServiceLeadEmail } from '@/lib/email'

// Phase C3-FINAL-POLISH — E. lib/email.ts's shared emailLayout() (and
// therefore every existing caller that still uses it) is NOT touched by
// this phase's email-branding fix — Commercial quote email now uses its
// own separate, internal commercialEmailLayout() instead (see
// lib/commercial/quoteEmail.ts). This is a regression guard proving
// that: every pre-existing caller of the SHARED layout still renders
// its own original header markup unchanged, including the exact same
// reconstructed-text wordmark it always had. This isn't approval of
// that wordmark treatment for these surfaces — it's proof this phase
// made a genuinely ADDITIVE, isolated change rather than an accidental
// edit to code every one of these unrelated email types depends on.

describe('Phase C3-FINAL-POLISH — E. unrelated shared emailLayout() callers remain unchanged', () => {
  it('verificationEmail() still renders the original shared header exactly as before', () => {
    const { html } = verificationEmail('Jane', 'tok123')
    expect(html).toContain('BRAINB<span style="color:#A78BFA">Λ</span>SE')
    expect(html).toContain('background:#08090C')
  })

  it('passwordResetEmail() still renders the original shared header exactly as before', () => {
    const { html } = passwordResetEmail('Jane', 'tok123')
    expect(html).toContain('BRAINB<span style="color:#A78BFA">Λ</span>SE')
  })

  it('webServiceLeadEmail() still renders the original shared header exactly as before', () => {
    const { html } = webServiceLeadEmail({
      id: 'lead-1', fullName: 'Jane Doe', businessName: 'Acme', email: 'jane@example.com', phone: '0400000000',
      serviceInterest: ['website_design'], budgetRange: 'under_2500', projectDesc: 'A new site',
    })
    expect(html).toContain('BRAINB<span style="color:#A78BFA">Λ</span>SE')
  })
})
