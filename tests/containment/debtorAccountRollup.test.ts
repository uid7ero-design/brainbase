import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  accountResolutionState,
  accountLevelResolutionRate,
  accountPriorityScore,
  avgAccountPriority,
  highRiskAccountCount,
  avgOpenAccountDaysOverdue,
  HIGH_RISK_PRIORITY_THRESHOLD,
  type DebtorAccountRollup,
} from '@/modules/debtors/calculations'

// Phase C1-DBR2 — Debtors account-level rollup + KPI correction. Real
// rehearsal-data investigation (Phase C1-DBR/C1-DBD/C1-DBS/C1-DBF)
// established debtor_accounts is charge-line-grain data — the same
// account legitimately has many rows. This suite tests the new
// account-level rollup (scripts/create-debtor-account-summary-view.sql)
// and the corrected app/api/debtors/kpi/route.ts. Synthetic fixtures
// only — no customer data.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

function account(overrides: Partial<DebtorAccountRollup> = {}): DebtorAccountRollup {
  return {
    organisation_id: 'org-a',
    account_number: '000001',
    account_name: 'Test Account',
    current_outstanding: 0,
    total_original_charges: 0,
    open_charge_count: 0,
    resolved_charge_count: 1,
    total_charge_count: 1,
    oldest_open_invoice_date: null,
    current_days_overdue: null,
    current_aging_bucket: null,
    latest_charge_invoice_date: new Date('2025-01-01'),
    first_charge_financial_year: '2024-25',
    latest_charge_financial_year: '2024-25',
    distinct_charge_type_count: 1,
    ...overrides,
  }
}

describe('Phase C1-DBR2 — debtor_account_summary view SQL (static containment)', () => {
  const source = stripComments(readSource('scripts/create-debtor-account-summary-view.sql'))

  it('aggregates at (organisation_id, account_number) grain', () => {
    expect(source).toMatch(/GROUP BY organisation_id, account_number/)
  })

  it('current_outstanding sums outstanding_amount restricted to OPEN status only, with no financial_year condition anywhere near it', () => {
    const idx = source.indexOf('current_outstanding')
    const clause = source.slice(source.indexOf('SUM(outstanding_amount)'), idx + 30)
    expect(clause).toMatch(/FILTER\s*\(WHERE status = 'OPEN'\)/)
    expect(clause).not.toMatch(/financial_year/)
  })

  it('total_original_charges sums original_amount across ALL charge lines, unconditionally (historical volume, not current debt)', () => {
    const clause = source.slice(source.indexOf('SUM(original_amount)'), source.indexOf('SUM(original_amount)') + 60)
    expect(clause).not.toMatch(/FILTER/)
  })

  it('oldest_open_invoice_date is MIN(invoice_date) restricted to OPEN status', () => {
    expect(source).toMatch(/MIN\(invoice_date\)\s*FILTER\s*\(WHERE status = 'OPEN'\)/)
  })

  it('current_days_overdue/current_aging_bucket are computed from CURRENT_DATE at query time, never from any stored days_overdue/aging_bucket column', () => {
    expect(source).toMatch(/CURRENT_DATE/)
    // The two frozen, row-level columns must not appear anywhere in this file.
    expect(source).not.toMatch(/\bdays_overdue\b/)
    expect(source).not.toMatch(/\baging_bucket\b/)
  })

  it('current_aging_bucket thresholds match modules/debtors/calculations.ts agingBucketFromDays exactly (<=0, <=30, <=60, <=90)', () => {
    expect(source).toMatch(/<=\s*0\s*THEN 'CURRENT'/)
    expect(source).toMatch(/<=\s*30\s*THEN 'DAYS_30'/)
    expect(source).toMatch(/<=\s*60\s*THEN 'DAYS_60'/)
    expect(source).toMatch(/<=\s*90\s*THEN 'DAYS_90'/)
    expect(source).toMatch(/ELSE 'DAYS_90_PLUS'/)
  })

  it('a fully resolved account (no open charge lines) gets NULL current_days_overdue/current_aging_bucket, not 0/CURRENT', () => {
    expect(source).toMatch(/WHEN oldest_open_invoice_date IS NULL THEN NULL/)
  })

  it('never creates a unique constraint or index (view remains detection-only, per approved policy)', () => {
    expect(source).not.toMatch(/CREATE\s+UNIQUE/i)
  })

  it('never deletes, updates, or excludes any row — no DELETE, no DISTINCT ON, no row_number()-based "winning row" selection', () => {
    expect(source).not.toMatch(/DELETE/i)
    expect(source).not.toMatch(/DISTINCT ON/i)
    expect(source).not.toMatch(/ROW_NUMBER\(\)/i)
    expect(source).not.toMatch(/UPDATE\s+debtor_accounts/i)
  })

  it('is idempotent (CREATE OR REPLACE VIEW, never a bare CREATE VIEW or DROP+CREATE)', () => {
    expect(source).toMatch(/CREATE OR REPLACE VIEW debtor_account_summary/)
    expect(source).not.toMatch(/DROP VIEW/i)
  })

  it('every required rollup field is present in the SELECT list', () => {
    for (const field of [
      'organisation_id', 'account_number', 'account_name', 'current_outstanding',
      'total_original_charges', 'open_charge_count', 'resolved_charge_count', 'total_charge_count',
      'oldest_open_invoice_date', 'current_days_overdue', 'current_aging_bucket',
      'latest_charge_invoice_date', 'first_charge_financial_year', 'latest_charge_financial_year',
      'distinct_charge_type_count',
    ]) {
      expect(source, `missing field ${field}`).toMatch(new RegExp(`\\b${field}\\b`))
    }
  })

  it('does not filter out any organisation — every caller must scope it themselves (documented, not enforced by the view)', () => {
    expect(source).not.toMatch(/WHERE\s+organisation_id\s*=/)
  })
})

