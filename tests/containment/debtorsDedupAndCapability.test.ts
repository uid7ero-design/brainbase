import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  computeDebtorKpi,
  accountResolutionRate,
  avgDebtorPriority,
  highRiskDebtorCount,
  debtorPriorityScore,
  HIGH_RISK_PRIORITY_THRESHOLD,
} from '@/modules/debtors/calculations'

// Phase C1.1 — Debtors deduplication + entitlement enforcement.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('Phase C1.1 — import uses upsert, not createMany+skipDuplicates', () => {
  const source = readSource('modules/debtors/index.ts')

  it('no longer calls createMany/skipDuplicates', () => {
    const code = stripComments(source)
    expect(code).not.toMatch(/createMany/)
    expect(code).not.toMatch(/skipDuplicates/)
  })

  it('upserts keyed on the (organisation_id, account_number) compound unique field, inside a transaction', () => {
    expect(source).toMatch(/prisma\.\$transaction\(/)
    expect(source).toMatch(/\.upsert\(/)
    expect(source).toMatch(/organisation_id_account_number/)
  })

  it('skips rows with no account_number rather than importing an unreconcilable duplicate-prone row', () => {
    expect(source).toMatch(/account_number\s*!==\s*""/)
  })
})

describe('Phase C1.1 — prisma/schema.prisma declares the natural key', () => {
  it('DebtorAccount has @@unique([organisation_id, account_number])', () => {
    const schema = readSource('prisma/schema.prisma')
    const modelStart = schema.indexOf('model DebtorAccount {')
    const modelEnd = schema.indexOf('\n}', modelStart)
    const model = schema.slice(modelStart, modelEnd)
    expect(model).toMatch(/@@unique\(\[organisation_id,\s*account_number\]/)
  })
})

describe('Phase C1.1 — migration script is prepared, not executed', () => {
  it('scripts/add-debtor-accounts-dedup.ts exists and creates the unique index idempotently', () => {
    const migration = readSource('scripts/add-debtor-accounts-dedup.ts')
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/)
    expect(migration).toMatch(/organisation_id_account_number/)
    // Preflight counts before any DELETE, per this repo's DB-safety convention.
    expect(migration).toMatch(/Preflight/)
  })
})

describe('Phase C1.1 — Debtors capability registration + enforcement', () => {
  it('scripts/seed-debtors-capability.sql registers exactly the debtors key, idempotently, granting nothing by itself', () => {
    const seed = readSource('scripts/seed-debtors-capability.sql')
    expect(seed).toMatch(/INSERT INTO modules \(key, name, description, active\) VALUES/)
    expect(seed).toMatch(/'debtors'/)
    expect(seed).toMatch(/ON CONFLICT \(key\) DO NOTHING/)
    expect(seed).not.toMatch(/INSERT INTO organisation_modules/)
  })

  it('lib/debtors/authorize.ts composes requireSession -> requireCapability(\'debtors\') -> role floor, matching the organiser/events pattern', () => {
    const authorize = readSource('lib/debtors/authorize.ts')
    expect(authorize).toMatch(/await requireSession\(\)/)
    expect(authorize).toMatch(/requireCapability\(session\.organisationId, 'debtors'\)/)
    expect(authorize).toMatch(/CapabilityDatabaseError/)
    expect(authorize).toMatch(/roleGte\(session\.role, minRole\)/)
  })

  it('app/api/debtors/kpi/route.ts is gated by authorizeDebtorsRequest, not a bare session check', () => {
    const route = readSource('app/api/debtors/kpi/route.ts')
    const code = stripComments(route)
    expect(route).toMatch(/authorizeDebtorsRequest\('viewer'\)/)
    expect(code).not.toMatch(/getAuthSession/)
  })
})

describe('Phase C1.1 — KPI formula reconciliation (centralised, not merged, behaviour preserved)', () => {
  const rows = [
    { outstanding_amount: 1000, days_overdue: 45, aging_bucket: 'DAYS_30', status: 'OPEN', original_amount: 2000 },
    { outstanding_amount: 500, days_overdue: 95, aging_bucket: 'DAYS_90_PLUS', status: 'PAYMENT_PLAN', original_amount: 800 },
    { outstanding_amount: 200, days_overdue: 10, aging_bucket: 'CURRENT', status: 'RESOLVED', original_amount: null },
  ]

  it('accountResolutionRate matches the original inline formula exactly: % of accounts not status OPEN', () => {
    // Original: debtors.filter(d => d.status !== 'OPEN').length / debtors.length * 100, rounded
    const expected = Math.round((2 / 3) * 100)
    expect(accountResolutionRate(rows)).toBe(expected)
  })

  it('debtorPriorityScore / avgDebtorPriority match the original inline formula exactly: outstanding*10 + days_overdue*5', () => {
    expect(debtorPriorityScore(rows[0])).toBe(1000 * 10 + 45 * 5)
    const expectedAvg = Math.round(
      rows.reduce((s, r) => s + (r.outstanding_amount * 10 + r.days_overdue * 5), 0) / rows.length
    )
    expect(avgDebtorPriority(rows)).toBe(expectedAvg)
  })

  it('highRiskDebtorCount matches the original inline formula exactly: priority > 8000, threshold unchanged at 8000', () => {
    expect(HIGH_RISK_PRIORITY_THRESHOLD).toBe(8000)
    // row 0: 1000*10+45*5=10225 > 8000 (high risk); row 1: 5000+475=5475 (not); row 2: 2000+50=2050 (not)
    expect(highRiskDebtorCount(rows)).toBe(1)
  })

  it("accountResolutionRate (count-based) and computeDebtorKpi's recovery_rate (amount-based) are NOT the same value for the same data — confirms they are genuinely different metrics, not duplicate implementations of one concept", () => {
    const kpi = computeDebtorKpi(rows as never)
    expect(accountResolutionRate(rows)).not.toBe(kpi.recovery_rate)
  })

  it('empty input fails closed to zero for every centralised function, never throws', () => {
    expect(() => accountResolutionRate([])).not.toThrow()
    expect(accountResolutionRate([])).toBe(0)
    expect(avgDebtorPriority([])).toBe(0)
    expect(highRiskDebtorCount([])).toBe(0)
  })
})
