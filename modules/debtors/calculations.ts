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
