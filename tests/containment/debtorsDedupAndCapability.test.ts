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

// Phase C1.1 introduced an account-level upsert + a prepared unique-
// constraint migration for Debtors, believing (organisation_id,
// account_number) safely identified one row. Phase C1-DBR/C1-DBD/C1-DBS
// (real rehearsal-data investigation) proved this false: a debtor_accounts
// row is a source CHARGE LINE, and the same account legitimately has many
// rows (different financial years/quarters/charge types). Phase C1-DBF
// removed the upsert, the @@unique declaration, and the prepared
// (never-executed) scripts/add-debtor-accounts-dedup.ts migration — see
// modules/debtors/index.ts's own header comment for the full reasoning.
// This suite now tests the CORRECTED append-only behaviour and the
// removal itself, rather than the superseded upsert/unique assumptions.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('Phase C1-DBF — import appends charge lines, never upserts/merges on account_number', () => {
  const source = readSource('modules/debtors/index.ts')
  const code = stripComments(source)

  it('no longer upserts, and no longer references the removed compound-key field', () => {
    expect(code).not.toMatch(/\.upsert\(/)
    expect(code).not.toMatch(/organisation_id_account_number/)
  })

  it('uses a plain createMany (no skipDuplicates — that flag implied a guarantee that no longer even has a constraint to no-op against)', () => {
    expect(code).toMatch(/prisma\.debtorAccount\.createMany\(\{\s*data:\s*records\s*\}\)/)
    expect(code).not.toMatch(/skipDuplicates/)
  })

  it('two charge lines sharing the same organisation_id and account_number are never collapsed — createMany has no where-keyed row-matching semantics at all, unlike the removed upsert', () => {
    // Static proof the removal is structural, not just a renamed call:
    // there is no `where:` clause anywhere near the insert, which an
    // upsert/update-on-conflict path would require.
    const insertRegion = code.slice(code.indexOf('createMany'), code.indexOf('createMany') + 60)
    expect(insertRegion).not.toMatch(/where/)
  })

  it('skips rows with no account_number (unrelated to the C1.1/C1-DBF correction — a row with no account cannot be attributed to any account regardless of duplicate policy)', () => {
    expect(source).toMatch(/account_number\s*!==\s*""/)
  })

  it('rows are never silently discarded solely because account_number repeats — filtering only excludes blank account_number, nothing else', () => {
    // The only `.filter(` call in the whole file is the blank-account-number
    // one asserted above; there is no second filter keyed on account_number
    // duplication.
    const filterCalls = code.match(/\.filter\(/g) ?? []
    expect(filterCalls.length).toBe(1)
  })

  it('performs a non-blocking repeated-import risk check using Upload.original_name, and stamps metadata rather than rejecting/blocking the import', () => {
    expect(code).toMatch(/checkRepeatedImportRisk/)
    expect(code).toMatch(/original_name:\s*current\.original_name/)
    expect(code).toMatch(/duplicate_import_risk:\s*true/)
    // Never throws/returns early on a detected repeat — it only warns and tags.
    const fnStart = code.indexOf('async function checkRepeatedImportRisk')
    const fnBody = code.slice(fnStart, code.indexOf('\n}', fnStart))
    expect(fnBody).not.toMatch(/throw\b/)
  })

  it('the repeated-import check never blocks, deletes, or merges — importDebtors always proceeds to createMany regardless of isRepeat', () => {
    const runIdx = code.indexOf('async function importDebtors')
    const body = code.slice(runIdx)
    expect(body).not.toMatch(/if\s*\(\s*isRepeat\s*\)\s*(return|throw)/)
    expect(body).not.toMatch(/DELETE|deleteMany/)
    expect(body).not.toMatch(/\.upsert\(|\.update\(/)
  })
})

describe('Phase C1-DBF — prisma/schema.prisma no longer declares the false unique constraint', () => {
  const schema = readSource('prisma/schema.prisma')
  const modelStart = schema.indexOf('model DebtorAccount {')
  const modelEnd = schema.indexOf('\n}', schema.indexOf('@@index([organisation_id]', modelStart))
  const model = schema.slice(modelStart, modelEnd)

  it('no @@unique directive exists anywhere in the DebtorAccount model', () => {
    const directiveLines = model.match(/^\s*@@unique\(/gm) ?? []
    expect(directiveLines.length).toBe(0)
  })

  it('the six charge-line typed columns from Phase C1-DBS2 remain present and untouched', () => {
    expect(model).toMatch(/financial_year\s+String\?/)
    expect(model).toMatch(/financial_quarter\s+String\?/)
    expect(model).toMatch(/charge_type\s+String\?/)
    expect(model).toMatch(/invoice_date\s+DateTime\?/)
    expect(model).toMatch(/source_book\s+String\?/)
    expect(model).toMatch(/source_charge_code\s+String\?/)
  })

  it('the plain (organisation_id) index remains — this is a non-unique lookup index, not a uniqueness guarantee', () => {
    expect(model).toMatch(/@@index\(\[organisation_id\]\)/)
  })
})

describe('Phase C1-DBF — the retired dedup migration no longer exists', () => {
  it('scripts/add-debtor-accounts-dedup.ts has been removed from the repository', () => {
    const migrationPath = path.resolve(__dirname, '../../scripts/add-debtor-accounts-dedup.ts')
    expect(fs.existsSync(migrationPath)).toBe(false)
  })

  it('no remaining source file executes CREATE UNIQUE INDEX or DELETE against debtor_accounts keyed by account_number grouping', () => {
    const scriptsDir = path.resolve(__dirname, '../../scripts')
    const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.ts') || f.endsWith('.sql'))
    for (const f of files) {
      const content = fs.readFileSync(path.join(scriptsDir, f), 'utf-8')
      const code = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '')
      if (/debtor_accounts/.test(code)) {
        expect(code, `${f} must not create a unique index on debtor_accounts`).not.toMatch(/CREATE\s+UNIQUE\s+INDEX[\s\S]{0,120}debtor_accounts|debtor_accounts[\s\S]{0,120}CREATE\s+UNIQUE\s+INDEX/i)
        expect(code, `${f} must not DELETE from debtor_accounts grouped by account_number`).not.toMatch(/DELETE\s+FROM\s+debtor_accounts[\s\S]*?GROUP BY[\s\S]*?account_number/i)
      }
    }
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
