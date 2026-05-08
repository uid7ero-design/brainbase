import { prisma } from "@/lib/prisma";
import { parseFile } from "@/services/upload";
import { readFileSync } from "fs";
import { computeOpsKpi, aggregateByWeek } from "./calculations";
import { persistMetrics } from "@/services/persistence";
import { Module } from "@prisma/client";

export async function importServiceRequests(
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
    request_date:   parseDate(get(row, "request_date")) ?? new Date(),
    request_type:   String(get(row, "request_type") ?? get(row, "issue_type") ?? ""),
    service_type:   nullStr(get(row, "service_type")),
    zone:           nullStr(get(row, "zone") ?? get(row, "route")),
    suburb:         nullStr(get(row, "suburb")),
    address:        nullStr(get(row, "address")),
    severity:       mapSeverity(nullStr(get(row, "severity"))),
    status:         mapStatus(String(get(row, "status") ?? "open")),
    repeat_issue:   isTruthy(get(row, "repeat_issue")),
    complaint_count: parseNum(get(row, "complaint_count")),
    units_affected:  parseNum(get(row, "units_affected")),
    response_hours:  parseFloat(String(get(row, "response_hours") ?? "0")) || null,
    notes:          nullStr(get(row, "notes")),
  }));

  await prisma.serviceRequest.createMany({ data: records, skipDuplicates: true });

  const now   = new Date();
  const start = records.length > 0
    ? new Date(Math.min(...records.map(r => r.request_date.getTime()))) : now;

  const kpi   = computeOpsKpi(records);
  const weeks = aggregateByWeek(records);

  await persistMetrics([
    { organisation_id, upload_id, module: Module.WASTE, period_start: start, period_end: now, metric_key: "total_issues",       metric_value: kpi.total_issues },
    { organisation_id, upload_id, module: Module.WASTE, period_start: start, period_end: now, metric_key: "open_issues",        metric_value: kpi.open },
    { organisation_id, upload_id, module: Module.WASTE, period_start: start, period_end: now, metric_key: "resolved_issues",    metric_value: kpi.resolved },
    { organisation_id, upload_id, module: Module.WASTE, period_start: start, period_end: now, metric_key: "repeat_rate",        metric_value: kpi.repeat_rate,        unit: "%" },
    { organisation_id, upload_id, module: Module.WASTE, period_start: start, period_end: now, metric_key: "avg_response_hours", metric_value: kpi.avg_response_hours, unit: "hours" },
    { organisation_id, upload_id, module: Module.WASTE, period_start: start, period_end: now, metric_key: "complaint_count",    metric_value: kpi.complaint_count },
    { organisation_id, upload_id, module: Module.WASTE, period_start: start, period_end: now, metric_key: "resolution_rate",    metric_value: kpi.resolution_rate,    unit: "%" },
    ...weeks.map(w => ({
      organisation_id, upload_id, module: Module.WASTE,
      period_start: new Date(w.week_start),
      period_end:   new Date(new Date(w.week_start).getTime() + 6 * 86400000),
      metric_key:   "weekly_total_issues",
      metric_value: w.total_issues,
    })),
  ]);

  return records.length;
}

export async function getOpsKpi(organisation_id: string, since?: Date) {
  const rows = await prisma.serviceRequest.findMany({
    where: { organisation_id, ...(since ? { request_date: { gte: since } } : {}) },
    select: { request_date: true, service_type: true, zone: true, suburb: true, severity: true, status: true, repeat_issue: true, complaint_count: true, response_hours: true, units_affected: true },
  });
  return computeOpsKpi(rows.map(r => ({ ...r, status: r.status as string, severity: r.severity as string })));
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
function parseNum(v: unknown): number {
  const n = parseInt(String(v ?? "0"), 10);
  return isNaN(n) ? 0 : n;
}
function isTruthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y";
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
  if (l === "resolved" || l === "closed") return "RESOLVED" as const;
  if (l.includes("progress"))             return "IN_PROGRESS" as const;
  return "OPEN" as const;
}
