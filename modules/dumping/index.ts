import { prisma } from "@/lib/prisma";
import { parseFile } from "@/services/upload";
import { readFileSync } from "fs";
import { persistMetrics } from "@/services/persistence";
import { Module } from "@prisma/client";

export async function importIllegalDumping(
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
    report_date:      parseDate(get(row, "report_date")) ?? new Date(),
    location:         String(get(row, "location") ?? ""),
    suburb:           nullStr(get(row, "suburb")),
    zone:             nullStr(get(row, "zone")),
    waste_type:       String(get(row, "waste_type") ?? "General"),
    volume_estimate:  nullStr(get(row, "volume_estimate")),
    severity:         mapSeverity(nullStr(get(row, "severity"))),
    status:           mapStatus(String(get(row, "status") ?? "open")),
    crew_assigned:    nullStr(get(row, "crew_assigned")),
    resolution_date:  parseDate(get(row, "resolution_date")),
    cost_estimate:    parseFloatOrNull(get(row, "cost_estimate")),
    notes:            nullStr(get(row, "notes")),
  }));

  await prisma.illegalDumping.createMany({ data: records, skipDuplicates: true });

  const now     = new Date();
  const open    = records.filter(r => r.status === "OPEN").length;
  const resolved = records.filter(r => r.status === "RESOLVED").length;
  const costTotal = records.reduce((sum, r) => sum + (r.cost_estimate ?? 0), 0);

  await persistMetrics([
    { organisation_id, upload_id, module: Module.DUMPING, period_start: now, period_end: now, metric_key: "total_incidents",  metric_value: records.length },
    { organisation_id, upload_id, module: Module.DUMPING, period_start: now, period_end: now, metric_key: "open_incidents",   metric_value: open },
    { organisation_id, upload_id, module: Module.DUMPING, period_start: now, period_end: now, metric_key: "resolved_count",   metric_value: resolved },
    { organisation_id, upload_id, module: Module.DUMPING, period_start: now, period_end: now, metric_key: "total_cost",       metric_value: costTotal, unit: "AUD" },
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
function parseFloatOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}
function mapSeverity(s: string | null) {
  switch (s?.toLowerCase()) {
    case "critical": return "CRITICAL" as const;
    case "high":     return "HIGH"     as const;
    case "low":      return "LOW"      as const;
    default:         return "MEDIUM"   as const;
  }
}
function mapStatus(s: string) {
  const l = s.toLowerCase().replace(/[\s_]+/g, "_");
  if (l === "resolved" || l === "closed" || l === "complete") return "RESOLVED" as const;
  if (l.includes("progress"))             return "IN_PROGRESS" as const;
  return "OPEN" as const;
}
