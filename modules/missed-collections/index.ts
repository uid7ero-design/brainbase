import { prisma } from "@/lib/prisma";
import { parseFile } from "@/services/upload";
import { readFileSync } from "fs";
import { computeMissedCollectionKpi } from "./calculations";
import { persistMetrics } from "@/services/persistence";
import { Module } from "@prisma/client";

export async function importMissedCollections(
  upload_id: string,
  organisation_id: string,
  stored_path: string,
  fieldMappings: Record<string, string | null>
): Promise<number> {
  const buffer = readFileSync(stored_path);
  const { rows } = parseFile(buffer, "text/csv", stored_path);

  const get = (row: Record<string, unknown>, canonical: string) =>
    fieldMappings[canonical] ? row[fieldMappings[canonical]!] : undefined;

  const records = rows.map(row => ({
    organisation_id,
    upload_id,
    scheduled_date:   parseDate(get(row, "scheduled_date")) ?? new Date(),
    service_type:     String(get(row, "service_type") ?? ""),
    route:            nullStr(get(row, "route")),
    zone:             nullStr(get(row, "zone")),
    suburb:           nullStr(get(row, "suburb")),
    address:          String(get(row, "address") ?? ""),
    property_id:      nullStr(get(row, "property_id")),
    driver_id:        nullStr(get(row, "driver_id")),
    reason:           nullStr(get(row, "reason")),
    status:           mapMissedStatus(String(get(row, "status") ?? "open")),
    rescheduled_date: parseDate(get(row, "rescheduled_date")),
    completed_date:   parseDate(get(row, "completed_date")),
    complaint_raised: isTruthy(get(row, "complaint_raised")),
    notes:            nullStr(get(row, "notes")),
  }));

  await prisma.missedCollection.createMany({ data: records, skipDuplicates: true });

  const now = new Date();
  const kpi = computeMissedCollectionKpi(records);
  await persistMetrics([
    { organisation_id, upload_id, module: Module.MISSED_COLLECTIONS, period_start: now, period_end: now, metric_key: "total_missed",    metric_value: kpi.total_missed },
    { organisation_id, upload_id, module: Module.MISSED_COLLECTIONS, period_start: now, period_end: now, metric_key: "open_count",      metric_value: kpi.open },
    { organisation_id, upload_id, module: Module.MISSED_COLLECTIONS, period_start: now, period_end: now, metric_key: "complaint_rate",  metric_value: kpi.complaint_rate, unit: "%" },
    { organisation_id, upload_id, module: Module.MISSED_COLLECTIONS, period_start: now, period_end: now, metric_key: "rescheduled",     metric_value: kpi.rescheduled },
    { organisation_id, upload_id, module: Module.MISSED_COLLECTIONS, period_start: now, period_end: now, metric_key: "completed",       metric_value: kpi.completed },
  ]);

  return records.length;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
function nullStr(v: unknown): string | null {
  const s = v != null ? String(v).trim() : "";
  return s || null;
}
function isTruthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y";
}
function mapMissedStatus(s: string) {
  const l = s.toLowerCase().replace(/[\s_]+/g, "_");
  if (l === "rescheduled") return "RESCHEDULED" as const;
  if (l === "completed")   return "COMPLETED"   as const;
  if (l === "cancelled")   return "CANCELLED"   as const;
  return "OPEN" as const;
}
