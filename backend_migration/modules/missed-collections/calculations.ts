/**
 * Missed Collections calculations — extracted from legacy bin_maintenance CSV logic.
 * Source: bin_maintenance.csv (property_id, address, suburb, collection_date, status, driver_id, route_id, notes)
 */

import type { MissedCollectionKpi, ZoneBreakdown } from "@/types/operational";

export interface CollectionRow {
  scheduled_date: Date;
  service_type?: string | null;
  route?: string | null;
  suburb?: string | null;
  address: string;
  driver_id?: string | null;
  status: string;
  complaint_raised?: boolean | null;
  rescheduled_date?: Date | null;
  completed_date?: Date | null;
}

// ── Primary KPI ───────────────────────────────────────────────────────────────

export function computeMissedCollectionKpi(rows: CollectionRow[]): MissedCollectionKpi {
  if (rows.length === 0) {
    return {
      total_missed: 0, open: 0, rescheduled: 0, completed: 0,
      complaint_rate: 0, top_routes: [], top_suburbs: [],
      miss_rate_by_service_type: {},
    };
  }

  const open        = rows.filter(r => r.status === "OPEN").length;
  const rescheduled = rows.filter(r => r.status === "RESCHEDULED").length;
  const completed   = rows.filter(r => r.status === "COMPLETED").length;
  const complaints  = rows.filter(r => r.complaint_raised === true).length;

  // Miss rate by service type (% of total for that type that were missed)
  const byType = new Map<string, number>();
  for (const r of rows) {
    const t = r.service_type ?? "unspecified";
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  const miss_rate_by_service_type = Object.fromEntries(
    Array.from(byType.entries()).map(([t, n]) => [t, Math.round((n / rows.length) * 1000) / 10])
  );

  return {
    total_missed:    rows.length,
    open,
    rescheduled,
    completed,
    complaint_rate:  rows.length > 0 ? Math.round((complaints / rows.length) * 1000) / 10 : 0,
    top_routes:      routeBreakdown(rows).slice(0, 5),
    top_suburbs:     suburbBreakdown(rows).slice(0, 5),
    miss_rate_by_service_type,
  };
}

// ── Route breakdown ───────────────────────────────────────────────────────────

export function routeBreakdown(
  rows: CollectionRow[],
  prevRows: CollectionRow[] = []
): ZoneBreakdown[] {
  const total    = rows.length || 1;
  const byRoute  = new Map<string, number>();
  const byPrev   = new Map<string, number>();

  for (const r of rows)     { const k = r.route ?? "Unknown"; byRoute.set(k, (byRoute.get(k) ?? 0) + 1); }
  for (const r of prevRows) { const k = r.route ?? "Unknown"; byPrev.set(k, (byPrev.get(k) ?? 0) + 1); }

  return Array.from(byRoute.entries())
    .map(([zone, count]) => {
      const prev  = byPrev.get(zone) ?? 0;
      const delta = count - prev;
      return {
        zone, count,
        pct_of_total: Math.round((count / total) * 1000) / 10,
        trend:        (delta > 0 ? "up" : delta < 0 ? "down" : "stable") as "up" | "down" | "stable",
        prev_count:   prev,
      };
    })
    .sort((a, b) => b.count - a.count);
}

// ── Suburb breakdown (hotspots) ───────────────────────────────────────────────

export function suburbBreakdown(rows: CollectionRow[]) {
  const map = new Map<string, { count: number; complaints: number }>();
  for (const r of rows) {
    const s = r.suburb ?? "Unknown";
    if (!map.has(s)) map.set(s, { count: 0, complaints: 0 });
    const entry = map.get(s)!;
    entry.count++;
    if (r.complaint_raised) entry.complaints++;
  }
  return Array.from(map.entries())
    .map(([suburb, d]) => ({
      suburb,
      count:          d.count,
      repeat_count:   0,
      complaint_count: d.complaints,
      severity_score: Math.round(((d.count + d.complaints * 2) / rows.length) * 100) / 100,
    }))
    .sort((a, b) => b.severity_score - a.severity_score);
}

// ── Driver performance ────────────────────────────────────────────────────────

export function driverMissRate(rows: CollectionRow[]): Array<{ driver: string; missed: number; pct: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const d = r.driver_id ?? "Unknown";
    map.set(d, (map.get(d) ?? 0) + 1);
  }
  const total = rows.length || 1;
  return Array.from(map.entries())
    .map(([driver, missed]) => ({ driver, missed, pct: Math.round((missed / total) * 1000) / 10 }))
    .sort((a, b) => b.missed - a.missed);
}

// ── Rescheduling effectiveness ────────────────────────────────────────────────

export function reschedulingRate(rows: CollectionRow[]): number {
  const rescheduled = rows.filter(r => r.rescheduled_date != null).length;
  return rows.length > 0 ? Math.round((rescheduled / rows.length) * 1000) / 10 : 0;
}
