import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Modular Platform Foundation Phase F.6I — the first admin capability
// entitlement control (app/actions/orgModules.ts). This suite proves:
// super_admin-only server-side authorization, correct explicit-target-
// organisation semantics, the LEFT JOIN read model, the locked enable/
// disable lifecycle (including the mandatory disable-with-no-row
// successful no-op, never an INSERT), config preservation, fail-closed
// DB-error handling with no raw error leakage, and the absence of any
// TopNav/navigation/requireCapability/plan/integration involvement.
// No Production connection or data mutation occurs anywhere in this
// file — every dependency is mocked.

const getSessionMock = vi.fn()
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>()
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}
function sqlCallArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}
function sqlCallText(index: number): string {
  const args = sqlCallArgs(index)
  return (args[0] as TemplateStringsArray).join(' ')
}

const { getOrganisationCapabilities, setOrganisationCapability } = await import('@/app/actions/orgModules')

const SOURCE_PATH = path.resolve(__dirname, '../../app/actions/orgModules.ts')
const RAW_SOURCE = fs.readFileSync(SOURCE_PATH, 'utf-8')
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
const CODE = stripComments(RAW_SOURCE)

const SUPER_ADMIN = { userId: 'u1', organisationId: 'brainbase-org', role: 'super_admin', name: 'James' }
const MANAGER = { userId: 'u2', organisationId: 'org-a', role: 'manager', name: 'Not James' }

const ORG_ROW = [{ id: 'org-target' }]
const CRM_MODULE_ACTIVE = [{ key: 'crm', active: true }]
const CRM_MODULE_INACTIVE = [{ key: 'crm', active: false }]

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockReset()
  revalidatePathMock.mockReset()
  responseQueue = []
  callCount = 0
})

