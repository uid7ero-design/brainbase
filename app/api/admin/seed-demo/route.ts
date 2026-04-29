import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';

/**
 * POST /api/admin/seed-demo
 * Inserts a full year of realistic demo data for the current organisation.
 * Safe to call multiple times — clears existing demo records first.
 * Requires super_admin or admin role.
 */
export async function POST() {
  const session = await getSession();
  if (!session || !['super_admin', 'admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const orgId = session.organisationId;

  // ── Create a demo "uploaded file" record ──────────────────────────────────
  const existingFile = await sql`
    SELECT id FROM uploaded_files
    WHERE organisation_id = ${orgId} AND file_name = 'demo-seed.csv'
    LIMIT 1
  `;

  let fileId: string;
  if (existingFile.length > 0) {
    fileId = existingFile[0].id as string;
    // Clear previous demo data
    await sql`DELETE FROM waste_records      WHERE organisation_id = ${orgId} AND uploaded_file_id = ${fileId}`;
    await sql`DELETE FROM fleet_metrics      WHERE organisation_id = ${orgId} AND uploaded_file_id = ${fileId}`;
    await sql`DELETE FROM service_requests   WHERE organisation_id = ${orgId} AND uploaded_file_id = ${fileId}`;
  } else {
    const fileRow = await sql`
      INSERT INTO uploaded_files (organisation_id, uploaded_by, file_name, file_type, service_type, upload_status)
      VALUES (${orgId}, ${session.userId}, 'demo-seed.csv', 'csv', 'waste', 'complete')
      RETURNING id
    `;
    fileId = fileRow[0].id as string;
  }

  // ── Constants ──────────────────────────────────────────────────────────────

  const MONTHS   = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];
  const FY       = '2025-26';
  const SUBURBS  = ['Norwood','Payneham','Marden','Glynde','Royston Park','Heathpool','Trinity Gardens','Evandale'];
  const SVC_TYPES = ['General Waste','Recycling','Organics','Hard Waste'];

  // Suburb base characteristics (realistic per-suburb profile)
  const SUBURB_PROFILE: Record<string, { scale: number; contamBase: number }> = {
    'Norwood':         { scale: 1.20, contamBase:  7.2 },
    'Payneham':        { scale: 1.05, contamBase:  9.8 },
    'Marden':          { scale: 0.92, contamBase: 11.4 },
    'Glynde':          { scale: 0.55, contamBase:  8.1 },
    'Royston Park':    { scale: 0.82, contamBase:  6.5 },
    'Heathpool':       { scale: 0.48, contamBase: 13.7 },
    'Trinity Gardens': { scale: 0.90, contamBase:  7.9 },
    'Evandale':        { scale: 0.72, contamBase: 10.2 },
  };

  // Service type cost fractions + tonnes per $1000 cost
  const SVC_PROFILE: Record<string, { frac: number; tonnesPerK: number }> = {
    'General Waste': { frac: 0.46, tonnesPerK: 6.5 },
    'Recycling':     { frac: 0.26, tonnesPerK: 5.8 },
    'Organics':      { frac: 0.21, tonnesPerK: 5.2 },
    'Hard Waste':    { frac: 0.07, tonnesPerK: 3.0 },
  };

  // Seasonal multiplier (council year Jul–Jun; summer spike Dec–Jan)
  const SEASONAL = [0.93, 0.92, 0.97, 1.00, 1.02, 1.10, 1.14, 1.06, 0.99, 0.96, 0.94, 0.97];

  function jitter(base: number, pct = 0.06) {
    return base * (1 + (Math.random() - 0.5) * 2 * pct);
  }

  // ── 1. Waste records ───────────────────────────────────────────────────────

  const BASE_MONTHLY_COST = 28_000; // per suburb per month base
  const wasteRows: Record<string, unknown>[] = [];

  for (const suburb of SUBURBS) {
    const { scale, contamBase } = SUBURB_PROFILE[suburb];
    for (let mi = 0; mi < MONTHS.length; mi++) {
      const month    = MONTHS[mi];
      const seasonal = SEASONAL[mi];
      for (const svc of SVC_TYPES) {
        const { frac, tonnesPerK } = SVC_PROFILE[svc];
        const cost        = Math.round(jitter(BASE_MONTHLY_COST * scale * seasonal * frac, 0.08));
        const tonnes      = Math.round(jitter((cost / 1000) * tonnesPerK, 0.10) * 10) / 10;
        const collections = Math.round(jitter(tonnes * 4, 0.05));
        // Contamination only applies to General Waste + Recycling
        const contam = ['General Waste','Recycling'].includes(svc)
          ? Math.round(jitter(contamBase, 0.12) * 10) / 10
          : null;
        wasteRows.push({ suburb, service_type: svc, month, financial_year: FY, tonnes, collections, contamination_rate: contam, cost });
      }
    }
  }

  for (const row of wasteRows) {
    await sql`
      INSERT INTO waste_records
        (organisation_id, uploaded_file_id, suburb, service_type, month, financial_year,
         tonnes, collections, contamination_rate, cost)
      VALUES (
        ${orgId}, ${fileId},
        ${row.suburb as string}, ${row.service_type as string},
        ${row.month as string}, ${row.financial_year as string},
        ${row.tonnes as number}, ${row.collections as number},
        ${row.contamination_rate as number | null},
        ${row.cost as number}
      )
    `;
  }

  // ── 2. Fleet metrics ───────────────────────────────────────────────────────

  const VEHICLES: { id: string; type: string; make: string; year: number; dept: string; driver: string }[] = [
    { id: 'TRK-001', type: 'Truck',    make: 'Iveco',     year: 2021, dept: 'Waste',  driver: 'D. Nguyen'    },
    { id: 'TRK-002', type: 'Truck',    make: 'MAN',       year: 2019, dept: 'Waste',  driver: 'B. Wilson'    },
    { id: 'TRK-003', type: 'Truck',    make: 'Iveco',     year: 2022, dept: 'Waste',  driver: 'A. Sharma'    },
    { id: 'VAN-001', type: 'Van',      make: 'Mercedes',  year: 2023, dept: 'Parks',  driver: 'C. Thompson'  },
    { id: 'VAN-002', type: 'Van',      make: 'Ford',      year: 2022, dept: 'Roads',  driver: 'R. Patel'     },
    { id: 'UTL-001', type: 'Ute',      make: 'Toyota',    year: 2020, dept: 'Fleet',  driver: 'J. Brown'     },
    { id: 'UTL-002', type: 'Ute',      make: 'Toyota',    year: 2023, dept: 'Parks',  driver: 'M. Davies'    },
    { id: 'GRD-001', type: 'Grader',   make: 'Caterpillar',year: 2018, dept: 'Roads', driver: 'S. O\'Brien'  },
  ];

  for (const v of VEHICLES) {
    const ageFactor = (2025 - v.year) / 10 + 1; // older vehicles cost more
    for (let mi = 0; mi < MONTHS.length; mi++) {
      const seasonal = SEASONAL[mi];
      const km          = Math.round(jitter(2800 * (v.type === 'Grader' ? 0.4 : 1) * seasonal, 0.15));
      const fuel        = Math.round(jitter(km * 0.42 * ageFactor, 0.12));
      const wages       = Math.round(jitter(5_800 * seasonal, 0.05));
      const maintenance = Math.round(jitter(480 * ageFactor * seasonal, 0.20));
      const rego        = mi === 0 ? Math.round(jitter(1_400, 0.05)) : 0; // annual in July
      const repairs     = Math.round(jitter(200 * ageFactor, 0.40));
      const insurance   = mi === 0 ? Math.round(jitter(1_800, 0.05)) : 0;
      const depreciation = Math.round(jitter(1_200 * ageFactor, 0.08));
      const services    = mi % 3 === 0 ? 1 : 0; // service every quarter
      const defects     = Math.random() < 0.12 * ageFactor ? Math.ceil(Math.random() * 2) : 0;

      await sql`
        INSERT INTO fleet_metrics
          (organisation_id, uploaded_file_id, vehicle_id, vehicle_type, make, year,
           department, driver, km, wages, fuel, maintenance, rego, repairs,
           insurance, depreciation, services, defects, month, financial_year)
        VALUES (
          ${orgId}, ${fileId},
          ${v.id}, ${v.type}, ${v.make}, ${v.year},
          ${v.dept}, ${v.driver},
          ${km}, ${wages}, ${fuel}, ${maintenance},
          ${rego}, ${repairs}, ${insurance}, ${depreciation},
          ${services}, ${defects},
          ${MONTHS[mi]}, ${FY}
        )
      `;
    }
  }

  // ── 3. Service requests ────────────────────────────────────────────────────

  const SR_TYPES    = ['Missed Bin','Graffiti Removal','Pothole Repair','Tree Maintenance','Street Light','Illegal Dumping','Noise Complaint','Footpath Repair'];
  const PRIORITIES  = ['High','Medium','Low'];
  const P_WEIGHTS   = [0.15, 0.50, 0.35]; // probability of each priority

  let srSeq = 1;
  for (let mi = 0; mi < MONTHS.length; mi++) {
    const count = Math.round(jitter(22, 0.25)); // ~22 SRs per month
    for (let i = 0; i < count; i++) {
      const suburb    = SUBURBS[Math.floor(Math.random() * SUBURBS.length)];
      const svcType   = SR_TYPES[Math.floor(Math.random() * SR_TYPES.length)];
      const rand      = Math.random();
      const priority  = rand < P_WEIGHTS[0] ? 'High' : rand < P_WEIGHTS[0] + P_WEIGHTS[1] ? 'Medium' : 'Low';
      const targetDays = priority === 'High' ? 3 : priority === 'Medium' ? 7 : 14;
      const daysOpen  = Math.round(jitter(targetDays, 0.40));
      const statusRand = Math.random();
      const status    = statusRand < 0.60 ? 'Closed' : statusRand < 0.80 ? 'Open' : 'Pending';
      const cost      = Math.round(jitter(priority === 'High' ? 380 : priority === 'Medium' ? 200 : 90, 0.35));

      await sql`
        INSERT INTO service_requests
          (organisation_id, uploaded_file_id, request_id, service_type, suburb, month,
           financial_year, status, priority, days_open, cost)
        VALUES (
          ${orgId}, ${fileId},
          ${`SR-${String(srSeq++).padStart(4,'0')}`},
          ${svcType}, ${suburb}, ${MONTHS[mi]}, ${FY},
          ${status}, ${priority}, ${daysOpen}, ${cost}
        )
      `;
    }
  }

  // ── Mark the seed file as covering all service types ──────────────────────
  await sql`
    UPDATE uploaded_files SET service_type = 'waste' WHERE id = ${fileId}
  `;

  // ── 4. KPI rules — seed defaults if none exist yet ────────────────────────
  // Each metric key must be unique per org; use severity suffix to distinguish warning/critical tiers
  const DEFAULT_RULES: { metric: string; operator: string; threshold: number; severity: string }[] = [
    { metric: 'contamination_rate.warning',  operator: 'gt', threshold:  8.0, severity: 'warning'  },
    { metric: 'contamination_rate.critical', operator: 'gt', threshold: 12.0, severity: 'critical' },
    { metric: 'cost_per_tonne.warning',      operator: 'gt', threshold: 155,  severity: 'warning'  },
    { metric: 'cost_per_tonne.critical',     operator: 'gt', threshold: 175,  severity: 'critical' },
    { metric: 'sr_resolution_rate.warning',  operator: 'lt', threshold:  75,  severity: 'warning'  },
    { metric: 'sr_resolution_rate.critical', operator: 'lt', threshold:  60,  severity: 'critical' },
    { metric: 'avg_days_open.warning',       operator: 'gt', threshold:   7,  severity: 'warning'  },
    { metric: 'avg_days_open.critical',      operator: 'gt', threshold:  14,  severity: 'critical' },
  ];

  for (const rule of DEFAULT_RULES) {
    await sql`
      INSERT INTO kpi_rules (organisation_id, metric, operator, threshold, severity)
      VALUES (${orgId}, ${rule.metric}, ${rule.operator}, ${rule.threshold}, ${rule.severity})
      ON CONFLICT (organisation_id, metric) DO NOTHING
    `;
  }

  return NextResponse.json({
    success: true,
    counts: {
      wasteRecords:     wasteRows.length,
      fleetMetrics:     VEHICLES.length * MONTHS.length,
      serviceRequests:  srSeq - 1,
    },
    message: `Demo data seeded: ${wasteRows.length} waste records, ${VEHICLES.length * MONTHS.length} fleet records, ${srSeq - 1} service requests.`,
  });
}
