import { NextResponse } from 'next/server';
import { authorizeDebtorsRequest } from '@/lib/debtors/authorize';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  accountLevelResolutionRate,
  avgAccountPriority,
  avgOpenAccountDaysOverdue,
  highRiskAccountCount,
  accountResolutionState,
  type DebtorAccountRollup,
} from '@/modules/debtors/calculations';

// Phase C1-DBR2 — corrects this route to account-level semantics.
// `debtor_accounts` is charge-line-grain data (Phase C1-DBR/C1-DBD/
// C1-DBS/C1-DBF): the same (organisation_id, account_number) legitimately
// has many rows. This route previously read raw debtor_accounts rows
// directly — every metric below was, without anyone deciding it should
// be, actually a charge-line metric mislabelled as an account metric.
// It now reads scripts/create-debtor-account-summary-view.sql's
// debtor_account_summary view instead — one row per real account,
// already aggregated across every charge line, always organisation-
// scoped by this route's own WHERE clause (the view itself is NOT
// pre-filtered by organisation — every caller must scope it, matching
// this codebase's existing per-route tenant-isolation discipline).
export async function GET(req: Request) {
  const auth = await authorizeDebtorsRequest('viewer');
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const orgId = session.organisationId;
  // Phase C1-DBR2 §18: `fy` remains accepted and echoed back, but is
  // deliberately NOT applied to any headline metric below — every figure
  // in this response is all-financial-years by construction (the view
  // itself has no financial_year filter anywhere). An account's old,
  // still-unpaid charge from an earlier financial year must never
  // disappear from `totalOutstanding` just because a more recent FY is
  // selected — full period-specific breakdown filtering remains a later,
  // separate phase.
  const fy    = new URL(req.url).searchParams.get('fy') ?? '2025-26';
  const now   = new Date();

  const accounts = await prisma.$queryRaw<DebtorAccountRollup[]>(Prisma.sql`
    SELECT * FROM debtor_account_summary WHERE organisation_id = ${orgId}
  `);

  if (accounts.length === 0) {
    return NextResponse.json({
      data: { totalOutstanding: 0, count: 0, avgDaysOverdue: 0, avgPriority: 0, recoveryRate: 0, highRiskCount: 0, topDebtors: [] },
      fetched_at: now.toISOString(), fy, org_id: orgId,
    });
  }

  // totalOutstanding — OLD: SUM(outstanding_amount) over every raw row,
  // unfiltered by status (mathematically invalid under the charge-line
  // model — summed resolved AND open charges together). NEW:
  // SUM(current_outstanding) over accounts, where current_outstanding
  // itself is already OPEN-only and all-FY (view-level definition) — no
  // resolved charge line, and no FY scoping, ever contributes here.
  const totalOutstanding = accounts.reduce((s, a) => s + Number(a.current_outstanding), 0);

  // count — OLD: raw charge-line row count (32,493 in rehearsal data).
  // NEW: real distinct account count (14,383 in rehearsal data) — this
  // was the single largest distortion found: the old figure overstated
  // "how many debtors" by every extra charge line each account had.
  const count = accounts.length;

  // avgDaysOverdue — OLD: average of every row's frozen, ingest-time-
  // computed days_overdue, across ALL rows including resolved ones (a
  // resolved charge's days_overdue is never updated after ingest, so it
  // silently drags the average toward stale, irrelevant values). NEW:
  // average of current_days_overdue (recomputed live from
  // oldest_open_invoice_date, not stored/frozen), over accounts that
  // currently have open debt ONLY — a fully resolved account is
  // EXCLUDED, not counted as 0 (see avgOpenAccountDaysOverdue's own
  // comment for why exclusion, not zero, was chosen).
  const avgDaysOverdue = avgOpenAccountDaysOverdue(accounts);

  // avgPriority — OLD: the same outstanding*10+days_overdue*5 heuristic
  // averaged per CHARGE LINE, so an account with many small charges never
  // scored as risky even if its combined balance was large. NEW: the
  // identical formula applied ONCE per account, to its aggregated
  // current_outstanding/current_days_overdue — an account is scored by
  // its real combined exposure, not diluted across its charge lines.
  const avgPriority = avgAccountPriority(accounts);

  // recoveryRate — OLD: % of RAW ROWS with status !== 'OPEN' (a
  // charge-line count, already known (Phase C1.1) to be a different
  // concept from computeDebtorKpi()'s own amount-based recovery_rate —
  // that distinction is preserved, not touched, by this change). NEW: %
  // of ACCOUNTS with zero open charge lines (accountLevelResolutionRate)
  // — an account with 5 resolved charges and 1 still-open charge no
  // longer counts as "mostly resolved"; it is OPEN, full stop, matching
  // accountResolutionState()'s own two-state model (§6: no invented
  // collections-policy states).
  const recoveryRate = accountLevelResolutionRate(accounts);

  // highRiskCount — OLD: charge-line rows individually never crossed the
  // risk threshold (a single quarter's bin charge is rarely large enough
  // on its own) — 0 of 32,493 rows in rehearsal data. NEW: accounts
  // scored on their combined current exposure — 109 accounts in
  // rehearsal data, a real, previously entirely invisible signal the
  // charge-line-level metric was structurally incapable of surfacing.
  const highRiskCount = highRiskAccountCount(accounts);

  // topDebtors — OLD: up to 10 individual charge-line rows, so the same
  // account could appear multiple times and a large account's true
  // exposure was split across several entries. NEW: one entry per
  // account (the view's own grain), sorted by current_outstanding
  // descending. `id` is now account_number itself — there is no
  // synthetic per-row id for an aggregate; account_number is already the
  // real, stable identifier for this row. `status` is the two-state
  // accountResolutionState() derivation, matching the UI's existing
  // OPEN/non-OPEN colour logic exactly (app/command/page.tsx compares
  // status === 'OPEN' only, so any other string — 'RESOLVED' — renders
  // identically to before).
  const topDebtors = [...accounts]
    .sort((a, b) => Number(b.current_outstanding) - Number(a.current_outstanding))
    .slice(0, 10)
    .map(a => ({
      id:          a.account_number,
      account:     a.account_name,
      amount:      Number(a.current_outstanding),
      daysOverdue: a.current_days_overdue ?? 0,
      status:      accountResolutionState(a) === 'OPEN_ACCOUNT' ? 'OPEN' : 'RESOLVED',
    }));

  return NextResponse.json({
    data: {
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      count,
      avgDaysOverdue,
      avgPriority,
      recoveryRate,
      highRiskCount,
      topDebtors,
    },
    fetched_at: now.toISOString(), fy, org_id: orgId,
  });
}