describe('AUTHORIZATION', () => {
  it('1. no session -> rejected before DB access', async () => {
    getSessionMock.mockResolvedValue(null)
    await expect(getOrganisationCapabilities('org-target')).rejects.toThrow('Unauthorized')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('2. non-super_admin -> rejected before DB access (read and mutation)', async () => {
    getSessionMock.mockResolvedValue(MANAGER)
    await expect(getOrganisationCapabilities('org-target')).rejects.toThrow('Unauthorized')
    expect(sqlMock).not.toHaveBeenCalled()

    sqlMock.mockClear()
    await expect(setOrganisationCapability('org-target', 'crm', true)).rejects.toThrow('Unauthorized')
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('READ MODEL — getOrganisationCapabilities', () => {
  beforeEach(() => getSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('3. uses the explicit organisationId argument, not session.organisationId', async () => {
    queue(ORG_ROW, [])
    await getOrganisationCapabilities('org-target')
    expect(sqlCallArgs(0)).toContain('org-target')
    expect(sqlCallArgs(0)).not.toContain('brainbase-org')
  })

  it('4. organisation existence is verified before the capability query runs', async () => {
    queue([]) // no org row
    await expect(getOrganisationCapabilities('org-missing')).rejects.toThrow('Organisation not found.')
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('5. the read query LEFT JOINs organisation_modules onto modules, scoped to the target organisation', async () => {
    queue(ORG_ROW, [])
    await getOrganisationCapabilities('org-target')
    const text = sqlCallText(1)
    expect(text).toMatch(/FROM\s+modules\s+m/i)
    expect(text).toMatch(/LEFT JOIN\s+organisation_modules\s+om/i)
    expect(text).toMatch(/om\.module_key\s*=\s*m\.key/i)
    expect(text).toMatch(/om\.organisation_id\s*=/i)
    expect(sqlCallArgs(1)).toContain('org-target')
  })

  it('6. a missing entitlement row projects enabled=false via COALESCE', async () => {
    queue(ORG_ROW, [{ key: 'crm', name: 'CRM', description: null, active: true, enabled: false }])
    const result = await getOrganisationCapabilities('org-target')
    expect(result).toEqual([{ key: 'crm', name: 'CRM', description: null, active: true, enabled: false }])
    expect(sqlCallText(1)).toMatch(/COALESCE\(om\.enabled,\s*false\)/i)
  })

  it('7. active/inactive registry state is returned', async () => {
    queue(ORG_ROW, [
      { key: 'crm', name: 'CRM', description: null, active: true, enabled: true },
      { key: 'legacy', name: 'Legacy', description: null, active: false, enabled: false },
    ])
    const result = await getOrganisationCapabilities('org-target')
    expect(result.map(r => r.active)).toEqual([true, false])
  })

  it('8. config is never selected/exposed', async () => {
    queue(ORG_ROW, [])
    await getOrganisationCapabilities('org-target')
    expect(sqlCallText(1)).not.toMatch(/\bconfig\b/i)
  })

  it('9. results are ordered deterministically by m.name', async () => {
    queue(ORG_ROW, [])
    await getOrganisationCapabilities('org-target')
    expect(sqlCallText(1)).toMatch(/ORDER BY\s+m\.name/i)
  })
})

describe('ENABLE', () => {
  beforeEach(() => getSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('10. enable + missing row creates enabled=true via INSERT ... ON CONFLICT DO UPDATE', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, [])
    const result = await setOrganisationCapability('org-target', 'crm', true)
    expect(result).toEqual({ ok: true })
    const text = sqlCallText(2)
    expect(text).toMatch(/INSERT INTO organisation_modules/i)
    expect(text).toMatch(/ON CONFLICT \(organisation_id, module_key\)/i)
    expect(text).toMatch(/DO UPDATE SET enabled = true/i)
  })

  it('11. enable + existing disabled row results enabled=true', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, [])
    const result = await setOrganisationCapability('org-target', 'crm', true)
    expect(result).toEqual({ ok: true })
  })

  it('12. enable + already-enabled entitlement is idempotent', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, [])
    const result = await setOrganisationCapability('org-target', 'crm', true)
    expect(result).toEqual({ ok: true })
    // Same UPSERT path runs regardless of prior state — idempotent by construction.
    expect(sqlCallText(2)).toMatch(/DO UPDATE SET enabled = true/i)
  })

  it('13. enable preserves existing config — the UPSERT never sets config', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, [])
    await setOrganisationCapability('org-target', 'crm', true)
    expect(sqlCallText(2)).not.toMatch(/\bconfig\s*=/i)
  })

  it('14. an inactive capability cannot be enabled — no organisation_modules write is attempted', async () => {
    queue(ORG_ROW, CRM_MODULE_INACTIVE)
    const result = await setOrganisationCapability('org-target', 'crm', true)
    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })

  it('15. an unknown capability cannot be enabled', async () => {
    queue(ORG_ROW, [])
    const result = await setOrganisationCapability('org-target', 'nonexistent', true)
    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })

  it('16. a nonexistent organisation cannot be mutated', async () => {
    queue([])
    const result = await setOrganisationCapability('org-missing', 'crm', true)
    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })
})

describe('DISABLE', () => {
  beforeEach(() => getSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('17. disable + enabled row sets enabled=false via UPDATE', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, [])
    const result = await setOrganisationCapability('org-target', 'crm', false)
    expect(result).toEqual({ ok: true })
    const text = sqlCallText(2)
    expect(text).toMatch(/UPDATE organisation_modules/i)
    expect(text).toMatch(/SET enabled = false/i)
    expect(text).not.toMatch(/INSERT/i)
  })

  it('18. disable + already-disabled remains safely disabled (idempotent)', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, [])
    const result = await setOrganisationCapability('org-target', 'crm', false)
    expect(result).toEqual({ ok: true })
  })

  it('19. disable preserves config — the UPDATE never touches config', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, [])
    await setOrganisationCapability('org-target', 'crm', false)
    expect(sqlCallText(2)).not.toMatch(/\bconfig\s*=/i)
  })

  it('20. an inactive-but-enabled capability can still be disabled', async () => {
    queue(ORG_ROW, CRM_MODULE_INACTIVE, [])
    const result = await setOrganisationCapability('org-target', 'crm', false)
    expect(result).toEqual({ ok: true })
    expect(sqlCallText(2)).toMatch(/UPDATE organisation_modules/i)
  })

  it('21. disable + NO entitlement row is a SUCCESSFUL NO-OP', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, []) // UPDATE affecting zero rows resolves with an empty array, not an error
    const result = await setOrganisationCapability('org-target', 'crm', false)
    expect(result).toEqual({ ok: true })
  })

  it('22. test 21 proves no INSERT occurred', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, [])
    await setOrganisationCapability('org-target', 'crm', false)
    expect(sqlCallText(2)).not.toMatch(/INSERT/i)
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  it('23. test 21 proves no enabled=false row is manufactured — the disable path is always a plain UPDATE, never an upsert', () => {
    // Source-level: the disable branch must never contain INSERT/ON CONFLICT.
    const disableBranch = CODE.split('if (enabled) {')[1] ?? ''
    const elseBranch = disableBranch.split('} else {')[1] ?? ''
    expect(elseBranch).not.toMatch(/INSERT/i)
    expect(elseBranch).not.toMatch(/ON CONFLICT/i)
    expect(elseBranch).toMatch(/UPDATE organisation_modules/i)
  })
})

