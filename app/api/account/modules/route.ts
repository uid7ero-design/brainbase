import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const modules = await sql`
    SELECT
      m.key, m.name, m.industry, m.description, m.status,
      om.enabled, om.config
    FROM organisation_modules om
    JOIN modules m ON m.id = om.module_id
    WHERE om.organisation_id = ${session.organisationId}
    ORDER BY m.name
  `;

  return NextResponse.json({ modules });
}