describe('Phase C1-DBR2 — accountResolutionState (§6, no invented collections-policy states)', () => {
  it('an account with at least one open charge line is OPEN_ACCOUNT', () => {
    expect(accountResolutionState(account({ open_charge_count: 1 }))).toBe('OPEN_ACCOUNT')
    expect(accountResolutionState(account({ open_charge_count: 3 }))).toBe('OPEN_ACCOUNT')
  })
  it('an account with zero open charge lines is FULLY_RESOLVED_ACCOUNT', () => {
    expect(accountResolutionState(account({ open_charge_count: 0 }))).toBe('FULLY_RESOLVED_ACCOUNT')
  })
})

describe('Phase C1-DBR2 — accountLevelResolutionRate', () => {
  it('fully resolved accounts / all accounts with charge history * 100', () => {
    const accounts = [
      account({ open_charge_count: 0 }), // resolved
      account({ open_charge_count: 0 }), // resolved
      account({ open_charge_count: 2 }), // open
      account({ open_charge_count: 1 }), // open
    ]
    expect(accountLevelResolutionRate(accounts)).toBe(50)
  })
  it('empty input fails closed to 0', () => {
    expect(accountLevelResolutionRate([])).toBe(0)
  })
})

describe('Phase C1-DBR2 — account-level priority/high-risk (an account with multiple charge lines is scored ONCE, on its aggregated total, never per line)', () => {
  it('accountPriorityScore uses the SAME formula shape as the charge-line version (outstanding*10 + days_overdue*5), applied to the aggregated total', () => {
    const a = account({ current_outstanding: 1000, current_days_overdue: 45 })
    expect(accountPriorityScore(a)).toBe(1000 * 10 + 45 * 5)
  })
  it('a fully resolved account (current_days_overdue null) scores using 0, not NaN/throwing', () => {
    const a = account({ current_outstanding: 0, current_days_overdue: null })
    expect(accountPriorityScore(a)).toBe(0)
  })
  it('an account whose current_outstanding is the SUM of several open charge lines is counted as exactly ONE high-risk account, not once per underlying line', () => {
    // Simulates 3 charge lines of $3,000 each (well below the threshold
    // individually) that have already been aggregated by the view into
    // one account row with current_outstanding = 9000.
    const bigAccount = account({ current_outstanding: 9000, current_days_overdue: 10, open_charge_count: 3 })
    const smallAccounts = [
      account({ current_outstanding: 100, current_days_overdue: 5, open_charge_count: 1 }),
      account({ current_outstanding: 100, current_days_overdue: 5, open_charge_count: 1 }),
    ]
    const all = [bigAccount, ...smallAccounts]
    expect(HIGH_RISK_PRIORITY_THRESHOLD).toBe(8000)
    expect(highRiskAccountCount(all)).toBe(1)
  })
  it('avgAccountPriority averages over accounts, not charge lines', () => {
    const accounts = [
      account({ current_outstanding: 1000, current_days_overdue: 10 }),
      account({ current_outstanding: 2000, current_days_overdue: 20 }),
    ]
    const expected = Math.round(((1000 * 10 + 10 * 5) + (2000 * 10 + 20 * 5)) / 2)
    expect(avgAccountPriority(accounts)).toBe(expected)
  })
})

