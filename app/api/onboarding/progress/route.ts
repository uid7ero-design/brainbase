import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/org';
import sql from '@/lib/db';

function forbidden() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

export async function GET() {
  // SEC-1B3: was raw getSession() — the JWT-only claim, never revalidated
  // against the DB. requireSession() (lib/org.ts) re-reads the caller's
  // current role/organisation/status from the database on every call, so
  // a since-deactivated, since-reassigned, or deleted user's still-valid
  // JWT can no longer read/write onboarding progress under their old org.
  let session;
  try { session = await requireSession(); } catch { return forbidden(); }

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
  let session;
  try { session = await requireSession(); } catch { return forbidden(); }

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
