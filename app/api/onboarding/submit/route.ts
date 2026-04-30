import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await req.json() as { data: Record<string, unknown> };
  const orgId = session.organisationId;
  const userId = session.userId;

  // Update organisation record with info from step 1
  const org = data.org as { councilName?: string; contactEmail?: string } | undefined;
  if (org?.councilName) {
    await sql`
      UPDATE organisations
      SET name = ${org.councilName},
          contact_email = ${org.contactEmail ?? null}
      WHERE id = ${orgId}
    `;
  }

  // Persist waste column mappings to import_mappings
  const wasteMapping = data.wasteMapping as { mappings?: Record<string, string> } | undefined;
  if (wasteMapping?.mappings) {
    for (const [field, column] of Object.entries(wasteMapping.mappings)) {
      if (!column) continue;
      await sql`
        INSERT INTO import_mappings (organisation_id, service_type, raw_column, mapped_field, created_by, module_key)
        VALUES (${orgId}, 'waste', ${column}, ${field}, ${userId}, 'waste_recycling')
        ON CONFLICT (organisation_id, service_type, raw_column)
        DO UPDATE SET mapped_field = EXCLUDED.mapped_field
      `;
    }
  }

  // Persist fleet column mappings to import_mappings
  const fleetMapping = data.fleetMapping as { mappings?: Record<string, string> } | undefined;
  if (fleetMapping?.mappings) {
    for (const [field, column] of Object.entries(fleetMapping.mappings)) {
      if (!column) continue;
      await sql`
        INSERT INTO import_mappings (organisation_id, service_type, raw_column, mapped_field, created_by, module_key)
        VALUES (${orgId}, 'fleet', ${column}, ${field}, ${userId}, 'fleet_management')
        ON CONFLICT (organisation_id, service_type, raw_column)
        DO UPDATE SET mapped_field = EXCLUDED.mapped_field
      `;
    }
  }

  // Mark onboarding as complete
  await sql`
    INSERT INTO onboarding_progress (organisation_id, user_id, current_step, data, completed, completed_at)
    VALUES (${orgId}, ${userId}, 7, ${JSON.stringify(data)}::jsonb, true, NOW())
    ON CONFLICT (organisation_id)
    DO UPDATE SET
      current_step  = 7,
      data          = EXCLUDED.data,
      completed     = true,
      completed_at  = NOW(),
      updated_at    = NOW()
  `;

  return NextResponse.json({ ok: true });
}