describe('Phase C1-DBR2 — avgOpenAccountDaysOverdue (resolved accounts EXCLUDED, not counted as 0)', () => {
  it('averages only over accounts with open_charge_count > 0 and a non-null current_days_overdue', () => {
    const accounts = [
      account({ open_charge_count: 1, current_days_overdue: 100 }),
      account({ open_charge_count: 2, current_days_overdue: 50 }),
      account({ open_charge_count: 0, current_days_overdue: null }), // resolved — must not pull the average toward 0
    ]
    expect(avgOpenAccountDaysOverdue(accounts)).toBe(Math.round((100 + 50) / 2))
  })
  it('empty/all-resolved input fails closed to 0, never throws', () => {
    expect(avgOpenAccountDaysOverdue([])).toBe(0)
    expect(avgOpenAccountDaysOverdue([account({ open_charge_count: 0, current_days_overdue: null })])).toBe(0)
  })
})

// ── Route-level behavioural tests ──────────────────────────────────────

const authorizeMock = vi.fn()
vi.mock('@/lib/debtors/authorize', () => ({
  authorizeDebtorsRequest: (...args: unknown[]) => authorizeMock(...args),
}))

const queryRawMock = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
}))

const SESSION = { userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'Ada' }

function rollupRow(overrides: Partial<DebtorAccountRollup> = {}): DebtorAccountRollup {
  return account(overrides)
}

beforeEach(() => {
  authorizeMock.mockReset()
  queryRawMock.mockReset()
  authorizeMock.mockResolvedValue({ ok: true, session: SESSION })
})

