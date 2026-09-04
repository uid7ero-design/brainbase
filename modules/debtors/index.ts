import { prisma } from "@/lib/prisma";
import { parseFile } from "@/services/upload";
import { readFileSync } from "fs";
import { computeDebtorKpi, agingBucketFromDays } from "./calculations";
import { persistMetrics } from "@/services/persistence";
import { Module } from "@prisma/client";

// Phase C1-DBF — corrects a Phase C1.1 assumption that real rehearsal-data
// investigation (Phase C1-DBR/C1-DBD/C1-DBS) conclusively invalidated.
//
// C1.1 believed `(organisation_id, account_number)` uniquely identified a
// DebtorAccount row and changed this importer to upsert on that compound
// key (see git history for the removed `.upsert(...)` call and the
// removed `scripts/add-debtor-accounts-dedup.ts` migration — deleted in
// this same phase, never executed against rehearsal or production, see
// that commit's message for the full reasoning). Real data proved
// `debtor_accounts` rows are source CHARGE LINES: the same account
// legitimately has many rows (different financial years, quarters, and
// charge types — see the financial_year/financial_quarter/charge_type/
// invoice_date/source_book/source_charge_code columns added in Phase
// C1-DBS2). Upserting on account_number alone was therefore silently
// **destroying distinct charge lines** every time a second charge for the
// same account was imported in the same batch or a later one — the exact
// opposite of what it was meant to do.
//
// Corrected policy (Option A from the Phase C1-DBF evaluation): APPEND
// every row with an account_number, never upsert, never delete, never
// merge. `debtor_accounts` has NO unique constraint on
// `(organisation_id, account_number)` — that Prisma declaration was
// removed in this same phase for exactly this reason.
//
// This reopens the original, still-real risk C1.1 was trying to solve —
// a genuine re-upload of the SAME source file appends a full second copy
// of every row, since there is still no reliable row-level source
// identity (Phase C1-DBS: the one candidate, metadata.__md5Row, is 0%
// populated in the real source export). No safe mechanism to reject or
// silently reconcile a repeated import exists today without adopting
// Data Hub's import-batch/file-hash lineage (explicitly out of scope for
// this phase) — `Upload` itself has no content-hash field. Per this
// phase's own governing instruction ("prefer preserving rows and clearly
// surfacing duplicate-import risk over destructive or lossy
// reconciliation"), this importer instead performs a best-effort,
// NON-BLOCKING check against the one signal that already exists on every
// Upload row — `original_name` — and stamps every row of a suspected
// repeat import with an explicit, queryable risk marker in `metadata`,
// rather than silently importing it as if nothing were different. This is
// a heuristic, not a guarantee: a renamed file, or a genuinely different
// file that happens to share a name, will not be (or will incorrectly be)
// flagged. It never blocks, rejects, deletes, or merges anything.
async function checkRepeatedImportRisk(
  organisation_id: string,
  upload_id: string,
): Promise<{ isRepeat: boolean; priorUploadId: string | null }> {
  const current = await prisma.upload.findUnique({ where: { id: upload_id } });
  if (!current) return { isRepeat: false, priorUploadId: null };

  const prior = await prisma.upload.findFirst({
    where: {
      organisation_id,
      schema_type: "DEBTORS",
      original_name: current.original_name,
      status: "COMPLETE",
      id: { not: upload_id },
    },
    orderBy: { created_at: "desc" },
  });

  if (prior) {
    console.warn(`importDebtors: possible repeated import — organisation ${organisation_id} previously completed an upload named "${current.original_name}" (upload ${prior.id}, completed) before this one (upload ${upload_id}). No reliable row-level identity exists to reconcile this automatically (see Phase C1-DBS: the source file's own __md5Row is 0% populated) — every row from this import will still be appended, tagged with duplicate_import_risk metadata for later review.`);
  }
  return { isRepeat: !!prior, priorUploadId: prior?.id ?? null };
}

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

  const { isRepeat, priorUploadId } = await checkRepeatedImportRisk(organisation_id, upload_id);

  const allRecords = rows.map(row => {
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
      // Best-effort, non-blocking audit marker — see checkRepeatedImportRisk
      // above. `{}` (the schema default) for every ordinary import.
      metadata: isRepeat
        ? { duplicate_import_risk: true, prior_upload_id: priorUploadId, detected_by: "original_name_match" }
        : {},
    };
  });

  // A row with no account_number cannot be usefully attributed to any
  // account at all (not a duplicate-detection concern — this predates and
  // is independent of the C1.1/C1-DBF correction above).
  const records = allRecords.filter(r => r.account_number !== "");
  const skipped = allRecords.length - records.length;
  if (skipped > 0) {
    console.warn(`importDebtors: skipped ${skipped} row(s) with no account_number for organisation ${organisation_id} (upload ${upload_id})`);
  }

  // Phase C1-DBF: plain, unconditional append — no upsert, no
  // skipDuplicates (that flag implied a deduplication guarantee that
  // never existed and no longer even has a constraint to silently no-op
  // against — removing it is more honest than keeping a misleading flag).
  // Every row with an account_number is inserted exactly as parsed; the
  // table's real grain is the charge line, and every charge line is
  // preserved. createMany is already a single atomic statement — no
  // $transaction wrapper is needed now that there is no per-row upsert
  // decision to keep atomic across.
  if (records.length > 0) {
    await prisma.debtorAccount.createMany({ data: records });
  }

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
