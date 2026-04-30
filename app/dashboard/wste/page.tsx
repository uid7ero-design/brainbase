import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import WSTEClient from './WSTEClient';

export type WSTEVehicle = {
  id: string;
  registration: string;
  make: string;
  model: string;
  vehicle_type: string;
  depot: string;
  active: boolean;
};

export type WSTERun = {
  id: string;
  run_date: string;
  vehicle_registration: string;
  driver: string;
  route_name: string;
  suburb: string;
  gps_points: number;
  tickets_matched: number;
  exceptions_count: number;
  verified: boolean;
  completion_pct: number;
};

export type WSTEException = {
  id: string;
  run_date: string;
  vehicle_registration: string;
  address: string;
  suburb: string;
  exception_type: string;
  severity: 'low' | 'medium' | 'high';
  resolved: boolean;
};

export type WSTEKpis = {
  total_gps_points: number;
  vehicles_tracked: number;
  runs_analysed: number;
  tickets_matched: number;
  exceptions_identified: number;
  verification_rate: number;
};

// ── Demo data ────────────────────────────────────────────────────────────────

const DEMO_KPIS: WSTEKpis = {
  total_gps_points: 184_320,
  vehicles_tracked: 14,
  runs_analysed: 312,
  tickets_matched: 298,
  exceptions_identified: 27,
  verification_rate: 95.5,
};

const DEMO_RUNS: WSTERun[] = [
  { id: '1', run_date: '2025-04-28', vehicle_registration: 'S123ABC', driver: 'J. Thompson', route_name: 'Norwood West — General Waste',        suburb: 'Norwood',         gps_points: 1_840, tickets_matched: 182, exceptions_count: 1, verified: true,  completion_pct: 100 },
  { id: '2', run_date: '2025-04-28', vehicle_registration: 'S456DEF', driver: 'M. Evans',    route_name: 'Payneham South — General Waste',      suburb: 'Payneham',        gps_points: 1_620, tickets_matched: 161, exceptions_count: 2, verified: true,  completion_pct: 99  },
  { id: '3', run_date: '2025-04-27', vehicle_registration: 'S789GHI', driver: 'R. Carter',   route_name: 'Trinity East — General Waste',        suburb: 'Trinity Gardens', gps_points: 1_480, tickets_matched: 138, exceptions_count: 5, verified: false, completion_pct: 93  },
  { id: '4', run_date: '2025-04-27', vehicle_registration: 'S123ABC', driver: 'J. Thompson', route_name: 'Marden North — FOGO',                 suburb: 'Marden',          gps_points: 1_310, tickets_matched: 128, exceptions_count: 0, verified: true,  completion_pct: 100 },
  { id: '5', run_date: '2025-04-26', vehicle_registration: 'S321JKL', driver: 'T. Walsh',    route_name: 'Evandale West — General Waste',       suburb: 'Evandale',        gps_points: 1_760, tickets_matched: 166, exceptions_count: 3, verified: true,  completion_pct: 98  },
  { id: '6', run_date: '2025-04-26', vehicle_registration: 'S654MNO', driver: 'D. Singh',    route_name: 'Glynde Central — General Waste',      suburb: 'Glynde',          gps_points: 1_200, tickets_matched: 108, exceptions_count: 8, verified: false, completion_pct: 87  },
  { id: '7', run_date: '2025-04-25', vehicle_registration: 'S789GHI', driver: 'R. Carter',   route_name: 'Heathpool East — Recycling',          suburb: 'Heathpool',       gps_points: 1_090, tickets_matched: 102, exceptions_count: 2, verified: true,  completion_pct: 97  },
  { id: '8', run_date: '2025-04-25', vehicle_registration: 'S456DEF', driver: 'M. Evans',    route_name: 'Royston Park South — General Waste',  suburb: 'Royston Park',    gps_points: 1_540, tickets_matched: 147, exceptions_count: 1, verified: true,  completion_pct: 100 },
];

