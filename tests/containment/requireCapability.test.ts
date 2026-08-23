import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Modular Platform Foundation Phase F.5B — the server capability
// authority (lib/capabilities/requireCapability.ts). This suite proves
// the primitive's behaviour AND its architectural boundaries: it never
// resolves organisationId itself, never touches Prisma, never casts to
// ::uuid, never reads organisations.plan or any integration table,
// never constructs an HTTP Response, and distinguishes all five
// possible outcomes (unknown capability / globally inactive / no
// entitlement / disabled entitlement / database failure) without ever
// collapsing them via a JOIN. Zero route consumers, zero seeds, zero
// Production changes — this file only exercises the primitive itself.

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

function sqlCallArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}

const {
  checkCapability,
  requireCapability,
  CapabilityAccessError,
  CapabilityDatabaseError,
} = await import('@/lib/capabilities/requireCapability')

const SOURCE_PATH = path.resolve(__dirname, '../../lib/capabilities/requireCapability.ts')
const RAW_SOURCE = fs.readFileSync(SOURCE_PATH, 'utf-8')

// Strip comments/prose before scanning executable code so assertions
// never false-positive on this file's own extensive explanatory
// comments (which legitimately name ::uuid, Prisma, organisations.plan,
// Microsoft/Google/Instagram, and JOIN when explaining what the file
// deliberately does NOT do) — the same discipline established in
// tests/containment/capabilitySchemaFoundation.test.ts and
// tests/containment/founderTasks.test.ts.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
const CODE = stripComments(RAW_SOURCE)

beforeEach(() => {
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
})

