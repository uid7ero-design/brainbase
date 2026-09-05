import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 7 §10/§15 — "Resend ticket email" UI, inside
// RegistrationDetail.tsx. This codebase has no React-rendering test
// harness for Events UI (no .test.tsx files exist anywhere in this
// repo) — every existing UI-facing Events test verifies behaviour via
// static source assertions instead (see
// tests/containment/eventsDropdownConsistency.test.ts's identical
// approach for the same file). This file follows that same convention.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const raw = read('app/events/[id]/RegistrationDetail.tsx')
const src = stripComments(raw)

describe('RegistrationDetail.tsx — Resend ticket email visibility', () => {
  it('receives canManage as a prop (route auth remains authoritative; this only gates rendering)', () => {
    expect(src).toContain('canManage: boolean')
  })

  it('the action button is gated on BOTH canManage and eligibility — never rendered unconditionally', () => {
    expect(src).toContain('{canManage && eligibleForTicketEmail && (')
  })

  it('eligibility is computed via the SAME shared rule the server route re-derives (lib/events/ticketEmailEligibility)', () => {
    expect(src).toContain("from '@/lib/events/ticketEmailEligibility'")
    expect(src).toContain('isOrderEligibleForTicketEmail(order)')
  })

  it('RegistrationsPanel.tsx passes its own canManage prop through to RegistrationDetail (no parallel role fetch)', () => {
    const panelSrc = stripComments(read('app/events/[id]/RegistrationsPanel.tsx'))
    expect(panelSrc).toContain('<RegistrationDetail eventId={eventId} order={o} onChanged={onRefunded} canManage={canManage} />')
  })
})

describe('RegistrationDetail.tsx — Resend ticket email confirmation', () => {
  it('the confirmation prompt includes the purchaser email', () => {
    expect(src).toMatch(/confirm\(\s*\n?\s*`[^`]*\$\{order\.purchaser_email\}/)
  })

  it('the confirmation prompt includes a ticket count', () => {
    expect(src).toContain('${eligibleAttendeeCount} ticket')
  })

  it('ticket count reflects only attendees with an EXISTING ticket_token, never a fabricated count', () => {
    expect(src).toContain('order.attendees.filter(a => a.ticket_token).length')
  })
})

describe('RegistrationDetail.tsx — Resend ticket email states', () => {
  it('renders a SUCCESS state with a timestamp', () => {
    expect(src).toContain("resendState.status === 'sent'")
    expect(src).toContain('Sent ·')
  })

  it('renders a FAILED state with the server-provided message', () => {
    expect(src).toContain("resendState.status === 'failed'")
  })

  it('renders an UNKNOWN delivery state distinct from FAILED', () => {
    expect(src).toContain("resendState.status === 'unknown'")
  })

  it('renders a distinct NOT_CONFIGURED state — never folded into FAILED or SENT', () => {
    expect(src).toContain("resendState.status === 'not_configured'")
    expect(src).toContain("status: 'not_configured'")
  })

  it('renders a distinct SENT_AUDIT_FAILED state with the required "do not immediately resend" wording', () => {
    expect(src).toContain("resendState.status === 'sent_audit_failed'")
    expect(src).toContain('Do not immediately resend')
  })

  it('renders a COOLDOWN state and disables the button while cooling down', () => {
    expect(src).toContain("resendState.status === 'cooldown'")
    expect(src).toContain("resendState.status === 'sending' || resendState.status === 'cooldown'")
  })

  it('the client distinguishes the 429 cooldown response from other responses by STATUS CODE', () => {
    expect(src).toContain('res.status === 429')
  })

  it('the client branches on the structured body.result BEFORE falling back to res.ok — not_configured/unknown/sent_audit_failed are now non-2xx but must not collapse into a generic FAILED message', () => {
    const idx = src.indexOf('async function resendTicketEmail')
    const block = src.slice(idx, idx + 1600)
    const notConfiguredIdx = block.indexOf("body.result === 'not_configured'")
    const unknownIdx = block.indexOf("body.result === 'unknown'")
    const auditFailedIdx = block.indexOf("body.result === 'sent_audit_failed'")
    const resOkIdx = block.indexOf('!res.ok')
    expect(notConfiguredIdx).toBeGreaterThan(-1)
    expect(unknownIdx).toBeGreaterThan(-1)
    expect(auditFailedIdx).toBeGreaterThan(-1)
    expect(resOkIdx).toBeGreaterThan(-1)
    // All three structured-result checks must appear BEFORE the
    // generic !res.ok fallback, so a non-2xx not_configured/unknown/
    // sent_audit_failed response is caught by its own branch first.
    expect(notConfiguredIdx).toBeLessThan(resOkIdx)
    expect(unknownIdx).toBeLessThan(resOkIdx)
    expect(auditFailedIdx).toBeLessThan(resOkIdx)
  })

  it('"sent" is only ever set from the route\'s explicit result — never inferred from res.ok alone', () => {
    // The final `setResendState({ status: 'sent', ... })` call sits
    // after every other structured-result branch has already returned,
    // so reaching it requires having fallen through not_configured/
    // unknown/sent_audit_failed/failed checks first.
    const idx = src.indexOf('async function resendTicketEmail')
    const block = src.slice(idx, idx + 1800)
    expect(block).toContain("status: 'sent', at: new Date().toISOString()")
  })
})

describe('RegistrationDetail.tsx — no editable recipient field', () => {
  it('the resend request body is empty — no recipient/email is ever sent from the client', () => {
    const idx = src.indexOf('resendTicketEmail')
    const block = src.slice(idx, src.indexOf('async function resendTicketEmail') + 1200)
    expect(block).toContain("method: 'POST' })")
    expect(block).not.toContain('purchaser_email:')
    expect(block).not.toContain('JSON.stringify')
  })

  it('no new editable email/recipient input is introduced by this feature', () => {
    // Exactly the two PRE-EXISTING editable email inputs (purchaserForm.
    // email and attendeeForm.email, both unrelated to this feature) —
    // this feature adds no third one.
    const emailInputs = (src.match(/<input[^>]*value=\{[a-zA-Z.]*[Ee]mail/g) ?? [])
    expect(emailInputs.length).toBe(2)
  })
})