const DEMO_EXCEPTIONS: WSTEException[] = [
  { id: '1', run_date: '2025-04-28', vehicle_registration: 'S789GHI', address: '14 Edmund Ave',    suburb: 'Trinity Gardens', exception_type: 'Missed Service',    severity: 'high',   resolved: false },
  { id: '2', run_date: '2025-04-28', vehicle_registration: 'S789GHI', address: '56 Church Tce',    suburb: 'Trinity Gardens', exception_type: 'GPS Gap > 5 min',   severity: 'medium', resolved: false },
  { id: '3', run_date: '2025-04-28', vehicle_registration: 'S456DEF', address: '8 Ayers Ave',      suburb: 'Payneham',        exception_type: 'No Ticket Match',   severity: 'medium', resolved: true  },
  { id: '4', run_date: '2025-04-28', vehicle_registration: 'S456DEF', address: '22 Sixth Ave',     suburb: 'Payneham',        exception_type: 'Wrong Route Order', severity: 'low',    resolved: true  },
  { id: '5', run_date: '2025-04-26', vehicle_registration: 'S654MNO', address: '3 Victoria Rd',    suburb: 'Glynde',          exception_type: 'Missed Service',    severity: 'high',   resolved: false },
  { id: '6', run_date: '2025-04-26', vehicle_registration: 'S654MNO', address: '77 Rose St',       suburb: 'Glynde',          exception_type: 'GPS Gap > 5 min',   severity: 'medium', resolved: false },
  { id: '7', run_date: '2025-04-26', vehicle_registration: 'S654MNO', address: '19 Reid Tce',      suburb: 'Glynde',          exception_type: 'No Ticket Match',   severity: 'medium', resolved: false },
  { id: '8', run_date: '2025-04-26', vehicle_registration: 'S654MNO', address: '41 Moules Rd',     suburb: 'Glynde',          exception_type: 'Speed Anomaly',     severity: 'low',    resolved: true  },
  { id: '9', run_date: '2025-04-25', vehicle_registration: 'S321JKL', address: '11 Davey St',      suburb: 'Evandale',        exception_type: 'Missed Service',    severity: 'high',   resolved: true  },
  { id:'10', run_date: '2025-04-25', vehicle_registration: 'S321JKL', address: '62 Grange Rd',     suburb: 'Evandale',        exception_type: 'GPS Gap > 5 min',   severity: 'low',    resolved: true  },
];

