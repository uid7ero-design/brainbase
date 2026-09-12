import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// C6.9 TEMPORARY diagnostic route — proves it fails closed outside
// Preview (before any DB call), and that Preview returns exactly the
// allowed field set with no secret/connection-string/row-content leakage.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args) }))

const { GET } = await import('@/app/api/health/db-identity/route')

const ORIGINAL_ENV = { ...process.env }
afterEach(() => { process.env = { ...ORIGINAL_ENV } })

beforeEach(() => {
  sqlMock.mockReset()
})

describe('GET /api/health/db-identity — fails closed outside Preview', () => {
  it('returns 404 and never queries the database when VERCEL_ENV is "production"', async () => {
    process.env.VERCEL_ENV = 'production'
    const res = await GET()
    expect(res.status).toBe(404)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 404 and never queries the database when VERCEL_ENV is undefined (e.g. local dev)', async () => {
    delete process.env.VERCEL_ENV
    const res = await GET()
    expect(res.status).toBe(404)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 404 and never queries the database for any non-"preview" value', async () => {
    process.env.VERCEL_ENV = 'development'
    const res = await GET()
    expect(res.status).toBe(404)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('the VERCEL_ENV check happens before the sql import is ever invoked in this request', async () => {
    process.env.VERCEL_ENV = 'production'
    await GET()
    await GET()
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/health/db-identity — Preview: exact allowed field set only', () => {
  it('returns exactly the seven allowed fields with correct types, nothing else', async () => {
    process.env.VERCEL_ENV = 'preview'
    sqlMock.mockResolvedValueOnce([{
      current_database: 'neondb',
      current_user: 'neondb_owner',
      organisation_count: '1',
      user_count: '1',
      c69_test_org_exists: true,
      c69admin_exists: true,
      purchase_order_count: '0',
    }])

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(Object.keys(body).sort()).toEqual([
      'c69_test_org_exists',
      'c69admin_exists',
      'current_database',
      'current_user',
      'organisation_count',
      'purchase_order_count',
      'user_count',
    ].sort())

    expect(body).toEqual({
      current_database: 'neondb',
      current_user: 'neondb_owner',
      organisation_count: 1,
      user_count: 1,
      c69_test_org_exists: true,
      c69admin_exists: true,
      purchase_order_count: 0,
    })
  })

  it('coerces count fields to real numbers (never a driver-returned string leaking through)', async () => {
    process.env.VERCEL_ENV = 'preview'
    sqlMock.mockResolvedValueOnce([{
      current_database: 'neondb', current_user: 'neondb_owner',
      organisation_count: '4', user_count: '6',
      c69_test_org_exists: false, c69admin_exists: false,
      purchase_order_count: '2',
    }])
    const res = await GET()
    const body = await res.json()
    expect(typeof body.organisation_count).toBe('number')
    expect(typeof body.user_count).toBe('number')
    expect(typeof body.purchase_order_count).toBe('number')
  })
})

describe('source containment — read-only, no secret exposure, fail-closed ordering', () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), 'app/api/health/db-identity/route.ts'), 'utf8')

  it('the VERCEL_ENV guard appears before the sql query in source order', () => {
    const guardIdx = SRC.indexOf("VERCEL_ENV !== 'preview'")
    const queryIdx = SRC.indexOf('SELECT')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(queryIdx).toBeGreaterThan(guardIdx)
  })

  it('contains only a SELECT — no INSERT/UPDATE/DELETE/DDL anywhere', () => {
    expect(SRC).not.toMatch(/\bINSERT\b/i)
    expect(SRC).not.toMatch(/\bUPDATE\b/i)
    expect(SRC).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(SRC).not.toMatch(/\bDROP\b|\bALTER\b|\bCREATE\b/i)
  })

  it('never READS process.env.DATABASE_URL or any connection-string/password value (comments may name DATABASE_URL in prose explaining the guarantee — only actual code access is disallowed)', () => {
    const codeOnly = SRC
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n')
    expect(codeOnly).not.toMatch(/process\.env\.DATABASE_URL/)
    expect(codeOnly).not.toMatch(/password/i)
    expect(codeOnly).not.toMatch(/connectionString|connection_string/i)
  })

  it('never selects row contents (name/email/username/etc.) — only counts and booleans', () => {
    expect(SRC).not.toMatch(/SELECT\s+\*/i)
    expect(SRC).not.toContain('.name')
    expect(SRC).not.toContain('.email')
    expect(SRC).not.toContain('.username')
  })
})
