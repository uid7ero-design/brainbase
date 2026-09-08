import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Organisation Branding — Phase 1 shared server model. Every DB call is
// mocked (no real database anywhere in this file) — this proves
// coercion/validation/query-shape correctness, not live-Postgres
// behavior (jsonb_set's own well-known semantics — touching only the
// specified path, never a sibling key — are a documented Postgres
// guarantee, not something this suite re-verifies against a real
// engine; see tests/containment/eventsFreeOrderCancellation.test.ts's
// own precedent for the same "prove by inspection of the actual
// predicate" discipline applied to a different query shape).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlCalls: unknown[][] = []
const sqlMock = vi.fn((...args: unknown[]) => {
  sqlCalls.push(args)
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
vi.mock('@/lib/db', () => ({ default: sqlMock }))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sqlText(call: unknown[]): string {
  return ((call[0] as unknown) as TemplateStringsArray).join('')
}

const {
  getOrganisationBranding,
  setOrganisationBranding,
  getPublicOrganisationBranding,
  validateAccentColor,
  validateWebsite,
  validateLogoUrl,
  validateEmail,
} = await import('@/lib/organisations/branding')

const FULL_VALID_BRANDING = {
  name: 'Acme School Events',
  logoUrl: 'https://example.com/logo.png',
  accentColor: '#8a4dff', // already lowercase — normalizeAccentColor's stored form; a separate test covers uppercase-input normalization
  email: 'events@acme.test',
  phone: '0400 000 000',
  website: 'https://acme.test',
  address: '1 Example St, Adelaide SA 5000',
  abn: '12 345 678 901',
  emailFooter: 'Thanks for supporting our school!',
  emailSenderName: 'Acme School Events Team',
}

const ALL_NULL_BRANDING = {
  name: null, logoUrl: null, accentColor: null, email: null, phone: null,
  website: null, address: null, abn: null, emailFooter: null, emailSenderName: null,
}

beforeEach(() => {
  sqlMock.mockClear()
  sqlCalls.length = 0
  responseQueue = []
  callCount = 0
})

// ─── Backward compatibility (§7) ────────────────────────────────────────

describe('getOrganisationBranding — backward compatibility, never throws because branding is absent/malformed', () => {
  it('settings = {} (a brand-new organisation) -> all-null branding, real organisationName', async () => {
    queue([{ name: 'Fresh Org', settings: {} }])
    const result = await getOrganisationBranding('org-1')
    expect(result).toEqual({ organisationName: 'Fresh Org', branding: ALL_NULL_BRANDING })
  })

  it('settings = null (historically possible despite the NOT NULL schema declaration) -> safe, all-null branding, no throw', async () => {
    queue([{ name: 'Legacy Org', settings: null }])
    const result = await getOrganisationBranding('org-1')
    expect(result).toEqual({ organisationName: 'Legacy Org', branding: ALL_NULL_BRANDING })
  })

  it('settings.commercial only (no branding key at all) -> all-null branding, commercial namespace never inspected or disturbed', async () => {
    queue([{ name: 'Commercial-Only Org', settings: { commercial: { businessProfile: { tradingName: 'Acme Pty Ltd' } } } }])
    const result = await getOrganisationBranding('org-1')
    expect(result?.branding).toEqual(ALL_NULL_BRANDING)
  })

  it('settings with unrelated future top-level keys -> branding still correctly derived, ignores the unknown keys', async () => {
    queue([{ name: 'Future Org', settings: { branding: { name: 'Real Name' }, someFutureFeature: { flag: true }, commercial: {} } }])
    const result = await getOrganisationBranding('org-1')
    expect(result?.branding.name).toBe('Real Name')
  })

  it('malformed branding object (a string, not an object) -> coerces to all-null, no throw', async () => {
    queue([{ name: 'Corrupt Org', settings: { branding: 'not-an-object' } }])
    const result = await getOrganisationBranding('org-1')
    expect(result?.branding).toEqual(ALL_NULL_BRANDING)
  })

  it('malformed branding object (an array) -> coerces to all-null, no throw', async () => {
    queue([{ name: 'Corrupt Org', settings: { branding: ['not', 'an', 'object'] } }])
    const result = await getOrganisationBranding('org-1')
    // arrays are typeof 'object' but every field lookup (r.name etc.) is
    // undefined on an array, so every field still safely coerces to null
    expect(result?.branding).toEqual(ALL_NULL_BRANDING)
  })

  it('malformed individual field types (accentColor is a number, website is an object) -> only those fields coerce to null, the rest of a valid branding object is unaffected', async () => {
    queue([{ name: 'Mixed Org', settings: { branding: { name: 'Valid Name', accentColor: 12345, website: { nested: true }, phone: '0400 000 000' } } }])
    const result = await getOrganisationBranding('org-1')
    expect(result?.branding.name).toBe('Valid Name')
    expect(result?.branding.accentColor).toBeNull()
    expect(result?.branding.website).toBeNull()
    expect(result?.branding.phone).toBe('0400 000 000')
  })

  it('organisation does not exist -> returns null, not an error', async () => {
    queue([])
    const result = await getOrganisationBranding('does-not-exist')
    expect(result).toBeNull()
  })

  it('a full, valid, previously-saved branding object round-trips exactly', async () => {
    queue([{ name: 'Acme School', settings: { branding: FULL_VALID_BRANDING } }])
    const result = await getOrganisationBranding('org-1')
    expect(result?.branding).toEqual(FULL_VALID_BRANDING)
  })

  it('never mutates or re-queries anything beyond the single organisations lookup', async () => {
    queue([{ name: 'Org', settings: {} }])
    await getOrganisationBranding('org-1')
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })
})

// ─── Namespace isolation (§8) ────────────────────────────────────────────

describe('setOrganisationBranding — namespace isolation', () => {
  it('writes via jsonb_set scoped to the {branding} path only — the one Postgres-guaranteed mechanism that leaves every sibling key (settings.commercial, or anything else) untouched', async () => {
    queue([{ id: 'org-1' }])
    await setOrganisationBranding('org-1', FULL_VALID_BRANDING)
    expect(sqlCalls.length).toBe(1)
    const text = sqlText(sqlCalls[0])
    expect(text).toMatch(/jsonb_set\(/)
    expect(text).toMatch(/'\{branding\}'/)
    expect(text).toMatch(/COALESCE\(settings, '\{\}'::jsonb\)/)
    expect(text).not.toMatch(/'\{commercial/)
  })

  it('is a single atomic UPDATE statement — no separate read-then-write, so there is no window in which a concurrent write to a sibling namespace could be lost or overwritten', async () => {
    queue([{ id: 'org-1' }])
    await setOrganisationBranding('org-1', FULL_VALID_BRANDING)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('the source contains no separate SELECT of settings before the UPDATE (structural proof of the single-statement claim)', () => {
    const code = stripComments(read('lib/organisations/branding.ts'))
    const fnStart = code.indexOf('export async function setOrganisationBranding')
    const fnEnd = code.indexOf('\n}', fnStart)
    const fnBody = code.slice(fnStart, fnEnd)
    expect(fnBody).not.toMatch(/SELECT/)
  })

  it('bumps organisations.updated_at, matching the existing setBusinessProfile write pattern', async () => {
    queue([{ id: 'org-1' }])
    await setOrganisationBranding('org-1', FULL_VALID_BRANDING)
    expect(sqlText(sqlCalls[0])).toMatch(/updated_at = now\(\)/)
  })

  it('scopes the UPDATE to the given organisationId', async () => {
    queue([{ id: 'org-1' }])
    await setOrganisationBranding('org-42', FULL_VALID_BRANDING)
    const values = sqlCalls[0].slice(1) as unknown[]
    expect(JSON.stringify(values)).toContain('org-42')
  })

  it('clearing individual fields (explicit null) writes null for those fields, not an error, not an empty string', async () => {
    queue([{ id: 'org-1' }])
    await setOrganisationBranding('org-1', { ...FULL_VALID_BRANDING, phone: null, address: '' as unknown as null })
    const values = sqlCalls[0].slice(1) as unknown[]
    const jsonArg = values.find(v => typeof v === 'string' && v.includes('"name"')) as string
    const parsed = JSON.parse(jsonArg)
    expect(parsed.phone).toBeNull()
    expect(parsed.address).toBeNull()
  })

  it('an over-length name is truncated, not rejected, before being written', async () => {
    queue([{ id: 'org-1' }])
    const longName = 'A'.repeat(500)
    await setOrganisationBranding('org-1', { ...FULL_VALID_BRANDING, name: longName })
    const values = sqlCalls[0].slice(1) as unknown[]
    const jsonArg = values.find(v => typeof v === 'string' && v.includes('"name"')) as string
    const parsed = JSON.parse(jsonArg)
    expect(parsed.name.length).toBe(120)
  })

  it('an uppercase or 3-digit hex accentColor is normalized to lowercase 6-digit form on write', async () => {
    queue([{ id: 'org-1' }])
    await setOrganisationBranding('org-1', { ...FULL_VALID_BRANDING, accentColor: '#ABC' })
    const values = sqlCalls[0].slice(1) as unknown[]
    const jsonArg = values.find(v => typeof v === 'string' && v.includes('"name"')) as string
    expect(JSON.parse(jsonArg).accentColor).toBe('#aabbcc')
  })

  it('an invalid accentColor is silently dropped to null on write, never stored malformed', async () => {
    queue([{ id: 'org-1' }])
    await setOrganisationBranding('org-1', { ...FULL_VALID_BRANDING, accentColor: 'not-a-colour' })
    const values = sqlCalls[0].slice(1) as unknown[]
    const jsonArg = values.find(v => typeof v === 'string' && v.includes('"name"')) as string
    expect(JSON.parse(jsonArg).accentColor).toBeNull()
  })

  it('a non-http(s) website/logoUrl is silently dropped to null on write', async () => {
    queue([{ id: 'org-1' }])
    await setOrganisationBranding('org-1', { ...FULL_VALID_BRANDING, website: 'javascript:alert(1)', logoUrl: 'data:text/html,x' })
    const values = sqlCalls[0].slice(1) as unknown[]
    const jsonArg = values.find(v => typeof v === 'string' && v.includes('"name"')) as string
    const parsed = JSON.parse(jsonArg)
    expect(parsed.website).toBeNull()
    expect(parsed.logoUrl).toBeNull()
  })
})

// ─── Public projection (§5, §8) ──────────────────────────────────────────

describe('getPublicOrganisationBranding — exact allowlist, never leaks private fields', () => {
  it('returns exactly {name, logoUrl, accentColor, website} — no other keys, even when the stored branding has every private field set', async () => {
    queue([{ name: 'Acme School', settings: { branding: FULL_VALID_BRANDING } }])
    const result = await getPublicOrganisationBranding('org-1')
    expect(result).not.toBeNull()
    expect(Object.keys(result!).sort()).toEqual(['accentColor', 'logoUrl', 'name', 'website'])
  })

  it('private fields (email, phone, address, abn, emailFooter, emailSenderName) never appear in the public projection, by construction', async () => {
    queue([{ name: 'Acme School', settings: { branding: FULL_VALID_BRANDING } }])
    const result = await getPublicOrganisationBranding('org-1')
    const json = JSON.stringify(result)
    expect(json).not.toContain(FULL_VALID_BRANDING.email)
    expect(json).not.toContain(FULL_VALID_BRANDING.phone)
    expect(json).not.toContain(FULL_VALID_BRANDING.address)
    expect(json).not.toContain(FULL_VALID_BRANDING.abn)
    expect(json).not.toContain(FULL_VALID_BRANDING.emailFooter)
    expect(json).not.toContain(FULL_VALID_BRANDING.emailSenderName)
  })

  it('returns the correct public values when configured', async () => {
    queue([{ name: 'Acme School', settings: { branding: FULL_VALID_BRANDING } }])
    const result = await getPublicOrganisationBranding('org-1')
    expect(result).toEqual({
      name: FULL_VALID_BRANDING.name,
      logoUrl: FULL_VALID_BRANDING.logoUrl,
      accentColor: FULL_VALID_BRANDING.accentColor,
      website: FULL_VALID_BRANDING.website,
    })
  })

  it('an organisation with no branding configured returns an all-null public object, not an error', async () => {
    queue([{ name: 'Fresh Org', settings: {} }])
    const result = await getPublicOrganisationBranding('org-1')
    expect(result).toEqual({ name: null, logoUrl: null, accentColor: null, website: null })
  })

  it('a nonexistent organisation returns null', async () => {
    queue([])
    const result = await getPublicOrganisationBranding('does-not-exist')
    expect(result).toBeNull()
  })

  it('never reads organisationId from anything but its own explicit parameter — no request/cookie/header access anywhere in the module', () => {
    const code = stripComments(read('lib/organisations/branding.ts'))
    expect(code).not.toMatch(/req\.|request\.|cookies\(\)|headers\(\)|getSession|requireSession|requireRole|requireCapability/)
  })
})

// ─── Validation helpers (§6) ──────────────────────────────────────────────

describe('validateAccentColor', () => {
  it.each([null, undefined, ''])('accepts empty/absent (%s)', (v) => {
    expect(validateAccentColor(v)).toBeNull()
  })
  it.each(['#8A4DFF', '8A4DFF', '#fff', 'ABC', '#000000'])('accepts valid hex "%s"', (v) => {
    expect(validateAccentColor(v)).toBeNull()
  })
  it.each(['not-a-colour', 'rgb(1,2,3)', '#12345', '#gggggg', 12345])('rejects invalid "%s"', (v) => {
    expect(validateAccentColor(v)).not.toBeNull()
  })
})

describe('validateWebsite / validateLogoUrl', () => {
  it('accepts empty/absent', () => {
    expect(validateWebsite(null)).toBeNull()
    expect(validateWebsite('')).toBeNull()
    expect(validateLogoUrl(undefined)).toBeNull()
  })
  it('accepts http/https URLs', () => {
    expect(validateWebsite('https://example.com')).toBeNull()
    expect(validateLogoUrl('http://example.com/logo.png')).toBeNull()
  })
  it('rejects non-http(s) schemes and obviously invalid shapes', () => {
    expect(validateWebsite('javascript:alert(1)')).not.toBeNull()
    expect(validateWebsite('ftp://example.com')).not.toBeNull()
    expect(validateWebsite('not a url')).not.toBeNull()
    expect(validateLogoUrl('data:text/html,x')).not.toBeNull()
  })
})

describe('validateEmail', () => {
  it('accepts empty/absent', () => {
    expect(validateEmail(null)).toBeNull()
    expect(validateEmail('')).toBeNull()
  })
  it('accepts a basically-shaped email', () => {
    expect(validateEmail('events@acme.test')).toBeNull()
  })
  it('rejects obviously malformed values', () => {
    expect(validateEmail('not-an-email')).not.toBeNull()
    expect(validateEmail('missing-domain@')).not.toBeNull()
    expect(validateEmail('@missing-local.com')).not.toBeNull()
  })
})

// ─── Tenancy boundary (§9) ────────────────────────────────────────────────

describe('Tenancy boundary — no auth logic, no capability checks, explicit organisationId only', () => {
  const code = stripComments(read('lib/organisations/branding.ts'))

  it('never imports an Events or Commercial capability/authorize module', () => {
    expect(code).not.toMatch(/authorizeEventsRequest|authorizeCommercialRequest|requireCapability|checkCapability/)
  })

  it('never imports session/org resolution helpers', () => {
    expect(code).not.toMatch(/from '@\/lib\/org'|from '@\/lib\/session'/)
  })

  it('every exported function\'s first parameter is organisationId, not a request/body', () => {
    expect(code).toMatch(/export async function getOrganisationBranding\(organisationId: string\)/)
    expect(code).toMatch(/export async function setOrganisationBranding\(organisationId: string,/)
    expect(code).toMatch(/export async function getPublicOrganisationBranding\(organisationId: string\)/)
  })
})
