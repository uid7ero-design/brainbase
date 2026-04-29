import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import WasteClient from './WasteClient';

// ─── Types ────────────────────────────────────────────────────────────────────

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

export type UploadMeta = {
  fileName: string;
  uploadedAt: string;
  recordCount: number;
  serviceType: string;
};

export type KpiRule = {
  metric: string;
  operator: string;
  threshold: number;
  severity: 'warning' | 'critical';
};

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

// ─── Demo data (shown when no records have been uploaded yet) ─────────────────

const DEMO_SERVICE_TYPES   = ['General Waste', 'Recycling', 'Organics', 'Hard Waste'];
const DEMO_FINANCIAL_YEARS = ['2025-26'];

const DEMO_ZONES: ZoneRow[] = [
  { suburb: 'Norwood',         total_cost: 342_180, total_tonnes: 2_310, total_collections: 9_240, avg_contamination:  7.2, cost_per_tonne: 148.13, service_costs: { 'General Waste': 178_400, 'Recycling': 96_800, 'Organics': 58_980, 'Hard Waste': 8_000 } },
  { suburb: 'Payneham',        total_cost: 298_540, total_tonnes: 1_980, total_collections: 7_920, avg_contamination:  9.8, cost_per_tonne: 150.78, service_costs: { 'General Waste': 152_600, 'Recycling': 84_200, 'Organics': 52_740, 'Hard Waste': 9_000 } },
  { suburb: 'Marden',          total_cost: 261_300, total_tonnes: 1_740, total_collections: 6_960, avg_contamination: 11.4, cost_per_tonne: 150.17, service_costs: { 'General Waste': 134_800, 'Recycling': 72_400, 'Organics': 46_100, 'Hard Waste': 8_000 } },
  { suburb: 'Glynde',          total_cost: 152_400, total_tonnes: 1_080, total_collections: 4_320, avg_contamination:  8.1, cost_per_tonne: 141.11, service_costs: { 'General Waste':  76_200, 'Recycling': 43_100, 'Organics': 28_100, 'Hard Waste': 5_000 } },
  { suburb: 'Royston Park',    total_cost: 198_720, total_tonnes: 1_420, total_collections: 5_680, avg_contamination:  6.5, cost_per_tonne: 139.94, service_costs: { 'General Waste':  98_500, 'Recycling': 56_400, 'Organics': 36_820, 'Hard Waste': 7_000 } },
  { suburb: 'Heathpool',       total_cost: 137_860, total_tonnes:   940, total_collections: 3_760, avg_contamination: 13.7, cost_per_tonne: 146.66, service_costs: { 'General Waste':  68_900, 'Recycling': 38_960, 'Organics': 26_000, 'Hard Waste': 4_000 } },
  { suburb: 'Trinity Gardens', total_cost: 226_140, total_tonnes: 1_580, total_collections: 6_320, avg_contamination:  7.9, cost_per_tonne: 143.13, service_costs: { 'General Waste': 114_400, 'Recycling': 63_540, 'Organics': 41_200, 'Hard Waste': 7_000 } },
  { suburb: 'Evandale',        total_cost: 184_660, total_tonnes: 1_260, total_collections: 5_040, avg_contamination: 10.2, cost_per_tonne: 146.56, service_costs: { 'General Waste':  93_200, 'Recycling': 51_600, 'Organics': 34_860, 'Hard Waste': 5_000 } },
];

const DEMO_MONTHLY: MonthlyRow[] = [
  { month: 'Oct', actual: 268_400 },
  { month: 'Nov', actual: 287_600 },
  { month: 'Dec', actual: 325_200 },
  { month: 'Jan', actual: 341_800 },
  { month: 'Feb', actual: 318_500 },
  { month: 'Mar', actual: 260_300 },
];

const DEMO_MONTHLY_BY_TYPE: MonthlyByTypeRow[] = [
  { month: 'Oct', 'General Waste': 122_800, 'Recycling': 73_400, 'Organics': 62_200, 'Hard Waste': 10_000 },
  { month: 'Nov', 'General Waste': 130_600, 'Recycling': 78_200, 'Organics': 68_800, 'Hard Waste': 10_000 },
  { month: 'Dec', 'General Waste': 148_400, 'Recycling': 89_200, 'Organics': 75_600, 'Hard Waste': 12_000 },
  { month: 'Jan', 'General Waste': 157_200, 'Recycling': 93_800, 'Organics': 78_800, 'Hard Waste': 12_000 },
  { month: 'Feb', 'General Waste': 145_400, 'Recycling': 87_200, 'Organics': 73_900, 'Hard Waste': 12_000 },
  { month: 'Mar', 'General Waste': 113_600, 'Recycling': 85_400, 'Organics': 51_300, 'Hard Waste': 10_000 },
];

const DEMO_CONTAMINATION: ContaminationRow[] = [
  { suburb: 'Heathpool',       rate: 13.7 },
  { suburb: 'Marden',          rate: 11.4 },
  { suburb: 'Evandale',        rate: 10.2 },
  { suburb: 'Payneham',        rate:  9.8 },
  { suburb: 'Trinity Gardens', rate:  7.9 },
  { suburb: 'Glynde',          rate:  8.1 },
  { suburb: 'Norwood',         rate:  7.2 },
  { suburb: 'Royston Park',    rate:  6.5 },
];

