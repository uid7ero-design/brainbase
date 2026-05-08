import type { OpsKpi, WeeklyKpi, SuburbHotspot, ZoneBreakdown } from "@/types/operational";

export interface OpsRow {
  request_date: Date;
  service_type?: string | null;
  zone?: string | null;
  suburb?: string | null;
  severity?: string | null;
  status: string;
  repeat_issue?: boolean | null;
  complaint_count?: number | null;
  response_hours?: number | null;
  units_affected?: number | null;
}

export function computeOpsKpi(rows: OpsRow[]): OpsKpi {
  if (rows.length === 0) {
    return { total_issues: 0, open: 0, resolved: 0, repeat_rate: 0, avg_response_hours: 0, complaint_count: 0, resolution_rate: 0, top_hotspots: [] };
  }

  const open     = rows.filter(r => r.status.toLowerCase() === "open").length;
  const resolved = rows.filter(r => r.status.toLowerCase() === "resolved").length;
  const repeats  = rows.filter(r => r.repeat_issue === true).length;

  const responseTimes = rows.filter(r => r.response_hours != null && r.response_hours > 0).map(r => r.response_hours!);
  const avg_response_hours = responseTimes.length > 0
    ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 10) / 10 : 0;
  const complaint_count = rows.reduce((sum, r) => sum + (r.complaint_count ?? 0), 0);

  return {
    total_issues:     rows.length,
    open, resolved,
    repeat_rate:      Math.round((repeats / rows.length) * 1000) / 10,
    avg_response_hours,
    complaint_count,
    resolution_rate:  Math.round((resolved / rows.length) * 1000) / 10,
    top_hotspots:     computeSuburbHotspots(rows).slice(0, 5),
  };
}

export function aggregateByWeek(rows: OpsRow[]): WeeklyKpi[] {
  const byWeek = new Map<string, OpsRow[]>();
  for (const row of rows) {
    const d = new Date(row.request_date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    const key = monday.toISOString().slice(0, 10);
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key)!.push(row);
  }
  return Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([week_start, wRows]) => {
    const kpi = computeOpsKpi(wRows);
    return {
      week_start,
      total_issues:       wRows.length,
      open_issues:        kpi.open,
      in_progress:        wRows.filter(r => r.status.toLowerCase().includes("progress")).length,
      resolved_issues:    kpi.resolved,
      repeat_issue_count: wRows.filter(r => r.repeat_issue).length,
      complaint_count:    kpi.complaint_count,
      avg_response_hours: kpi.avg_response_hours,
    };
  });
}

export function computeSuburbHotspots(rows: OpsRow[]): SuburbHotspot[] {
  const map = new Map<string, { count: number; repeat: number; complaints: number; severity_total: number }>();
  for (const row of rows) {
    const suburb = row.suburb ?? "Unknown";
    if (!map.has(suburb)) map.set(suburb, { count: 0, repeat: 0, complaints: 0, severity_total: 0 });
    const e = map.get(suburb)!;
    e.count++;
    if (row.repeat_issue) e.repeat++;
    e.complaints += row.complaint_count ?? 0;
    e.severity_total += severityScore(row.severity);
  }
  return Array.from(map.entries())
    .map(([suburb, d]) => ({ suburb, count: d.count, repeat_count: d.repeat, complaint_count: d.complaints, severity_score: Math.round((d.severity_total / d.count) * 10) / 10 }))
    .sort((a, b) => b.severity_score - a.severity_score || b.count - a.count);
}

export function computeZoneBreakdown(rows: OpsRow[], prevRows: OpsRow[] = []): ZoneBreakdown[] {
  const total = rows.length || 1;
  const byZone = new Map<string, number>();
  const byPrev  = new Map<string, number>();
  for (const r of rows)     { const z = r.zone ?? "Unknown"; byZone.set(z, (byZone.get(z) ?? 0) + 1); }
  for (const r of prevRows) { const z = r.zone ?? "Unknown"; byPrev.set(z,  (byPrev.get(z)  ?? 0) + 1); }
  return Array.from(byZone.entries())
    .map(([zone, count]) => {
      const prev = byPrev.get(zone) ?? 0;
      const delta = count - prev;
      return { zone, count, pct_of_total: Math.round((count / total) * 1000) / 10, trend: (delta > 0 ? "up" : delta < 0 ? "down" : "stable") as "up" | "down" | "stable", prev_count: prev };
    })
    .sort((a, b) => b.count - a.count);
}

export function breakdownByServiceType(rows: OpsRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, r) => {
    const t = r.service_type ?? "unspecified";
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
}

function severityScore(severity: string | null | undefined): number {
  switch ((severity ?? "").toLowerCase()) {
    case "critical": return 4;
    case "high":     return 3;
    case "low":      return 1;
    default:         return 2;
  }
}
