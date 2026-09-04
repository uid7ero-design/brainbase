import type { DebtorKpi } from "@/types/operational";

export interface DebtorRow {
  outstanding_amount: number;
  original_amount?: number | null;
  days_overdue: number;
  aging_bucket: string;
  last_payment_date?: Date | null;
  last_payment_amount?: number | null;
  status: string;
}

export function computeDebtorKpi(rows: DebtorRow[]): DebtorKpi {
  if (rows.length === 0) {
    return { total_outstanding: 0, accounts_count: 0, avg_days_overdue: 0, by_aging_bucket: {}, recovery_rate: 0, at_risk_amount: 0 };
  }
  const total_outstanding = rows.reduce((sum, r) => sum + r.outstanding_amount, 0);
  const avg_days_overdue  = Math.round(rows.reduce((sum, r) => sum + r.days_overdue, 0) / rows.length);

  const by_aging_bucket = rows.reduce<Record<string, { count: number; amount: number }>>((acc, r) => {
    const b = r.aging_bucket ?? "CURRENT";
    if (!acc[b]) acc[b] = { count: 0, amount: 0 };
    acc[b].count++;
    acc[b].amount += r.outstanding_amount;
    return acc;
  }, {});

  // Financial recovery progress: average % of each account's ORIGINAL
  // balance that has been paid down so far (amount-based). This is a
  // distinct concept from accountResolutionRate() below, which measures
  // what fraction of ACCOUNTS have moved off OPEN status (count-based) —
  // the two happen to share the word "recovery"/"resolution" but answer
  // different questions and are not interchangeable. See that function's
  // own comment for the full reconciliation (Phase C1.1).
  const withOriginal = rows.filter(r => r.original_amount != null && r.original_amount > 0);
  const recovery_rate = withOriginal.length > 0
    ? Math.round(withOriginal.reduce((sum, r) => sum + (((r.original_amount! - r.outstanding_amount) / r.original_amount!) * 100), 0) / withOriginal.length * 10) / 10
    : 0;

  const at_risk_amount = rows.filter(r => r.days_overdue > 90 || r.aging_bucket === "DAYS_90_PLUS").reduce((sum, r) => sum + r.outstanding_amount, 0);

  return {
    total_outstanding: Math.round(total_outstanding * 100) / 100,
    accounts_count:    rows.length,
    avg_days_overdue,
    by_aging_bucket,
    recovery_rate,
    at_risk_amount: Math.round(at_risk_amount * 100) / 100,
  };
}

// Phase C1.1 — reconciliation of two independently-computed "debtor KPI"
// implementations that this codebase had grown: computeDebtorKpi() above
// (called at import time, in modules/debtors/index.ts, feeding the
// persisted Metric time-series) and a second, separate set of formulas
// that had been written directly inline inside
// app/api/debtors/kpi/route.ts (called at read time, feeding the Command
// Centre's DebtorsTab). No test anywhere in this codebase exercises
// either implementation, so which one reflects "intended" product
// behaviour cannot be established from evidence — per this phase's own
// governing instruction, that ambiguity is not silently resolved by
// picking one. What IS resolved: the duplication itself. These functions
// are the SAME formulas the route already computed inline (verified
// identical, including rounding), simply relocated here as the one place
// this logic lives, with names that make explicit that
// accountResolutionRate is NOT recovery_rate above under a different
// name — they measure different things and must not be merged. This
// phase changes the route's externally-visible JSON response in no way
// at all; only where the calculation lives.

// What fraction of accounts have moved off OPEN status (resolved, in a
// payment plan, disputed, or written off) — count-based, distinct from
// computeDebtorKpi()'s amount-based recovery_rate above.
export function accountResolutionRate(rows: { status: string }[]): number {
  if (rows.length === 0) return 0;
  return Math.round(rows.filter(r => r.status !== "OPEN").length / rows.length * 100);
}

// Ad hoc severity score combining outstanding balance and days overdue —
// not a currency amount, not a percentage; a relative ranking heuristic
// only. Formula and threshold preserved exactly as they existed inline in
// app/api/debtors/kpi/route.ts before this phase (unverified against any
// test or product spec — reproduced unchanged, not re-derived).
export function debtorPriorityScore(row: { outstanding_amount: number; days_overdue: number }): number {
  return row.outstanding_amount * 10 + row.days_overdue * 5;
}

export const HIGH_RISK_PRIORITY_THRESHOLD = 8000;

export function avgDebtorPriority(rows: { outstanding_amount: number; days_overdue: number }[]): number {
  if (rows.length === 0) return 0;
  return Math.round(rows.reduce((sum, r) => sum + debtorPriorityScore(r), 0) / rows.length);
}

export function highRiskDebtorCount(rows: { outstanding_amount: number; days_overdue: number }[]): number {
  return rows.filter(r => debtorPriorityScore(r) > HIGH_RISK_PRIORITY_THRESHOLD).length;
}

export function agingBucketFromDays(days: number): string {
  if (days <= 0)   return "CURRENT";
  if (days <= 30)  return "DAYS_30";
  if (days <= 60)  return "DAYS_60";
  if (days <= 90)  return "DAYS_90";
  return "DAYS_90_PLUS";
}