describe('requireCapability.ts — architectural boundaries (source-level)', () => {
  it('never casts organisationId (or anything else) to ::uuid', () => {
    expect(CODE).not.toMatch(/::uuid/i)
  })

  it('never resolves a session/cookie/auth mechanism itself', () => {
    expect(CODE).not.toMatch(/getSession|getAuthSession|requireSession|requireRole|cookies\(\)/)
  })

  it('never imports or uses Prisma Client', () => {
    expect(CODE).not.toMatch(/@\/lib\/prisma|@prisma\/client|PrismaClient/)
  })

  it('imports the raw sql client from lib/db, not any other data-access module', () => {
    expect(CODE).toMatch(/import sql from ['"]@\/lib\/db['"]/)
  })

  it('never reads organisations.plan', () => {
    expect(CODE).not.toMatch(/organisations?\.plan|\bplan\b\s*[:=]/)
  })

  it('never references any integration vendor or integration table', () => {
    expect(CODE).not.toMatch(/microsoft|google|instagram|integration/i)
  })

  it('never constructs an HTTP Response or imports Next.js route helpers', () => {
    expect(CODE).not.toMatch(/new Response|NextResponse|next\/server/)
  })

  it('never queries modules and organisation_modules via a single collapsing JOIN', () => {
    expect(CODE).not.toMatch(/\bJOIN\b/i)
  })

  it('does not read process.env directly (no hardcoded org resolution)', () => {
    expect(CODE).not.toMatch(/process\.env/)
  })

  it('exports both checkCapability (non-throwing) and requireCapability (throwing)', () => {
    expect(CODE).toMatch(/export async function checkCapability/)
    expect(CODE).toMatch(/export async function requireCapability/)
  })

  it('exports two distinct, separately-named error classes', () => {
    expect(CODE).toMatch(/export class CapabilityAccessError extends Error/)
    expect(CODE).toMatch(/export class CapabilityDatabaseError extends Error/)
    expect(CODE).not.toMatch(/class CapabilityDatabaseError extends CapabilityAccessError/)
  })
})

describe('checkCapability() — the five distinguishable outcomes', () => {
  it('unknown capability key: modules has no matching row -> UNKNOWN_CAPABILITY, and the entitlement table is never queried', async () => {
    queue([])
    const result = await checkCapability('org-1', 'nonexistent-capability')
    expect(result).toEqual({ allowed: false, reason: 'UNKNOWN_CAPABILITY' })
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('capability globally inactive: modules.active = false -> CAPABILITY_INACTIVE, and the entitlement table is never queried', async () => {
    queue([{ active: false }])
    const result = await checkCapability('org-1', 'crm')
    expect(result).toEqual({ allowed: false, reason: 'CAPABILITY_INACTIVE' })
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('no entitlement row: module active, but organisation has no organisation_modules row -> NO_ENTITLEMENT', async () => {
    queue([{ active: true }], [])
    const result = await checkCapability('org-1', 'crm')
    expect(result).toEqual({ allowed: false, reason: 'NO_ENTITLEMENT' })
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })

  it('entitlement disabled: row exists but enabled = false -> ENTITLEMENT_DISABLED', async () => {
    queue([{ active: true }], [{ enabled: false, config: {} }])
    const result = await checkCapability('org-1', 'crm')
    expect(result).toEqual({ allowed: false, reason: 'ENTITLEMENT_DISABLED' })
  })

  it('fully entitled: module active, entitlement row enabled -> allowed: true with the entitlement config', async () => {
    queue([{ active: true }], [{ enabled: true, config: { seatLimit: 5 } }])
    const result = await checkCapability('org-1', 'crm')
    expect(result).toEqual({
      allowed: true,
      entitlement: { key: 'crm', config: { seatLimit: 5 } },
    })
  })

  it('denied results never carry an entitlement/config field', async () => {
    queue([{ active: true }], [{ enabled: false, config: { seatLimit: 5 } }])
    const result = await checkCapability('org-1', 'crm')
    expect(result.allowed).toBe(false)
    expect(result).not.toHaveProperty('entitlement')
  })
})

describe('checkCapability() — fail-closed defensiveness', () => {
  it('active must be strictly boolean true — a truthy non-boolean value ("true" string) is treated as inactive', async () => {
    queue([{ active: 'true' as unknown as boolean }])
    const result = await checkCapability('org-1', 'crm')
    expect(result).toEqual({ allowed: false, reason: 'CAPABILITY_INACTIVE' })
  })

  it('enabled must be strictly boolean true — a truthy non-boolean value (1) is treated as disabled', async () => {
    queue([{ active: true }], [{ enabled: 1 as unknown as boolean, config: {} }])
    const result = await checkCapability('org-1', 'crm')
    expect(result).toEqual({ allowed: false, reason: 'ENTITLEMENT_DISABLED' })
  })

  it('malformed config on an otherwise-enabled row (not a plain object) fails closed as DATABASE_ERROR rather than allowing access with a guessed-at config', async () => {
    queue([{ active: true }], [{ enabled: true, config: 'not-an-object' }])
    const result = await checkCapability('org-1', 'crm')
    expect(result).toEqual({ allowed: false, reason: 'DATABASE_ERROR' })
  })

  it('a null config on an otherwise-enabled row also fails closed as DATABASE_ERROR', async () => {
    queue([{ active: true }], [{ enabled: true, config: null }])
    const result = await checkCapability('org-1', 'crm')
    expect(result).toEqual({ allowed: false, reason: 'DATABASE_ERROR' })
  })

  it('an array config on an otherwise-enabled row also fails closed as DATABASE_ERROR', async () => {
    queue([{ active: true }], [{ enabled: true, config: [] }])
    const result = await checkCapability('org-1', 'crm')
    expect(result).toEqual({ allowed: false, reason: 'DATABASE_ERROR' })
  })
})

describe('checkCapability() — database failure is never thrown, and never authorizes', () => {
  it('never rejects when the first query (modules) throws — resolves to DATABASE_ERROR instead', async () => {
    sqlMock.mockImplementationOnce(() => Promise.reject(new Error('connection reset')))
    await expect(checkCapability('org-1', 'crm')).resolves.toEqual({
      allowed: false,
      reason: 'DATABASE_ERROR',
    })
  })

  it('never rejects when the second query (organisation_modules) throws — resolves to DATABASE_ERROR instead', async () => {
    sqlMock
      .mockImplementationOnce(() => Promise.resolve([{ active: true }]))
      .mockImplementationOnce(() => Promise.reject(new Error('connection reset')))
    await expect(checkCapability('org-1', 'crm')).resolves.toEqual({
      allowed: false,
      reason: 'DATABASE_ERROR',
    })
  })

  it('a database failure is operationally distinguishable from an ordinary denial via the reason field alone', async () => {
    sqlMock.mockImplementationOnce(() => Promise.reject(new Error('connection reset')))
    const dbFailure = await checkCapability('org-1', 'crm')
    queue([])
    const ordinaryDenial = await checkCapability('org-1', 'crm')
    expect(dbFailure).toMatchObject({ reason: 'DATABASE_ERROR' })
    expect(ordinaryDenial).toMatchObject({ reason: 'UNKNOWN_CAPABILITY' })
    expect(dbFailure.allowed).toBe(false)
    expect(ordinaryDenial.allowed).toBe(false)
  })

  it('never leaks raw SQL/database error text into the resolved result', async () => {
    sqlMock.mockImplementationOnce(() => Promise.reject(new Error('password authentication failed for user "neon"')))
    const result = await checkCapability('org-1', 'crm')
    expect(JSON.stringify(result)).not.toMatch(/password|neon|authentication/i)
  })
})

describe('requireCapability() — throwing wrapper', () => {
  it('returns the entitlement on success', async () => {
    queue([{ active: true }], [{ enabled: true, config: { seatLimit: 5 } }])
    const entitlement = await requireCapability('org-1', 'crm')
    expect(entitlement).toEqual({ key: 'crm', config: { seatLimit: 5 } })
  })

  it('throws CapabilityAccessError (identifiable via instanceof) for an unknown capability', async () => {
    queue([])
    await expect(requireCapability('org-1', 'crm')).rejects.toBeInstanceOf(CapabilityAccessError)
  })

  it('throws CapabilityAccessError for a globally inactive capability', async () => {
    queue([{ active: false }])
    await expect(requireCapability('org-1', 'crm')).rejects.toBeInstanceOf(CapabilityAccessError)
  })

  it('throws CapabilityAccessError for no entitlement row', async () => {
    queue([{ active: true }], [])
    await expect(requireCapability('org-1', 'crm')).rejects.toBeInstanceOf(CapabilityAccessError)
  })

  it('throws CapabilityAccessError for a disabled entitlement', async () => {
    queue([{ active: true }], [{ enabled: false, config: {} }])
    await expect(requireCapability('org-1', 'crm')).rejects.toBeInstanceOf(CapabilityAccessError)
  })

  it('throws a distinct CapabilityDatabaseError (NOT CapabilityAccessError) specifically on database failure', async () => {
    sqlMock.mockImplementationOnce(() => Promise.reject(new Error('connection reset')))
    let caught: unknown
    try {
      await requireCapability('org-1', 'crm')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CapabilityDatabaseError)
    expect(caught).not.toBeInstanceOf(CapabilityAccessError)
  })

  it('denial can be identified purely by instanceof/class — never requires parsing .message', async () => {
    queue([])
    let caught: unknown
    try {
      await requireCapability('org-1', 'crm')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CapabilityAccessError)
    expect((caught as InstanceType<typeof CapabilityAccessError>).reason).toBe('UNKNOWN_CAPABILITY')
  })
})

describe('checkCapability() — organisation and capability isolation', () => {
  it('passes the exact requested capabilityKey to the modules lookup', async () => {
    queue([])
    await checkCapability('org-1', 'bookings')
    expect(sqlCallArgs(0)).toContain('bookings')
  })

  it('passes the exact requested organisationId and capabilityKey to the entitlement lookup — never a session-derived value', async () => {
    queue([{ active: true }], [])
    await checkCapability('org-42', 'crm')
    const args = sqlCallArgs(1)
    expect(args).toContain('org-42')
    expect(args).toContain('crm')
  })

  it('two different organisations checking the same capability are queried independently, each with its own organisationId', async () => {
    queue([{ active: true }], [{ enabled: true, config: {} }])
    await checkCapability('org-a', 'crm')
    queue([{ active: true }], [{ enabled: false, config: {} }])
    await checkCapability('org-b', 'crm')
    expect(sqlCallArgs(1)).toContain('org-a')
    expect(sqlCallArgs(3)).toContain('org-b')
  })
})
