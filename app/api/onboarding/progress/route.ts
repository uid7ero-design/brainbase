import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await sql`
    SELECT current_step, data, completed FROM onboarding_progress
    WHERE organisation_id = ${session.organisationId}
    LIMIT 1
  `;

  if (!rows.length) return NextResponse.json({ currentStep: 1, data: {}, completed: false });

  const row = rows[0];
  return NextResponse.json({ currentStep: row.current_step, data: row.data, completed: row.completed });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { currentStep, data } = await req.json();

  await sql`
    INSERT INTO onboarding_progress (organisation_id, user_id, current_step, data)
    VALUES (${session.organisationId}, ${session.userId}, ${currentStep}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (organisation_id)
    DO UPDATE SET
      current_step = EXCLUDED.current_step,
      data         = EXCLUDED.data,
      updated_at   = NOW()
  `;

  return NextResponse.json({ ok: true });
}
