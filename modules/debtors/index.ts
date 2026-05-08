import { prisma } from "@/lib/prisma";
import { parseFile } from "@/services/upload";
import { readFileSync } from "fs";
import { computeDebtorKpi, agingBucketFromDays } from "./calculations";
import { persistMetrics } from "@/services/persistence";
import { Module } from "@prisma/client";

export async function importDebtors(
  upload_id: string,
  organisation_id: string,
  stored_path: string,
  fieldMappings: Record<string, string | null>
): Promise<number> {
  const buffer = readFileSync(stored_path);
  const { rows } = parseFile(buffer, "text/csv", stored_path);

  const get = (row: Record<string, unknown>, canonical: string) =>
    fieldMappings[canonical] ? row[fieldMappings[canonical]!] : undefined;

  const records = rows.map(row => {
    const days_overdue = parseNum(get(row, "days_overdue"));
    const rawBucket    = nullStr(get(row, "aging_bucket"));
    const aging_bucket = mapAgingBucket(rawBucket ?? agingBucketFromDays(days_overdue));

    return {
      organisation_id,
      upload_id,
      account_number:     String(get(row, "account_number") ?? ""),
      account_name:       String(get(row, "account_name")   ?? ""),
      outstanding_amount: parseFloat(String(get(row, "outstanding_amount") ?? "0")) || 0,
      original_amount:    parseFloatOrNull(get(row, "original_amount")),
      days_overdue,
      aging_bucket,
      last_payment_date:  parseDateOrNull(get(row, "last_payment_date")),
      last_payment_amount: parseFloatOrNull(get(row, "last_payment_amount")),
      status:             mapDebtorStatus(String(get(row, "status") ?? "open")),
      collection_stage:   nullStr(get(row, "collection_stage")),
      notes:              nullStr(get(row, "notes")),
    };
  });

  await prisma.debtorAccount.createMany({ data: records, skipDuplicates: true });

  const now = new Date();
  const kpi = computeDebtorKpi(records);
  await persistMetrics([
    { organisation_id, upload_id, module: Module.DEBTORS, period_start: now, period_end: now, metric_key: "total_outstanding",  metric_value: kpi.total_outstanding, unit: "AUD" },
    { organisation_id, upload_id, module: Module.DEBTORS, period_start: now, period_end: now, metric_key: "accounts_count",     metric_value: kpi.accounts_count },
    { organisation_id, upload_id, module: Module.DEBTORS, period_start: now, period_end: now, metric_key: "avg_days_overdue",   metric_value: kpi.avg_days_overdue, unit: "days" },
    { organisation_id, upload_id, module: Module.DEBTORS, period_start: now, period_end: now, metric_key: "recovery_rate",      metric_value: kpi.recovery_rate, unit: "%" },
    { organisation_id, upload_id, module: Module.DEBTORS, period_start: now, period_end: now, metric_key: "at_risk_amount",     metric_value: kpi.at_risk_amount, unit: "AUD" },
  ]);

  return records.length;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseNum(v: unknown): number {
  const n = parseInt(String(v ?? "0"), 10);
  return isNaN(n) ? 0 : n;
}
function parseFloatOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}
function parseDateOrNull(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
function nullStr(v: unknown): string | null {
  const s = v != null ? String(v).trim() : "";
  return s || null;
}
function mapAgingBucket(s: string) {
  const l = s.toUpperCase().replace(/[\s\-]/g, "_");
  if (l === "CURRENT")   return "CURRENT"    as const;
  if (l.includes("30"))  return "DAYS_30"    as const;
  if (l.includes("60"))  return "DAYS_60"    as const;
  if (l.includes("90") && l.includes("PLUS")) return "DAYS_90_PLUS" as const;
  if (l.includes("90"))  return "DAYS_90"    as const;
  return "CURRENT" as const;
}
function mapDebtorStatus(s: string) {
  const l = s.toLowerCase().replace(/[\s_]+/g, "_");
  if (l.includes("dispute"))       return "IN_DISPUTE"    as const;
  if (l.includes("plan"))          return "PAYMENT_PLAN"  as const;
  if (l.includes("written"))       return "WRITTEN_OFF"   as const;
  if (l === "resolved" || l === "closed") return "RESOLVED" as const;
  return "OPEN" as const;
}
