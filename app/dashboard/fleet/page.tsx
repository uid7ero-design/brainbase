import sql from '@/lib/db';
import { requireSession } from '@/lib/org';
import FleetClient, { Asset } from './FleetClient';

export type FleetUploadMeta = {
  fileName: string;
  uploadedAt: string;
  recordCount: number;
};

type FleetMetricRow = {
  vehicle_id: string | null;
  vehicle_type: string | null;
  make: string | null;
  year: number | null;
  department: string | null;
  driver: string | null;
  km: number | null;
  wages: number | null;
  fuel: number | null;
  maintenance: number | null;
  rego: number | null;
  repairs: number | null;
  insurance: number | null;
  depreciation: number | null;
  services: number | null;
  defects: number | null;
};

function rowToAsset(r: FleetMetricRow): Asset {
  const wages = Number(r.wages) || 0;
  const fuel = Number(r.fuel) || 0;
  const maint = Number(r.maintenance) || 0;
  const rego = Number(r.rego) || 0;
  const repairs = Number(r.repairs) || 0;
  const ins = Number(r.insurance) || 0;
  const depr = Number(r.depreciation) || 0;
  const km = Number(r.km) || 0;
  const total = wages + fuel + maint + rego + repairs + ins;
  return {
    id: r.vehicle_id ?? '?',
    type: r.vehicle_type ?? '',
    make: r.make ?? '',
    year: Number(r.year) || 0,
    department: r.department ?? '',
    driver: r.driver ?? '',
    km,
    wages,
    fuel,
    maintenance: maint,
    rego,
    repairs,
    insurance: ins,
    depreciation: depr,
    services: Number(r.services) || 0,
    defects: Number(r.defects) || 0,
    total,
    totalWithDepr: total + depr,
    costPerKm: km > 0 ? total / km : 0,
  };
}

export default async function FleetPage() {
  let dbAssets: Asset[] = [];
  let uploadMeta: FleetUploadMeta | null = null;
  try {
    const session = await requireSession();

    // Upload metadata
    try {
      const fileRows = await sql`
        SELECT f.file_name, f.created_at,
               (SELECT COUNT(*) FROM fleet_metrics fm WHERE fm.uploaded_file_id = f.id)::int AS record_count
        FROM uploaded_files f
        WHERE f.organisation_id = ${session.organisationId}
          AND f.upload_status = 'complete'
          AND (f.service_type = 'fleet' OR f.file_name = 'demo-seed.csv')
        ORDER BY f.created_at DESC
        LIMIT 1
      `;
      if (fileRows.length > 0) {
        uploadMeta = {
          fileName:    fileRows[0].file_name  as string,
          uploadedAt:  fileRows[0].created_at as string,
          recordCount: Number(fileRows[0].record_count),
        };
      }
    } catch { /* table not ready */ }

    const rows: FleetMetricRow[] = (await sql`
      SELECT vehicle_id, vehicle_type, make, year, department, driver,
             km, wages, fuel, maintenance, rego, repairs, insurance,
             depreciation, services, defects
      FROM   fleet_metrics
      WHERE  organisation_id = ${session.organisationId}
      ORDER  BY vehicle_id
    `) as unknown as FleetMetricRow[];
    dbAssets = rows.map(rowToAsset);
  } catch {
    // Not logged in or table doesn't exist yet — client falls back to localStorage/dummy
  }

  return <FleetClient dbAssets={dbAssets} uploadMeta={uploadMeta} isDemo={dbAssets.length === 0} />;
}