// ── Phase C1-DBR2 — account-level (debtor_account_summary) calculations ──
//
// Everything above this line operates on individual CHARGE LINES (raw
// debtor_accounts rows) — correct for what it was built for, but no
// longer what app/api/debtors/kpi/route.ts should read directly, now that
// real data (Phase C1-DBR/C1-DBD/C1-DBS) proved a charge-line row is not
// an account. The functions below operate on debtor_account_summary rows
// (see scripts/create-debtor-account-summary-view.sql) — one row per
// (organisation_id, account_number), already aggregated across every
// charge line for that account. They are NOT drop-in replacements for the
// row-level functions above (which remain correct and unchanged for
// modules/debtors/index.ts's own persisted Metric time-series, untouched
// by this phase) — a new, parallel, account-level vocabulary, matching
// the same "centralise without merging distinct concepts" principle
// Phase C1.1 established for accountResolutionRate vs. recovery_rate.

export interface DebtorAccountRollup {
  organisation_id: string;
  account_number: string;
  account_name: string;
  current_outstanding: number;
  total_original_charges: number;
  open_charge_count: number;
  resolved_charge_count: number;
  total_charge_count: number;
  oldest_open_invoice_date: Date | null;
  current_days_overdue: number | null;
  current_aging_bucket: string | null;
  latest_charge_invoice_date: Date | null;
  first_charge_financial_year: string | null;
  latest_charge_financial_year: string | null;
  distinct_charge_type_count: number;
}

// Derived account meaning only (Phase C1-DBR2 §6) — no collections-policy
// workflow (IN_DISPUTE/PAYMENT_PLAN/WRITTEN_OFF) is inferred at the
// account level; no evidence in real data or product code supports one.
export type AccountResolutionState = "OPEN_ACCOUNT" | "FULLY_RESOLVED_ACCOUNT";

export function accountResolutionState(account: { open_charge_count: number }): AccountResolutionState {
  return account.open_charge_count > 0 ? "OPEN_ACCOUNT" : "FULLY_RESOLVED_ACCOUNT";
}

// Account-level equivalent of accountResolutionRate() above — but that
// function counts ROWS not OPEN; this counts ACCOUNTS with zero open
// charge lines. Preferred definition per this phase's brief: fully
// resolved accounts / all accounts with charge history * 100. Every
// debtor_account_summary row has at least one charge line by construction
// (GROUP BY guarantees it), so "all accounts with charge history" is
// simply every row passed in.
export function accountLevelResolutionRate(accounts: { open_charge_count: number }[]): number {
  if (accounts.length === 0) return 0;
  const fullyResolved = accounts.filter(a => a.open_charge_count === 0).length;
  return Math.round((fullyResolved / accounts.length) * 100);
}

// Account-level equivalent of debtorPriorityScore()/avgDebtorPriority()/
// highRiskDebtorCount() above — same formula shape (outstanding*10 +
// days_overdue*5, threshold unchanged at HIGH_RISK_PRIORITY_THRESHOLD),
// applied to account-level current_outstanding/current_days_overdue
// instead of a single charge line's values, so an account with many
// charge lines is scored ONCE, not once per line (the row-level version
// would double- or N-times-count it). current_days_overdue is null for a
// fully resolved account (see the view's own comment) — treated as 0 for
// this score specifically (a resolved account has zero outstanding and
// zero real overdue risk; this is a distinct decision from
// avgDaysOverdue's own null-exclusion, documented separately at that call
// site — a resolved account legitimately has priority 0, but should not
// silently pull down an average that is specifically about currently
// overdue accounts).
export function accountPriorityScore(account: { current_outstanding: number; current_days_overdue: number | null }): number {
  return account.current_outstanding * 10 + (account.current_days_overdue ?? 0) * 5;
}

export function avgAccountPriority(accounts: { current_outstanding: number; current_days_overdue: number | null }[]): number {
  if (accounts.length === 0) return 0;
  return Math.round(accounts.reduce((sum, a) => sum + accountPriorityScore(a), 0) / accounts.length);
}

export function highRiskAccountCount(accounts: { current_outstanding: number; current_days_overdue: number | null }[]): number {
  return accounts.filter(a => accountPriorityScore(a) > HIGH_RISK_PRIORITY_THRESHOLD).length;
}

// avgDaysOverdue at the account level: averaged ONLY over accounts with
// at least one open charge line (current_days_overdue is non-null for
// exactly those accounts) — a fully resolved account contributes nothing
// to this average, per this phase's explicit preference ("prefer NULL
// internally if it prevents resolved accounts distorting average overdue
// metrics"). Documented here, not silently decided: resolved accounts are
// EXCLUDED from this average, not counted as 0.
export function avgOpenAccountDaysOverdue(accounts: { open_charge_count: number; current_days_overdue: number | null }[]): number {
  const open = accounts.filter(a => a.open_charge_count > 0 && a.current_days_overdue != null);
  if (open.length === 0) return 0;
  return Math.round(open.reduce((sum, a) => sum + (a.current_days_overdue as number), 0) / open.length);
}
