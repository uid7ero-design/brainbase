import sql from '@/lib/db';
import type { ConnectorConfig, Integration, RawRecord, SyncStatus, TargetTable } from './types';
import { getConnector } from './registry';

// ─── Column maps (mirrors /api/upload) ───────────────────────────────────────

const WASTE_MAP: Record<string, string> = {
  service_type: 'service_type', 'service type': 'service_type', service: 'service_type', stream: 'service_type',
  suburb: 'suburb', area: 'suburb', locality: 'suburb', zone: 'suburb',
  month: 'month', period: 'month',
  financial_year: 'financial_year', 'financial year': 'financial_year', fy: 'financial_year', year: 'financial_year',
  tonnes: 'tonnes', tonnage: 'tonnes', weight: 'tonnes',
  collections: 'collections', 'bin lifts': 'collections', lifts: 'collections',
  contamination_rate: 'contamination_rate', 'contamination rate': 'contamination_rate', contamination: 'contamination_rate',
  cost: 'cost', costs: 'cost', amount: 'cost', total: 'cost',
};

const FLEET_MAP: Record<string, string> = {
  asset: 'vehicle_id', id: 'vehicle_id', vehicle: 'vehicle_id', 'vehicle id': 'vehicle_id',
  type: 'vehicle_type', 'vehicle type': 'vehicle_type',
  make: 'make', year: 'year',
  department: 'department', dept: 'department',
  driver: 'driver',
  km: 'km', kilometres: 'km', kms: 'km', odometer: 'km',
  wages: 'wages', fuel: 'fuel', maintenance: 'maintenance', maint: 'maintenance',
  rego: 'rego', 'registration cost': 'rego',
  repairs: 'repairs', insurance: 'insurance', ins: 'insurance',
  depreciation: 'depreciation', depr: 'depreciation',
  services: 'services', defects: 'defects',
  month: 'month', period: 'month',
  financial_year: 'financial_year', 'financial year': 'financial_year', fy: 'financial_year',
};

const SR_MAP: Record<string, string> = {
  'request id': 'request_id', request_id: 'request_id', 'sr id': 'request_id', reference: 'request_id',
  'service type': 'service_type', service_type: 'service_type', type: 'service_type', category: 'service_type',
  suburb: 'suburb', area: 'suburb', locality: 'suburb',
  month: 'month', period: 'month',
  financial_year: 'financial_year', 'financial year': 'financial_year', fy: 'financial_year',
  status: 'status', state: 'status',
  priority: 'priority', urgency: 'priority',
  'days open': 'days_open', days: 'days_open', duration: 'days_open', days_open: 'days_open',
  cost: 'cost', costs: 'cost', amount: 'cost',
};

const TABLE_MAPS: Record<TargetTable, Record<string, string>> = {
  waste_records:    WASTE_MAP,
  fleet_metrics:    FLEET_MAP,
  service_requests: SR_MAP,
};

function normalise(k: string) { return k.trim().toLowerCase().replace(/\s+/g, ' '); }

function mapRow(raw: RawRecord, map: Record<string, string>): RawRecord {
  const out: RawRecord = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = map[normalise(k)];
    if (field) out[field] = v;
  }
  return out;
}

// Static value injection (financial_year / month from connector config)
function injectStatics(row: RawRecord, config: ConnectorConfig): RawRecord {
  const out = { ...row };
  if (config.financial_year && !out.financial_year) out.financial_year = config.financial_year;
  if (config.month && !out.month) out.month = config.month;
  return out;
}

// ─── Insert helpers (uploaded_file_id = null for connector-sourced data) ──────

