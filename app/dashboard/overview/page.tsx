import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import OverviewClient from './OverviewClient';

async function q<T>(query: Promise<T>, fallback: T): Promise<T> {
  return query.catch(() => fallback);
}

export default async function OverviewPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const oid = session.organisationId;

  const [waste, fleet, srByStatus, monthlyCosts, contamHot, fleetDefects] = await Promise.all([
    q(sql`
      SELECT
        COALESCE(SUM(cost),0)::float               AS total_cost,
        COALESCE(SUM(tonnes),0)::float             AS total_tonnes,
        COALESCE(AVG(contamination_rate),0)::float AS avg_contamination,
        COALESCE(SUM(collections),0)::bigint       AS total_collections
      FROM waste_records WHERE organisation_id = ${oid}
    `, []),
    q(sql`
      SELECT
        COALESCE(SUM(fuel),0)::float        AS total_fuel,
        COALESCE(SUM(maintenance),0)::float AS total_maintenance,
        COALESCE(SUM(wages),0)::float       AS total_wages,
        COALESCE(SUM(km),0)::float          AS total_km,
        COALESCE(SUM(defects),0)::bigint    AS total_defects,
        COUNT(DISTINCT vehicle_id)::bigint  AS vehicle_count
      FROM fleet_metrics WHERE organisation_id = ${oid}
    `, []),
    q(sql`
      SELECT status, COUNT(*)::bigint AS count, COALESCE(AVG(days_open),0)::float AS avg_days
      FROM service_requests WHERE organisation_id = ${oid}
      GROUP BY status
    `, []),
    q(sql`
      SELECT
        month,
        COALESCE(SUM(cost),0)::float AS waste_cost
      FROM waste_records WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(
        ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'],
        month
      )
    `, []),
    q(sql`
      SELECT suburb, ROUND(AVG(contamination_rate)::numeric, 1)::float AS rate
      FROM waste_records WHERE organisation_id = ${oid}
      GROUP BY suburb HAVING AVG(contamination_rate) > 9
      ORDER BY rate DESC LIMIT 4
    `, []),
    q(sql`
      SELECT vehicle_id, SUM(defects)::bigint AS defects
      FROM fleet_metrics WHERE organisation_id = ${oid}
      GROUP BY vehicle_id HAVING SUM(defects) >= 2
      ORDER BY defects DESC LIMIT 4
    `, []),
  ]);

  const fleetMonthlyCosts = await q(sql`
    SELECT
      month,
      COALESCE(SUM(fuel) + SUM(maintenance) + SUM(wages),0)::float AS fleet_cost
    FROM fleet_metrics WHERE organisation_id = ${oid}
    GROUP BY month
    ORDER BY ARRAY_POSITION(
      ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'],
      month
    )
  `, []);

  // Merge monthly costs into single trend array
  const monthOrder = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];
  const trendMap: Record<string, { month: string; waste: number; fleet: number }> = {};
  for (const m of monthOrder) trendMap[m] = { month: m, waste: 0, fleet: 0 };
  for (const r of monthlyCosts as {month:string; waste_cost:number}[]) {
    if (r.month && trendMap[r.month]) trendMap[r.month].waste = Number(r.waste_cost);
  }
  for (const r of fleetMonthlyCosts as {month:string; fleet_cost:number}[]) {
    if (r.month && trendMap[r.month]) trendMap[r.month].fleet = Number(r.fleet_cost);
  }
  const trend = Object.values(trendMap).filter(r => r.waste > 0 || r.fleet > 0);

  // Build alerts
  type Alert = { severity: 'HIGH' | 'MED' | 'LOW'; label: string; detail: string };
  const alerts: Alert[] = [];
  for (const r of contamHot as {suburb:string; rate:number}[]) {
    alerts.push({ severity: r.rate > 12 ? 'HIGH' : 'MED', label: `${r.suburb} contamination`, detail: `${r.rate}% — threshold 8%` });
  }
  for (const r of fleetDefects as {vehicle_id:string; defects:number}[]) {
    alerts.push({ severity: Number(r.defects) >= 3 ? 'HIGH' : 'MED', label: `${r.vehicle_id} defects`, detail: `${r.defects} defect${r.defects === 1 ? '' : 's'} recorded` });
  }
  const openHigh = (srByStatus as {status:string; count:number; avg_days:number}[]).find(r => r.status === 'Open');
  if (openHigh && openHigh.avg_days > 6) {
    alerts.push({ severity: 'MED', label: 'Service requests overdue', detail: `${openHigh.count} open, avg ${Number(openHigh.avg_days).toFixed(1)} days` });
  }

  const wasteRow  = (waste  as Record<string,number>[])[0]  ?? {};
  const fleetRow  = (fleet  as Record<string,number>[])[0]  ?? {};

  return (
    <OverviewClient
      waste={wasteRow}
      fleet={fleetRow}
      serviceRequests={srByStatus as {status:string; count:number; avg_days:number}[]}
      trend={trend}
      alerts={alerts}
    />
  );
}
