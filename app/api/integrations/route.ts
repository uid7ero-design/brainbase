import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, requireRole, unauthorized, forbidden } from '@/lib/org';
import { listConnectors } from '@/lib/integrations/registry';
import type { ConnectorId, TargetTable } from '@/lib/integrations/types';

const VALID_CONNECTORS = new Set<ConnectorId>(['rest', 'csv-url']);
const VALID_TABLES     = new Set<TargetTable>(['waste_records', 'fleet_metrics', 'service_requests']);

/** GET /api/integrations — list org integrations */
export async function GET() {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const rows = await sql`
    SELECT * FROM integrations
    WHERE organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `;
  return NextResponse.json({ integrations: rows, connectors: listConnectors().map(c => ({ id: c.id, label: c.label, description: c.description })) });
}

/** POST /api/integrations — create a new integration */
export async function POST(req: NextRequest) {
  let session;
  try { session = await requireRole('manager'); } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'Forbidden') return forbidden();
    return unauthorized();
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const { connector_id, name, config, target_table, schedule, enabled } = body;

  if (!VALID_CONNECTORS.has(connector_id as ConnectorId))
    return NextResponse.json({ error: 'Invalid connector_id.' }, { status: 400 });
  if (!VALID_TABLES.has(target_table as TargetTable))
    return NextResponse.json({ error: 'Invalid target_table.' }, { status: 400 });
  if (!name?.trim())
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  if (!config?.url?.trim())
    return NextResponse.json({ error: 'config.url is required.' }, { status: 400 });

  const rows = await sql`
    INSERT INTO integrations
      (organisation_id, connector_id, name, config, target_table, schedule, enabled)
    VALUES (
      ${session.organisationId},
      ${connector_id},
      ${name.trim()},
      ${JSON.stringify(config)},
      ${target_table},
      ${schedule ?? '0 2 * * *'},
      ${enabled ?? true}
    )
    RETURNING *
  `;
  return NextResponse.json({ integration: rows[0] }, { status: 201 });
}