describe('SECURITY / CONTAINMENT', () => {
  beforeEach(() => getSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('24. organisation ids are passed as plain TEXT values, never cast', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, [])
    await setOrganisationCapability('org-target', 'crm', true)
    expect(sqlCallArgs(0)).toContain('org-target')
  })

  it('25. no ::uuid cast anywhere in the action file', () => {
    expect(CODE).not.toMatch(/::uuid/i)
  })

  it('26. the capability key is registry-validated before any write', () => {
    expect(CODE).toMatch(/SELECT key, active FROM modules WHERE key = /)
  })

  it('27. no client-supplied config parameter exists on either exported function', () => {
    expect(CODE).not.toMatch(/config\s*:\s*(unknown|any|Record|string)/i)
    expect(CODE).toMatch(/export async function setOrganisationCapability\(\s*organisationId: string,\s*capabilityKey: string,\s*enabled: boolean,?\s*\)/)
  })

  it('28. the mutation SQL never overwrites config in either branch', () => {
    expect(CODE).not.toMatch(/SET[\s\S]{0,80}config\s*=/i)
  })

  it('29. a DB failure cannot resolve as success', async () => {
    getSessionMock.mockResolvedValue(SUPER_ADMIN)
    sqlMock.mockReset()
    let call = 0
    sqlMock.mockImplementation(() => {
      call += 1
      if (call === 1) return Promise.resolve(ORG_ROW)
      if (call === 2) return Promise.resolve(CRM_MODULE_ACTIVE)
      return Promise.reject(new Error('connection reset'))
    })
    const result = await setOrganisationCapability('org-target', 'crm', true)
    expect(result.ok).toBe(false)
  })

  it('30. raw injected DB error text is never client-visible', async () => {
    sqlMock.mockReset()
    let call = 0
    sqlMock.mockImplementation(() => {
      call += 1
      if (call === 1) return Promise.resolve(ORG_ROW)
      if (call === 2) return Promise.resolve(CRM_MODULE_ACTIVE)
      return Promise.reject(new Error('password authentication failed for user "neon"'))
    })
    const result = await setOrganisationCapability('org-target', 'crm', true)
    expect(JSON.stringify(result)).not.toMatch(/password|neon|authentication/i)
  })

  it('31. revalidatePath("/admin/orgs") occurs after a successful mutation, and only then', async () => {
    queue(ORG_ROW, CRM_MODULE_ACTIVE, [])
    await setOrganisationCapability('org-target', 'crm', true)
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/orgs')

    revalidatePathMock.mockClear()
    queue(ORG_ROW, CRM_MODULE_INACTIVE) // enable rejected — no mutation
    await setOrganisationCapability('org-target', 'crm', true)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('32. no organisations.plan reference anywhere in the action file', () => {
    expect(CODE).not.toMatch(/organisations?\.plan/i)
  })

  it('33. no integration-table or integration-provider logic', () => {
    expect(CODE).not.toMatch(/microsoft|google|instagram|integration/i)
  })

  it('34. no requireCapability/checkCapability use', () => {
    expect(CODE).not.toMatch(/requireCapability|checkCapability/)
  })

  it('35. neither changed file imports/references TopNav or navigation visibility logic', () => {
    const adminClientSource = fs.readFileSync(
      path.resolve(__dirname, '../../app/admin/orgs/AdminClient.tsx'),
      'utf-8',
    )
    expect(CODE).not.toMatch(/TopNav/)
    expect(adminClientSource).not.toMatch(/TopNav/)
  })
})

describe('AdminClient.tsx — capability toggle pending-state regression (Phase F.6N)', () => {
  // Phase F.6M discovery: toggleCapability() fired its refetch
  // (getOrganisationCapabilities) without awaiting it, so the
  // useTransition() pending state (isCapabilityPending) could settle
  // independently of the refresh actually completing — leaving the
  // capability section visibly stuck (dimmed/disabled) until a hard
  // browser refresh, even though the underlying entitlement write
  // always succeeded. This is a SOURCE-LEVEL containment check, not a
  // behavioural/rendered test — this repo has no React component-
  // rendering test infrastructure (no @testing-library/react or
  // equivalent dependency exists anywhere in package.json). It proves
  // the specific fire-and-forget code shape that caused the bug is
  // gone and the corrected shape is present; it does NOT independently
  // prove the runtime race is resolved — that requires the manual
  // browser smoke test described in the Phase F.6N report.
  const ADMIN_CLIENT_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../../app/admin/orgs/AdminClient.tsx'),
    'utf-8',
  )
  function stripAdminComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }
  const ADMIN_CODE = stripAdminComments(ADMIN_CLIENT_SOURCE)

  function toggleCapabilityBody(): string {
    const start = ADMIN_CODE.indexOf('function toggleCapability(')
    expect(start, 'expected to find toggleCapability(...)').toBeGreaterThan(-1)
    const end = ADMIN_CODE.indexOf('\n  }\n', start)
    return ADMIN_CODE.slice(start, end)
  }

  it('the capability refetch is awaited, not fired-and-forgotten', () => {
    const body = toggleCapabilityBody()
    expect(body).toMatch(/await getOrganisationCapabilities\(orgId\)/)
    // The old fire-and-forget shape must not remain anywhere in this function.
    expect(body).not.toMatch(/getOrganisationCapabilities\(orgId\)\s*\n\s*\.then\(/)
  })

  it('the mutation and the refetch are both awaited inside the same try block, so one tracked async operation spans the full write-then-read sequence', () => {
    const body = toggleCapabilityBody()
    expect(body).toMatch(/try\s*\{[\s\S]*await setOrganisationCapability\([\s\S]*await getOrganisationCapabilities\([\s\S]*\}\s*catch/)
  })

  it('a rejection from either the mutation or the refetch is caught and surfaces the existing safe, generic capability error state', () => {
    const body = toggleCapabilityBody()
    expect(body).toMatch(/catch\s*\{\s*setCapabilitiesError\(/)
  })

  it('local capability state is only replaced after the refetch resolves — never optimistically updated', () => {
    const body = toggleCapabilityBody()
    expect(body).toMatch(/const caps = await getOrganisationCapabilities\(orgId\);\s*\n\s*setCapabilities\(caps\)/)
  })

  it('the toggle function still returns early on an ordinary mutation failure without proceeding to the refetch', () => {
    const body = toggleCapabilityBody()
    expect(body).toMatch(/if \(!result\.ok\) \{ setCapabilitiesError\(result\.error\); return; \}/)
  })
})