const DEMO_VEHICLES: WSTEVehicle[] = [
  { id: '1', registration: 'S123ABC', make: 'Mercedes', model: 'Econic',    vehicle_type: 'Rear Loader', depot: 'North Depot', active: true },
  { id: '2', registration: 'S456DEF', make: 'Volvo',    model: 'FE',        vehicle_type: 'Side Loader', depot: 'South Depot', active: true },
  { id: '3', registration: 'S789GHI', make: 'MAN',      model: 'TGS',       vehicle_type: 'Rear Loader', depot: 'East Depot',  active: true },
  { id: '4', registration: 'S321JKL', make: 'Scania',   model: 'P 280',     vehicle_type: 'Side Loader', depot: 'West Depot',  active: true },
  { id: '5', registration: 'S654MNO', make: 'Mercedes', model: 'Actros',    vehicle_type: 'Front Loader',depot: 'East Depot',  active: true },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function WSTEPage() {
  const session = await getSession();
  if (!session?.organisationId) redirect('/login');

  let kpis: WSTEKpis = DEMO_KPIS;
  let runs: WSTERun[] = DEMO_RUNS;
  let exceptions: WSTEException[] = DEMO_EXCEPTIONS;
  let vehicles: WSTEVehicle[] = DEMO_VEHICLES;
  let isDemo = true;

  try {
    const runRows = await sql`
      SELECT COUNT(*)::int AS count FROM wste_runs
      WHERE organisation_id = ${session.organisationId}
    `;
    if (Number(runRows[0]?.count ?? 0) > 0) {
      isDemo = false;

      const vRows = await sql`
        SELECT id::text, registration, make, model, vehicle_type, depot, active
        FROM wste_vehicles
        WHERE organisation_id = ${session.organisationId} AND active = true
        ORDER BY registration
      `;
      vehicles = vRows.map(r => ({
        id: String(r.id), registration: String(r.registration),
        make: String(r.make), model: String(r.model),
        vehicle_type: String(r.vehicle_type), depot: String(r.depot),
        active: Boolean(r.active),
      }));

      const rRows = await sql`
        SELECT r.id::text, r.run_date::text, v.registration AS vehicle_registration,
               r.driver, r.route_name, r.suburb,
               r.gps_points, r.tickets_matched, r.exceptions_count,
               r.verified, r.completion_pct
        FROM wste_runs r
        JOIN wste_vehicles v ON v.id = r.vehicle_id
        WHERE r.organisation_id = ${session.organisationId}
        ORDER BY r.run_date DESC
        LIMIT 50
      `;
      runs = rRows.map(r => ({
        id: String(r.id), run_date: String(r.run_date),
        vehicle_registration: String(r.vehicle_registration),
        driver: String(r.driver), route_name: String(r.route_name),
        suburb: String(r.suburb), gps_points: Number(r.gps_points),
        tickets_matched: Number(r.tickets_matched),
        exceptions_count: Number(r.exceptions_count),
        verified: Boolean(r.verified), completion_pct: Number(r.completion_pct),
      }));

      const eRows = await sql`
        SELECT e.id::text, r.run_date::text, v.registration AS vehicle_registration,
               e.address, e.suburb, e.exception_type, e.severity, e.resolved
        FROM wste_exceptions e
        JOIN wste_runs r ON r.id = e.run_id
        JOIN wste_vehicles v ON v.id = r.vehicle_id
        WHERE e.organisation_id = ${session.organisationId}
        ORDER BY r.run_date DESC, e.severity DESC
        LIMIT 100
      `;
      exceptions = eRows.map(r => ({
        id: String(r.id), run_date: String(r.run_date),
        vehicle_registration: String(r.vehicle_registration),
        address: String(r.address), suburb: String(r.suburb),
        exception_type: String(r.exception_type),
        severity: r.severity as 'low' | 'medium' | 'high',
        resolved: Boolean(r.resolved),
      }));

      const kRow = await sql`
        SELECT
          (SELECT COUNT(*)   FROM wste_gps_points   WHERE organisation_id = ${session.organisationId})::int AS total_gps_points,
          (SELECT COUNT(*)   FROM wste_vehicles      WHERE organisation_id = ${session.organisationId} AND active = true)::int AS vehicles_tracked,
          (SELECT COUNT(*)   FROM wste_runs          WHERE organisation_id = ${session.organisationId})::int AS runs_analysed,
          (SELECT SUM(tickets_matched) FROM wste_runs WHERE organisation_id = ${session.organisationId})::int AS tickets_matched,
          (SELECT COUNT(*)   FROM wste_exceptions    WHERE organisation_id = ${session.organisationId})::int AS exceptions_identified,
          (SELECT ROUND(AVG(completion_pct), 1) FROM wste_runs WHERE organisation_id = ${session.organisationId})::float AS verification_rate
      `;
      kpis = {
        total_gps_points:     Number(kRow[0].total_gps_points ?? 0),
        vehicles_tracked:     Number(kRow[0].vehicles_tracked ?? 0),
        runs_analysed:        Number(kRow[0].runs_analysed ?? 0),
        tickets_matched:      Number(kRow[0].tickets_matched ?? 0),
        exceptions_identified:Number(kRow[0].exceptions_identified ?? 0),
        verification_rate:    Number(kRow[0].verification_rate ?? 0),
      };
    }
  } catch { /* tables not yet created — use demo data */ }

  return (
    <WSTEClient
      isDemo={isDemo}
      kpis={kpis}
      runs={runs}
      exceptions={exceptions}
      vehicles={vehicles}
    />
  );
}