async function insertWaste(records: RawRecord[], orgId: string) {
  for (const r of records) {
    await sql`
      INSERT INTO waste_records
        (organisation_id, service_type, suburb, month, financial_year,
         tonnes, collections, contamination_rate, cost)
      VALUES (
        ${orgId},
        ${(r.service_type as string) ?? null},
        ${(r.suburb as string) ?? null},
        ${(r.month as string) ?? null},
        ${(r.financial_year as string) ?? null},
        ${r.tonnes != null ? Number(r.tonnes) : null},
        ${r.collections != null ? Math.round(Number(r.collections)) : null},
        ${r.contamination_rate != null ? Number(r.contamination_rate) : null},
        ${r.cost != null ? Number(r.cost) : null}
      )
    `;
  }
}

async function insertFleet(records: RawRecord[], orgId: string) {
  for (const r of records) {
    await sql`
      INSERT INTO fleet_metrics
        (organisation_id, vehicle_id, vehicle_type, make, year, department, driver,
         km, wages, fuel, maintenance, rego, repairs, insurance, depreciation,
         services, defects, month, financial_year)
      VALUES (
        ${orgId},
        ${(r.vehicle_id as string) ?? null},
        ${(r.vehicle_type as string) ?? null},
        ${(r.make as string) ?? null},
        ${r.year != null ? Math.round(Number(r.year)) : null},
        ${(r.department as string) ?? null},
        ${(r.driver as string) ?? null},
        ${r.km != null ? Number(r.km) : null},
        ${r.wages != null ? Number(r.wages) : null},
        ${r.fuel != null ? Number(r.fuel) : null},
        ${r.maintenance != null ? Number(r.maintenance) : null},
        ${r.rego != null ? Number(r.rego) : null},
        ${r.repairs != null ? Number(r.repairs) : null},
        ${r.insurance != null ? Number(r.insurance) : null},
        ${r.depreciation != null ? Number(r.depreciation) : null},
        ${r.services != null ? Math.round(Number(r.services)) : null},
        ${r.defects != null ? Math.round(Number(r.defects)) : null},
        ${(r.month as string) ?? null},
        ${(r.financial_year as string) ?? null}
      )
    `;
  }
}

async function insertServiceRequests(records: RawRecord[], orgId: string) {
  for (const r of records) {
    await sql`
      INSERT INTO service_requests
        (organisation_id, request_id, service_type, suburb, month,
         financial_year, status, priority, days_open, cost)
      VALUES (
        ${orgId},
        ${(r.request_id as string) ?? null},
        ${(r.service_type as string) ?? null},
        ${(r.suburb as string) ?? null},
        ${(r.month as string) ?? null},
        ${(r.financial_year as string) ?? null},
        ${(r.status as string) ?? null},
        ${(r.priority as string) ?? null},
        ${r.days_open != null ? Math.round(Number(r.days_open)) : null},
        ${r.cost != null ? Number(r.cost) : null}
      )
    `;
  }
}

// ─── Snapshot capture ─────────────────────────────────────────────────────────

async function captureSnapshot(orgId: string, dataType: string) {
  let metrics: Record<string, unknown> = {};

  if (dataType === 'waste') {
    const rows = await sql`
      SELECT service_type,
             SUM(tonnes)             AS total_tonnes,
             AVG(contamination_rate) AS avg_contamination,
             SUM(collections)        AS total_collections,
             SUM(cost)               AS total_cost,
             COUNT(*)                AS record_count
      FROM waste_records
      WHERE organisation_id = ${orgId}
      GROUP BY service_type
    `;
    metrics = { by_service_type: rows };
  } else if (dataType === 'fleet') {
    const rows = await sql`
      SELECT COUNT(DISTINCT vehicle_id) AS vehicle_count,
             SUM(km)          AS total_km,
             SUM(fuel)        AS total_fuel,
             SUM(maintenance) AS total_maintenance,
             SUM(wages)       AS total_wages,
             SUM(defects)     AS total_defects
      FROM fleet_metrics
      WHERE organisation_id = ${orgId}
    `;
    metrics = rows[0] ?? {};
  } else if (dataType === 'service_requests') {
    const rows = await sql`
      SELECT status,
             COUNT(*)          AS count,
             AVG(days_open)    AS avg_days_open,
             SUM(cost)         AS total_cost
      FROM service_requests
      WHERE organisation_id = ${orgId}
      GROUP BY status
    `;
    metrics = { by_status: rows };
  }

  await sql`
    INSERT INTO data_snapshots (organisation_id, data_type, metrics)
    VALUES (${orgId}, ${dataType}, ${JSON.stringify(metrics)})
    ON CONFLICT (organisation_id, snapshot_date, data_type)
    DO UPDATE SET metrics = EXCLUDED.metrics
  `;
}

