import { prisma } from "@/lib/prisma";
import { parseFile } from "@/services/upload";
import { readFileSync } from "fs";
import { persistMetrics } from "@/services/persistence";
import { Module, MaintenanceStatus, BinType, Severity } from "@prisma/client";

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

  const records = rows
    .map(row => {
      const suburb    = nullStr(get(row, "suburb"));
      const address   = nullStr(get(row, "address"));
      const issueType = nullStr(get(row, "issue_type"));
      if (!suburb || !address || !issueType) return null;

      return {
        organisation_id,
        suburb,
        address,
        bin_type:       mapBinType(String(get(row, "bin_type") ?? "")),
        issue_type:     issueType,
        severity:       mapSeverity(String(get(row, "severity") ?? "")),
        status:         mapStatus(String(get(row, "status") ?? "")),
        assigned_to:    nullStr(get(row, "assigned_to")),
        scheduled_date: parseDate(get(row, "scheduled_date")),
        completed_date: null as Date | null,
        notes:          nullStr(get(row, "notes")),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (records.length === 0) return 0;

  await prisma.binMaintenanceJob.createMany({ data: records, skipDuplicates: true });

  const now      = new Date();
  const open     = records.filter(r => r.status === MaintenanceStatus.OPEN || r.status === MaintenanceStatus.ASSIGNED || r.status === MaintenanceStatus.SCHEDULED || r.status === MaintenanceStatus.IN_PROGRESS).length;
  const critical = records.filter(r => r.severity === Severity.CRITICAL).length;
  const done     = records.filter(r => r.status === MaintenanceStatus.COMPLETED || r.status === MaintenanceStatus.CLOSED).length;

  await persistMetrics([
    { organisation_id, upload_id, module: Module.BIN_MAINTENANCE, period_start: now, period_end: now, metric_key: "total_jobs",       metric_value: records.length },
    { organisation_id, upload_id, module: Module.BIN_MAINTENANCE, period_start: now, period_end: now, metric_key: "open_jobs",        metric_value: open },
    { organisation_id, upload_id, module: Module.BIN_MAINTENANCE, period_start: now, period_end: now, metric_key: "critical_jobs",    metric_value: critical },
    { organisation_id, upload_id, module: Module.BIN_MAINTENANCE, period_start: now, period_end: now, metric_key: "completion_rate",  metric_value: records.length > 0 ? Math.round((done / records.length) * 1000) / 10 : 0, unit: "%" },
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

function mapStatus(s: string): MaintenanceStatus {
  const l = s.toLowerCase().replace(/[\s_-]/g, "");
  if (l === "completed" || l === "complete" || l === "done") return MaintenanceStatus.COMPLETED;
  if (l === "closed")                                         return MaintenanceStatus.CLOSED;
  if (l === "inprogress" || l === "progress" || l === "active") return MaintenanceStatus.IN_PROGRESS;
  if (l === "assigned")                                       return MaintenanceStatus.ASSIGNED;
  if (l === "scheduled")                                      return MaintenanceStatus.SCHEDULED;
  if (l === "escalated")                                      return MaintenanceStatus.ESCALATED;
  return MaintenanceStatus.OPEN;
}

function mapBinType(s: string): BinType {
  const l = s.toLowerCase().replace(/[\s_-]/g, "");
  if (l === "recycling" || l === "recycle" || l === "yellow")  return BinType.RECYCLING;
  if (l === "organics" || l === "organic" || l === "green")    return BinType.ORGANICS;
  if (l === "bulkwaste" || l === "bulk" || l === "hardwaste")  return BinType.BULK_WASTE;
  return BinType.GENERAL_WASTE;
}

function mapSeverity(s: string): Severity {
  const l = s.toLowerCase();
  if (l === "critical") return Severity.CRITICAL;
  if (l === "high")     return Severity.HIGH;
  if (l === "low")      return Severity.LOW;
  return Severity.MEDIUM;
}