const DEMO_COMPOSITION = [
  { name: 'General Waste', value: 918_100 },
  { name: 'Recycling',     value: 507_000 },
  { name: 'Organics',      value: 324_800 },
  { name: 'Hard Waste',    value:  52_000 },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WastePage() {
  const session = await getSession();
  if (!session?.organisationId) redirect('/login');

  // Latest upload metadata (file name, row count, timestamp)
  let uploadMeta: UploadMeta | null = null;
  try {
    const fileRows = await sql`
      SELECT f.file_name, f.service_type, f.created_at,
             (SELECT COUNT(*) FROM waste_records wr WHERE wr.uploaded_file_id = f.id)::int AS record_count
      FROM uploaded_files f
      WHERE f.organisation_id = ${session.organisationId}
        AND f.upload_status = 'complete'
      ORDER BY f.created_at DESC
      LIMIT 1
    `;
    if (fileRows.length > 0) {
      uploadMeta = {
        fileName:    fileRows[0].file_name    as string,
        uploadedAt:  fileRows[0].created_at   as string,
        recordCount: Number(fileRows[0].record_count),
        serviceType: (fileRows[0].service_type as string | null) ?? 'waste',
      };
    }
  } catch { /* tables not yet created */ }

  // KPI rules
  let kpiRules: KpiRule[] = [];
  try {
    const ruleRows = await sql`
      SELECT metric, operator, threshold::float AS threshold, severity
      FROM kpi_rules
      WHERE organisation_id = ${session.organisationId}
    `;
    kpiRules = ruleRows.map(r => ({
      metric:    String(r.metric),
      operator:  String(r.operator),
      threshold: Number(r.threshold),
      severity:  (r.severity === 'critical' ? 'critical' : 'warning') as 'warning' | 'critical',
    }));
  } catch { /* table not yet created */ }

  // Waste records
  let rawRecords: Record<string, unknown>[] = [];
  try {
    rawRecords = await sql`
      SELECT service_type, suburb, month, financial_year,
             tonnes, collections, contamination_rate, cost
      FROM waste_records
      WHERE organisation_id = ${session.organisationId}
      LIMIT 5000
    `;
  } catch { /* table not yet created */ }

  // No real data — render demo view
  if (rawRecords.length === 0) {
    return (
      <WasteClient
        isDemo
        uploadMeta={null}
        zones={DEMO_ZONES}
        monthly={DEMO_MONTHLY}
        monthlyByType={DEMO_MONTHLY_BY_TYPE}
        contamination={DEMO_CONTAMINATION}
        composition={DEMO_COMPOSITION}
        serviceTypes={DEMO_SERVICE_TYPES}
        financialYears={DEMO_FINANCIAL_YEARS}
        kpiRules={kpiRules}
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

  const serviceTypes   = [...new Set(records.map(r => r.serviceType))].filter(Boolean);
  const financialYears = [...new Set(records.map(r => r.financialYear))].filter(Boolean);

  // Zones: group by suburb
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
    for (const r of rows) serviceCosts[r.serviceType] = (serviceCosts[r.serviceType] ?? 0) + r.cost;
    return { suburb, total_cost: totalCost, total_tonnes: totalTonnes, total_collections: totalCollections, avg_contamination: avgContam, cost_per_tonne: totalTonnes > 0 ? totalCost / totalTonnes : 0, service_costs: serviceCosts };
  });

  // Monthly: group by month
  const byMonth = new Map<string, { cost: number; byType: Record<string, number> }>();
  for (const r of records) {
    if (!r.month) continue;
    const e = byMonth.get(r.month) ?? { cost: 0, byType: {} };
    e.cost += r.cost;
    e.byType[r.serviceType] = (e.byType[r.serviceType] ?? 0) + r.cost;
    byMonth.set(r.month, e);
  }
  const months        = sortedMonthKeys([...byMonth.keys()]);
  const monthly       = months.map(m => ({ month: m, actual: byMonth.get(m)!.cost }));
  const monthlyByType = months.map(m => ({ month: m, ...byMonth.get(m)!.byType }));

  // Contamination: group by suburb
  const contamination: ContaminationRow[] = Array.from(bySuburb.entries())
    .flatMap(([suburb, rows]) => {
      const cr = rows.filter(r => r.contaminationRate != null && r.contaminationRate > 0);
      if (!cr.length) return [];
      return [{ suburb, rate: cr.reduce((s, r) => s + r.contaminationRate!, 0) / cr.length }];
    })
    .sort((a, b) => b.rate - a.rate);

  // Composition: cost by service type
  const bySvc = new Map<string, number>();
  for (const r of records) bySvc.set(r.serviceType, (bySvc.get(r.serviceType) ?? 0) + r.cost);
  const composition = [...bySvc.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <WasteClient
      isDemo={false}
      uploadMeta={uploadMeta}
      zones={zones}
      monthly={monthly}
      monthlyByType={monthlyByType}
      contamination={contamination}
      composition={composition}
      serviceTypes={serviceTypes}
      financialYears={financialYears}
      kpiRules={kpiRules}
    />
  );
}
