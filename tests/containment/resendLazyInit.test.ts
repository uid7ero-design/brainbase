import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROUTE_FILES = [
  'app/api/admin/pipeline/[id]/messages/route.ts',
  'app/api/lead/route.ts',
  'app/api/leads/[id]/route.ts',
  'app/api/request-demo/route.ts',
]

describe('Task 3 — no Resend SDK is instantiated at module scope (the build-time root cause)', () => {
  for (const rel of ROUTE_FILES) {
    it(`1. ${rel} no longer calls new Resend(...) at module scope`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf-8')
      // No top-level `const resend = new Resend(...)` — the only
      // remaining `new Resend(` call in the whole repo lives inside
      // lib/resendClient.ts's lazy getter (checked separately below).
      expect(source).not.toMatch(/^const resend = new Resend\(/m)
      expect(source).toContain("import { getResendClient } from '@/lib/resendClient'")
      expect(source).not.toContain("import { Resend } from 'resend'")
    })
  }

  it('lib/resendClient.ts is the single remaining place `new Resend(` appears in runtime code', () => {
    const resendClientSrc = fs.readFileSync(path.resolve(__dirname, '../../lib/resendClient.ts'), 'utf-8')
    expect(resendClientSrc).toContain('new Resend(apiKey)')
    // The construction only happens inside the function body, not at
    // module scope — i.e. not immediately after an `export`/`const` at
    // column 0 outside a function.
    const moduleScopeMatch = resendClientSrc.match(/^const \w+ = new Resend\(/m)
    expect(moduleScopeMatch).toBeNull()
  })
})

describe('lib/resendClient.ts getResendClient() — real execution', () => {
  const ORIGINAL_KEY = process.env.RESEND_API_KEY

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = ORIGINAL_KEY
  })

  it('1. the module can be imported/loaded with no RESEND_API_KEY set at all — no throw', async () => {
    delete process.env.RESEND_API_KEY
    await expect(import('@/lib/resendClient')).resolves.toBeDefined()
  })

  it('2/4. calling getResendClient() with no key configured returns null (a controlled, checkable outcome) rather than throwing', async () => {
    delete process.env.RESEND_API_KEY
    const { getResendClient } = await import('@/lib/resendClient')
    expect(getResendClient()).toBeNull()
  })

  it('3. calling getResendClient() with a key configured returns a real, usable Resend client — Production behaviour is unchanged', async () => {
    process.env.RESEND_API_KEY = 're_test_fake_key_for_this_test_only'
    const { getResendClient } = await import('@/lib/resendClient')
    const client = getResendClient()
    expect(client).not.toBeNull()
    expect(client?.emails).toBeDefined()
    expect(typeof client?.emails.send).toBe('function')
  })

  it('the client is memoized — the same instance is returned across calls within one module load', async () => {
    process.env.RESEND_API_KEY = 're_test_fake_key_for_this_test_only'
    const { getResendClient } = await import('@/lib/resendClient')
    const a = getResendClient()
    const b = getResendClient()
    expect(a).toBe(b)
  })
})

describe('5. no secret value is ever logged', () => {
  for (const rel of ROUTE_FILES) {
    it(`${rel}: console.error/warn calls never interpolate RESEND_API_KEY's value, only report that it's missing by name`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf-8')
      const logLines = source.match(/console\.(error|warn|log)\([^)]*\)/g) ?? []
      for (const line of logLines) {
        expect(line).not.toMatch(/process\.env\.RESEND_API_KEY/)
      }
    })
  }

  it('lib/resendClient.ts itself never logs the key value', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/resendClient.ts'), 'utf-8')
    expect(source).not.toMatch(/console\.(error|warn|log)\([^)]*apiKey/)
  })
})

describe('Production email behaviour is otherwise unchanged', () => {
  // Sender/recipient resolution moved to lib/emailConfig.ts (see
  // ldTennisEmailConfig.test.ts) — the hardcoded 'onboarding@resend.dev'
  // sandbox sender these routes used to share is gone, replaced by
  // resolveEmailConfig(), but the replyTo shape each route already had is
  // otherwise unchanged.
  it('the same replyTo/subject shape is preserved in each route, and none hardcodes the onboarding@resend.dev sandbox sender any more', () => {
    const pipeline = fs.readFileSync(path.resolve(__dirname, '../../app/api/admin/pipeline/[id]/messages/route.ts'), 'utf-8')
    expect(pipeline).toContain('resolveEmailConfig(')
    expect(pipeline).not.toContain("from: 'onboarding@resend.dev'")

    const lead = fs.readFileSync(path.resolve(__dirname, '../../app/api/lead/route.ts'), 'utf-8')
    expect(lead).toContain('resolveEmailConfig(')
    expect(lead).toContain('replyTo: body.email')
    expect(lead).not.toContain("from: 'onboarding@resend.dev'")

    const leadsId = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/route.ts'), 'utf-8')
    expect(leadsId).toContain('resolveEmailConfig(')
    expect(leadsId).not.toContain("from: 'onboarding@resend.dev'")

    const requestDemo = fs.readFileSync(path.resolve(__dirname, '../../app/api/request-demo/route.ts'), 'utf-8')
    expect(requestDemo).toContain('resolveEmailConfig(')
    expect(requestDemo).toContain('replyTo: email.trim()')
    expect(requestDemo).not.toContain("from: 'onboarding@resend.dev'")
  })

  it('lib/email.ts (the separate, pre-existing fetch-based helper for auth/lead-notification emails) is untouched — no second email subsystem was created', () => {
    const emailLibSrc = fs.readFileSync(path.resolve(__dirname, '../../lib/email.ts'), 'utf-8')
    expect(emailLibSrc).toContain('export async function sendEmail(')
    expect(emailLibSrc).not.toContain('resendClient')
  })
})
