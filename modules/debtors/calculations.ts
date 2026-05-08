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

export function agingBucketFromDays(days: number): string {
  if (days <= 0)   return "CURRENT";
  if (days <= 30)  return "DAYS_30";
  if (days <= 60)  return "DAYS_60";
  if (days <= 90)  return "DAYS_90";
  return "DAYS_90_PLUS";
}
