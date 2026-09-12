import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// C6.9 TEMPORARY — narrow, branch-scoped database-target override in
// lib/db.ts. Proves the guard's exact scoping: only VERCEL_ENV==='preview'
// AND VERCEL_GIT_COMMIT_REF===<this branch> AND a present
// C69_CERT_DATABASE_URL selects the certification override; every other
// combination — Production, any other branch, or the override URL simply
// missing — falls back to the original, unchanged DATABASE_URL behavior.
//
// lib/db.ts reads process.env and calls neon() at module TOP LEVEL (not
// inside a function), so each scenario needs a fresh module instance —
// vi.resetModules() before every test, then set env vars, then
// dynamically import. neon() itself is mocked so no real network client
// is ever constructed and the exact connection-string argument it
// receives can be asserted directly.

const neonMock = vi.fn((connectionString: string) => ({ __connectionString: connectionString }))
vi.mock('@neondatabase/serverless', () => ({ neon: (...a: unknown[]) => neonMock(...(a as [string])) }))

const ORIGINAL_ENV = { ...process.env }
afterEach(() => { process.env = { ...ORIGINAL_ENV } })

beforeEach(() => {
  neonMock.mockClear()
  vi.resetModules()
})

const BRANCH = 'feat/c6-9-purchasing-remediation'

describe('lib/db.ts — C6.9 certification override guard', () => {
  it('Production ignores C69_CERT_DATABASE_URL even if present — always uses DATABASE_URL', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_GIT_COMMIT_REF = BRANCH // even if this somehow matched
    process.env.DATABASE_URL = 'postgres://prod-real-db'
    process.env.C69_CERT_DATABASE_URL = 'postgres://cert-db-should-never-be-used'

    await import('@/lib/db')
    expect(neonMock).toHaveBeenCalledWith('postgres://prod-real-db')
  })

  it('an unrelated Preview branch ignores C69_CERT_DATABASE_URL even if present — always uses DATABASE_URL', async () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_GIT_COMMIT_REF = 'feat/some-other-branch'
    process.env.DATABASE_URL = 'postgres://other-branch-db'
    process.env.C69_CERT_DATABASE_URL = 'postgres://cert-db-should-never-be-used'

    await import('@/lib/db')
    expect(neonMock).toHaveBeenCalledWith('postgres://other-branch-db')
  })

  it('the feat/c6-9-purchasing-remediation Preview selects C69_CERT_DATABASE_URL when present', async () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_GIT_COMMIT_REF = BRANCH
    process.env.DATABASE_URL = 'postgres://production-derived-branch-db'
    process.env.C69_CERT_DATABASE_URL = 'postgres://isolated-c69-cert-db'

    await import('@/lib/db')
    expect(neonMock).toHaveBeenCalledWith('postgres://isolated-c69-cert-db')
  })

  it('a missing certification URL on the C6.9 branch falls back safely to DATABASE_URL (never throws, never breaks)', async () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_GIT_COMMIT_REF = BRANCH
    process.env.DATABASE_URL = 'postgres://production-derived-branch-db'
    delete process.env.C69_CERT_DATABASE_URL

    await import('@/lib/db')
    expect(neonMock).toHaveBeenCalledWith('postgres://production-derived-branch-db')
  })

  it('an empty-string C69_CERT_DATABASE_URL is treated as absent (falls back to DATABASE_URL, never passes an empty string to neon())', async () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_GIT_COMMIT_REF = BRANCH
    process.env.DATABASE_URL = 'postgres://production-derived-branch-db'
    process.env.C69_CERT_DATABASE_URL = ''

    await import('@/lib/db')
    expect(neonMock).toHaveBeenCalledWith('postgres://production-derived-branch-db')
  })

  it('local dev (VERCEL_ENV unset) ignores C69_CERT_DATABASE_URL even if present', async () => {
    delete process.env.VERCEL_ENV
    process.env.VERCEL_GIT_COMMIT_REF = BRANCH
    process.env.DATABASE_URL = 'postgres://local-dev-db'
    process.env.C69_CERT_DATABASE_URL = 'postgres://cert-db-should-never-be-used'

    await import('@/lib/db')
    expect(neonMock).toHaveBeenCalledWith('postgres://local-dev-db')
  })
})

describe('lib/db.ts — no secret exposure (source containment)', () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), 'lib/db.ts'), 'utf8')

  it('never logs either connection string', () => {
    expect(SRC).not.toMatch(/console\.(log|error|warn|info)/)
  })

  it('exports nothing but the constructed sql client — no raw connection-string export', () => {
    const exportLines = SRC.split('\n').filter(l => l.trim().startsWith('export'))
    expect(exportLines).toHaveLength(1)
    expect(exportLines[0]).toContain('export default sql')
  })

  it('the guard checks VERCEL_ENV and VERCEL_GIT_COMMIT_REF before ever reading C69_CERT_DATABASE_URL\'s value into the selected connection string', () => {
    const guardIdx = SRC.indexOf("VERCEL_ENV === 'preview'")
    const usageIdx = SRC.indexOf('isC69CertificationPreview && process.env.C69_CERT_DATABASE_URL')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(usageIdx).toBeGreaterThan(guardIdx)
  })
})
