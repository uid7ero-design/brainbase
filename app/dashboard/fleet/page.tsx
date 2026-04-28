import sql from '@/lib/db';
import { requireSession } from '@/lib/org';
import FleetClient, { Asset } from './FleetClient';

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
  try {
    const session = await requireSession();
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

  return <FleetClient dbAssets={dbAssets} />;
}