describe('Phase C1-DBR2 — app/api/debtors/kpi/route.ts (behavioural)', () => {
  it('queries debtor_account_summary scoped to the caller organisation', async () => {
    queryRawMock.mockResolvedValue([])
    const { GET } = await import('@/app/api/debtors/kpi/route')
    await GET(new Request('http://localhost/api/debtors/kpi'))
    expect(queryRawMock).toHaveBeenCalledTimes(1)
    const callArg = queryRawMock.mock.calls[0][0]
    const text = Array.isArray(callArg?.strings) ? callArg.strings.join('') : String(callArg)
    expect(text).toMatch(/FROM debtor_account_summary/)
    expect(text).toMatch(/WHERE organisation_id/)
    expect(text).not.toMatch(/financial_year/)
  })

  it('count reflects the number of account rows returned, not any charge-line concept', async () => {
    queryRawMock.mockResolvedValue([rollupRow({ account_number: 'a' }), rollupRow({ account_number: 'b' }), rollupRow({ account_number: 'c' })])
    const { GET } = await import('@/app/api/debtors/kpi/route')
    const res = await GET(new Request('http://localhost/api/debtors/kpi'))
    const body = await res.json()
    expect(body.data.count).toBe(3)
  })

  it('totalOutstanding sums current_outstanding across accounts, and old unpaid OPEN charges from an EARLIER financial year still count regardless of the fy query param', async () => {
    queryRawMock.mockResolvedValue([
      rollupRow({ account_number: 'old-debt', current_outstanding: 500, open_charge_count: 1, first_charge_financial_year: '2022-23', latest_charge_financial_year: '2022-23' }),
      rollupRow({ account_number: 'new-debt', current_outstanding: 300, open_charge_count: 1, first_charge_financial_year: '2025-26', latest_charge_financial_year: '2025-26' }),
    ])
    const { GET } = await import('@/app/api/debtors/kpi/route')
    // Selecting a recent FY must not hide the old account's still-open debt.
    const res = await GET(new Request('http://localhost/api/debtors/kpi?fy=2025-26'))
    const body = await res.json()
    expect(body.data.totalOutstanding).toBe(800)
    expect(body.fy).toBe('2025-26') // echoed back, never used to filter
  })

  it('topDebtors returns exactly one entry per account (never multiple entries for the same account_number), sorted by current_outstanding descending, max 10', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => rollupRow({ account_number: `acct-${i}`, current_outstanding: i * 100 }))
    queryRawMock.mockResolvedValue(rows)
    const { GET } = await import('@/app/api/debtors/kpi/route')
    const res = await GET(new Request('http://localhost/api/debtors/kpi'))
    const body = await res.json()
    expect(body.data.topDebtors.length).toBe(10)
    const accountNumbers = body.data.topDebtors.map((d: { id: string }) => d.id)
    expect(new Set(accountNumbers).size).toBe(accountNumbers.length) // all unique
    expect(body.data.topDebtors[0].amount).toBe(1400) // highest first
    expect(body.data.topDebtors[9].amount).toBe(500)
  })

  it('topDebtors id is the account_number (no synthetic per-row id exists for an aggregate)', async () => {
    queryRawMock.mockResolvedValue([rollupRow({ account_number: '000123', current_outstanding: 50 })])
    const { GET } = await import('@/app/api/debtors/kpi/route')
    const res = await GET(new Request('http://localhost/api/debtors/kpi'))
    const body = await res.json()
    expect(body.data.topDebtors[0].id).toBe('000123')
  })

  it('topDebtors status is OPEN or RESOLVED, matching the UI\'s existing status === "OPEN" colour comparison exactly', async () => {
    queryRawMock.mockResolvedValue([
      rollupRow({ account_number: 'open', open_charge_count: 1, current_outstanding: 100 }),
      rollupRow({ account_number: 'resolved', open_charge_count: 0, current_outstanding: 0 }),
    ])
    const { GET } = await import('@/app/api/debtors/kpi/route')
    const res = await GET(new Request('http://localhost/api/debtors/kpi'))
    const body = await res.json()
    const statuses = body.data.topDebtors.map((d: { status: string }) => d.status)
    expect(statuses).toContain('OPEN')
    expect(statuses).toContain('RESOLVED')
  })

  it('response shape preserves every existing field name', async () => {
    queryRawMock.mockResolvedValue([rollupRow()])
    const { GET } = await import('@/app/api/debtors/kpi/route')
    const res = await GET(new Request('http://localhost/api/debtors/kpi'))
    const body = await res.json()
    for (const field of ['totalOutstanding', 'count', 'avgDaysOverdue', 'avgPriority', 'recoveryRate', 'highRiskCount', 'topDebtors']) {
      expect(body.data).toHaveProperty(field)
    }
    expect(body).toHaveProperty('fetched_at')
    expect(body).toHaveProperty('fy')
    expect(body).toHaveProperty('org_id')
  })

  it('empty-account organisation returns the same zeroed shape as before', async () => {
    queryRawMock.mockResolvedValue([])
    const { GET } = await import('@/app/api/debtors/kpi/route')
    const res = await GET(new Request('http://localhost/api/debtors/kpi'))
    const body = await res.json()
    expect(body.data).toEqual({ totalOutstanding: 0, count: 0, avgDaysOverdue: 0, avgPriority: 0, recoveryRate: 0, highRiskCount: 0, topDebtors: [] })
  })

  it('is gated by authorizeDebtorsRequest — an unauthorized session never reaches the query', async () => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) })
    const { GET } = await import('@/app/api/debtors/kpi/route')
    const res = await GET(new Request('http://localhost/api/debtors/kpi'))
    expect(res.status).toBe(401)
    expect(queryRawMock).not.toHaveBeenCalled()
  })
})

describe('Phase C1-DBR2 — route source contains no destructive or over-broad operations', () => {
  const source = readSource('app/api/debtors/kpi/route.ts')
  it('no DELETE, no UPDATE, no unique-constraint creation anywhere in the route', () => {
    expect(source).not.toMatch(/DELETE|UPDATE\s+debtor|CREATE\s+UNIQUE/i)
  })
  it('never applies a financial_year filter to the headline query', () => {
    const queryText = source.slice(source.indexOf('prisma.$queryRaw'), source.indexOf('prisma.$queryRaw') + 200)
    expect(queryText).not.toMatch(/financial_year/)
  })
})
