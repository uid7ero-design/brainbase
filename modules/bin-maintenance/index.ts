import { prisma } from "@/lib/prisma";
import { parseFile } from "@/services/upload";
import { readFileSync } from "fs";
import { persistMetrics } from "@/services/persistence";
import { Module } from "@prisma/client";

export async function importBinMaintenance(
  upload_id: string,
  organisation_id: string,
  stored_path: string,
  fieldMappings: Record<string, string | null>
): Promise<number> {
  const buffer = readFileSync(stored_path);
  const { rows } = parseFile(buffer, "text/csv", stored_path);

  const get = (row: Record<string, unknown>, canonical: string) =>
    fieldMappings[canonical] ? row[fieldMappings[canonical]!] : undefined;

  // Bin maintenance rows map to missed_collections with service_type = bin_maintenance
  const records = rows.map(row => ({
    organisation_id,
    upload_id,
    scheduled_date: parseDate(get(row, "collection_date")) ?? new Date(),
    service_type:   "BIN_MAINTENANCE",
    route:          nullStr(get(row, "route")),
    zone:           nullStr(get(row, "zone")),
    suburb:         nullStr(get(row, "suburb")),
    address:        String(get(row, "address") ?? ""),
    property_id:    nullStr(get(row, "property_id")),
    driver_id:      nullStr(get(row, "driver_id")),
    reason:         nullStr(get(row, "reason") ?? get(row, "notes")),
    status:         mapBinStatus(String(get(row, "status") ?? "open")),
    notes:          nullStr(get(row, "notes")),
  }));

  await prisma.missedCollection.createMany({ data: records, skipDuplicates: true });

  const now = new Date();
  const open = records.filter(r => r.status === "OPEN").length;

  await persistMetrics([
    { organisation_id, upload_id, module: Module.BIN_MAINTENANCE, period_start: now, period_end: now, metric_key: "total_inspections", metric_value: records.length },
    { organisation_id, upload_id, module: Module.BIN_MAINTENANCE, period_start: now, period_end: now, metric_key: "open_issues",       metric_value: open },
    { organisation_id, upload_id, module: Module.BIN_MAINTENANCE, period_start: now, period_end: now, metric_key: "miss_rate",         metric_value: records.length > 0 ? Math.round((open / records.length) * 1000) / 10 : 0, unit: "%" },
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
function mapBinStatus(s: string) {
  const l = s.toLowerCase();
  if (l === "completed" || l === "complete") return "COMPLETED" as const;
  if (l === "rescheduled")                   return "RESCHEDULED" as const;
  if (l === "cancelled")                     return "CANCELLED" as const;
  return "OPEN" as const;
}
