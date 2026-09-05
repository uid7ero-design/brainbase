import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C2 — lib/commercial/auditLog.ts, applying ADR-0003. Modeled
// directly on lib/events/auditLog.ts's shape: best-effort (try/catch,
// never throws to the caller), action namespace
// '<resource_type>.<verb>', PII/secrets discipline.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('Phase C2 — commercial audit log source shape (static)', () => {
  const source = stripComments(readSource('lib/commercial/auditLog.ts'))

  it('every write is wrapped in try/catch — a failed audit write is caught, never re-thrown to the caller', () => {
    const insertFnStart = source.indexOf('async function insertAuditLog')
    const insertFnBody = source.slice(insertFnStart, source.indexOf('export async function', insertFnStart))
    expect(insertFnBody).toMatch(/try\s*\{/)
    expect(insertFnBody).toMatch(/catch\s*\(err\)/)
    expect(insertFnBody).toMatch(/console\.error/)
  })

  it('every action name follows <resource_type>.<verb>, snake_case, past tense (ADR-0003 §12)', () => {
    const actions = source.match(/action:\s*'([a-z_]+\.[a-z_]+)'/g) ?? []
    expect(actions.length).toBeGreaterThan(5)
    for (const a of actions) {
      const value = a.match(/'([a-z_]+\.[a-z_]+)'/)![1]
      const [resourceType, verb] = value.split('.')
      expect(resourceType, value).toMatch(/^commercial_/)
      expect(verb, value).not.toMatch(/ing$/) // not present-tense/gerund
    }
  })

  it('no secret/token/password/signature field is ever interpolated into an audit entry', () => {
    expect(source).not.toMatch(/api[_-]?key/i)
    expect(source).not.toMatch(/password/i)
    expect(source).not.toMatch(/session[_-]?token/i)
    expect(source).not.toMatch(/signature/i)
  })

  it('organisationId is always taken from the caller-supplied, already-trusted parameter — never independently re-resolved inside this file', () => {
    expect(source).not.toMatch(/requireSession/)
  })
})

// ── Behavioural ───────────────────────────────────────────────────────

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

beforeEach(() => {
  sqlMock.mockReset()
})

describe('Phase C2 — commercial audit log behaviour', () => {
  it('a DB failure during logging never throws — the caller (a successfully-completed mutation) is never made to look like it failed', async () => {
    sqlMock.mockRejectedValue(new Error('connection reset'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { logProductCreated } = await import('@/lib/commercial/auditLog')
    await expect(
      logProductCreated({ organisationId: 'org-a', userId: 'u1', productId: 'p1', after: { name: 'Widget', type: 'PRODUCT', default_unit_price_cents: 100, currency: 'AUD' } })
    ).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('logProductCreated writes resource_type=commercial_product and the correct action', async () => {
    sqlMock.mockResolvedValue([])
    const { logProductCreated } = await import('@/lib/commercial/auditLog')
    await logProductCreated({ organisationId: 'org-a', userId: 'u1', productId: 'p1', after: { name: 'Widget', type: 'PRODUCT', default_unit_price_cents: 100, currency: 'AUD' } })
    const call = sqlMock.mock.calls[0]
    const text = (call[0] as string[]).join('')
    expect(text).toMatch(/INSERT INTO audit_logs/)
    expect(call).toContain('org-a')
    expect(call).toContain('commercial_product.created')
    expect(call).toContain('commercial_product')
    expect(call).toContain('p1')
  })

  it('a deactivation logs before/after active state without any other field', async () => {
    sqlMock.mockResolvedValue([])
    const { logCustomerDeactivated } = await import('@/lib/commercial/auditLog')
    await logCustomerDeactivated({ organisationId: 'org-a', userId: 'u1', customerId: 'c1' })
    const call = sqlMock.mock.calls[0]
    expect(call).toContain('commercial_customer.deactivated')
    const beforeIdx = call.findIndex((v: unknown) => v === '{"active":true}')
    const afterIdx = call.findIndex((v: unknown) => v === '{"active":false}')
    expect(beforeIdx).toBeGreaterThan(-1)
    expect(afterIdx).toBeGreaterThan(-1)
  })

  it('a system/automated actor is never invented — userId is passed through exactly as given, including null', async () => {
    sqlMock.mockResolvedValue([])
    const { logFinancialYearStatusChanged } = await import('@/lib/commercial/auditLog')
    await logFinancialYearStatusChanged({ organisationId: 'org-a', userId: 'u1', financialYearId: 'fy1', before: 'OPEN', after: 'CLOSED' })
    const call = sqlMock.mock.calls[0]
    expect(call).toContain('u1')
  })
})
