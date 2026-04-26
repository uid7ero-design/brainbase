import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import WasteClient from './WasteClient';

// ─── Types (re-exported so WasteClient can import them) ───────────────────────

export type ZoneRow = {
  suburb: string;
  total_cost: number;
  total_tonnes: number;
  total_collections: number;
  avg_contamination: number | null;
  cost_per_tonne: number;
  service_costs: Record<string, number>;
};

export type MonthlyRow        = { month: string; actual: number };
export type MonthlyByTypeRow  = { month: string; [serviceType: string]: string | number };
export type ContaminationRow  = { suburb: string; rate: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_ORDER = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];

function normServiceType(raw: string | null): string {
  if (!raw) return 'Other';
  const s = raw.trim().toLowerCase();
  if (s.includes('recycl') || s.includes('mrf') || s.includes('commingled'))          return 'Recycling';
  if (s.includes('organic') || s.includes('green') || s.includes('fogo') || s.includes('food')) return 'Organics';
  if (s.includes('hard') || s.includes('bulk'))                                        return 'Hard Waste';
  if (s.includes('general') || s.includes('residual') || s.includes('msw') || s.includes('landfill') || s.includes('waste')) return 'General Waste';
  return raw.trim();
}

function sortedMonthKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ia = MONTH_ORDER.indexOf(a.substring(0, 3));
    const ib = MONTH_ORDER.indexOf(b.substring(0, 3));
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WastePage() {
  const session = await getSession();
  if (!session?.organisationId) redirect('/login');

  // Graceful fallback if the migration hasn't run yet
  let rawRecords: Record<string, unknown>[] = [];
  try {
    rawRecords = await sql`
      SELECT service_type, suburb, month, financial_year,
             tonnes, collections, contamination_rate, cost
      FROM waste_records
      WHERE organisation_id = ${session.organisationId}
      LIMIT 5000
    `;
  } catch {
    // waste_records table doesn't exist yet
  }

  if (rawRecords.length === 0) {
    return (
      <WasteClient
        hasData={false}
        zones={[]} monthly={[]} monthlyByType={[]}
        contamination={[]} composition={[]}
        serviceTypes={[]} financialYears={[]}
      />
    );
  }

  // Normalise raw records
  const records = rawRecords.map(r => ({
    suburb:            ((r.suburb as string | null) ?? 'Unknown').trim(),
    serviceType:       normServiceType(r.service_type as string | null),
    month:             (r.month as string | null) ?? '',
    financialYear:     (r.financial_year as string | null) ?? '',
    tonnes:            Number(r.tonnes ?? 0),
    collections:       Number(r.collections ?? 0),
    contaminationRate: r.contamination_rate != null ? Number(r.contamination_rate) : null,
    cost:              Number(r.cost ?? 0),
  }));

  const serviceTypes  = [...new Set(records.map(r => r.serviceType))].filter(Boolean);
  const financialYears = [...new Set(records.map(r => r.financialYear))].filter(Boolean);

  // ─── Zones: group by suburb ───────────────────────────────────────────────
  const bySuburb = new Map<string, typeof records>();
  for (const r of records) {
    const rows = bySuburb.get(r.suburb) ?? [];
    rows.push(r);
    bySuburb.set(r.suburb, rows);
  }

  const zones: ZoneRow[] = Array.from(bySuburb.entries()).map(([suburb, rows]) => {
    const totalCost        = rows.reduce((s, r) => s + r.cost, 0);
    const totalTonnes      = rows.reduce((s, r) => s + r.tonnes, 0);
    const totalCollections = rows.reduce((s, r) => s + r.collections, 0);
    const contamRows       = rows.filter(r => r.contaminationRate != null);
    const avgContam        = contamRows.length
      ? contamRows.reduce((s, r) => s + r.contaminationRate!, 0) / contamRows.length
      : null;

    const serviceCosts: Record<string, number> = {};
    for (const r of rows) {
      serviceCosts[r.serviceType] = (serviceCosts[r.serviceType] ?? 0) + r.cost;
    }

    return {
      suburb,
      total_cost:        totalCost,
      total_tonnes:      totalTonnes,
      total_collections: totalCollections,
      avg_contamination: avgContam,
      cost_per_tonne:    totalTonnes > 0 ? totalCost / totalTonnes : 0,
      service_costs:     serviceCosts,
    };
  });

  // ─── Monthly: group by month ──────────────────────────────────────────────
  const byMonth = new Map<string, { cost: number; byType: Record<string, number> }>();
  for (const r of records) {
    if (!r.month) continue;
    const e = byMonth.get(r.month) ?? { cost: 0, byType: {} };
    e.cost += r.cost;
    e.byType[r.serviceType] = (e.byType[r.serviceType] ?? 0) + r.cost;
    byMonth.set(r.month, e);
  }

  const months       = sortedMonthKeys([...byMonth.keys()]);
  const monthly      = months.map(m => ({ month: m, actual: byMonth.get(m)!.cost }));
  const monthlyByType = months.map(m => ({ month: m, ...byMonth.get(m)!.byType }));

  // ─── Contamination: group by suburb ──────────────────────────────────────
  const contamination: ContaminationRow[] = Array.from(bySuburb.entries())
    .flatMap(([suburb, rows]) => {
      const cr = rows.filter(r => r.contaminationRate != null && r.contaminationRate > 0);
      if (!cr.length) return [];
      return [{ suburb, rate: cr.reduce((s, r) => s + r.contaminationRate!, 0) / cr.length }];
    })
    .sort((a, b) => b.rate - a.rate);

  // ─── Composition: cost by service type ───────────────────────────────────
  const bySvc = new Map<string, number>();
  for (const r of records) bySvc.set(r.serviceType, (bySvc.get(r.serviceType) ?? 0) + r.cost);
  const composition = [...bySvc.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <WasteClient
      hasData
      zones={zones}
      monthly={monthly}
      monthlyByType={monthlyByType}
      contamination={contamination}
      composition={composition}
      serviceTypes={serviceTypes}
      financialYears={financialYears}
    />
  );
}