function tableToDataType(t: TargetTable): string {
  if (t === 'waste_records')    return 'waste';
  if (t === 'fleet_metrics')    return 'fleet';
  return 'service_requests';
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runSync(integrationId: string, orgId: string): Promise<{
  recordsSynced: number;
  jobId: string;
}> {
  // 1. Load integration
  const rows = await sql`
    SELECT * FROM integrations
    WHERE id = ${integrationId} AND organisation_id = ${orgId}
  `;
  if (!rows.length) throw new Error('Integration not found.');
  const integration = rows[0] as unknown as Integration;
  if (!integration.enabled) throw new Error('Integration is disabled.');

  // 2. Mark running
  const jobRows = await sql`
    INSERT INTO sync_jobs (integration_id, organisation_id, status)
    VALUES (${integrationId}, ${orgId}, 'running')
    RETURNING id
  `;
  const jobId: string = jobRows[0].id;

  await sql`
    UPDATE integrations
    SET last_sync_status = 'running'
    WHERE id = ${integrationId}
  `;

  try {
    // 3. Fetch records via connector
    const connector = getConnector(integration.connector_id);
    const raw = await connector.fetch(integration.config as ConnectorConfig);

    // 4. Map + inject statics
    const colMap = TABLE_MAPS[integration.target_table];
    const records = raw
      .map(r => mapRow(r, colMap))
      .map(r => injectStatics(r, integration.config as ConnectorConfig));

    // 5. Insert
    if (integration.target_table === 'waste_records')    await insertWaste(records, orgId);
    else if (integration.target_table === 'fleet_metrics') await insertFleet(records, orgId);
    else                                                   await insertServiceRequests(records, orgId);

    // 6. Snapshot
    await captureSnapshot(orgId, tableToDataType(integration.target_table));

    // 7. Update integration status
    await sql`
      UPDATE integrations
      SET last_synced_at    = NOW(),
          last_sync_status  = 'success',
          last_sync_count   = ${records.length}
      WHERE id = ${integrationId}
    `;

    // 8. Close job
    await sql`
      UPDATE sync_jobs
      SET completed_at   = NOW(),
          status         = 'success',
          records_synced = ${records.length}
      WHERE id = ${jobId}
    `;

    return { recordsSynced: records.length, jobId };
  } catch (err) {
    const msg = (err as Error).message;

    await sql`
      UPDATE integrations
      SET last_sync_status = 'error'
      WHERE id = ${integrationId}
    `;
    await sql`
      UPDATE sync_jobs
      SET completed_at  = NOW(),
          status        = 'error',
          error_message = ${msg}
      WHERE id = ${jobId}
    `;

    throw err;
  }
}

// ─── Run all enabled integrations for an org (used by cron) ──────────────────

export async function runAllSyncs(orgId?: string): Promise<{ total: number; errors: number }> {
  const rows = orgId
    ? await sql`SELECT id, organisation_id FROM integrations WHERE enabled = true AND organisation_id = ${orgId}`
    : await sql`SELECT id, organisation_id FROM integrations WHERE enabled = true`;

  let errors = 0;
  for (const row of rows) {
    try {
      await runSync(row.id as string, row.organisation_id as string);
    } catch (err) {
      console.error(`[sync] integration ${row.id} failed:`, (err as Error).message);
      errors++;
    }
  }
  return { total: rows.length, errors };
}
