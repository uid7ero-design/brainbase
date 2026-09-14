import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { logHrEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';

// HR-2 Step 1B — retires a team without deleting it: sets archived_at,
// leaving every hr_people.team_id reference to it completely untouched
// (a person who was on this team when it was archived stays on it;
// only a NEW assignment onto an archived team is rejected — see
// app/api/hr/people/route.ts and app/api/hr/people/[id]/route.ts).
// Mirrors app/api/dashboard/sessions/[id]/archive/route.ts's own
// already-shipped archived_at pattern: archiving an already-archived
// team is a 409 (already_archived), not a silent idempotent success,
// and writes no audit event.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId, role: session.role });
  if (!ctx.isHrAdministrator) return forbidden();

  // organisation_id is part of the WHERE clause, not applied after the
  // fact — a valid team id from a DIFFERENT organisation returns zero
  // rows, indistinguishable from a non-existent id.
  const existingRows = await sql`
    SELECT id, archived_at FROM hr_teams WHERE id = ${id}::uuid AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  const existing = existingRows[0] as { id: string; archived_at: string | null } | undefined;
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (existing.archived_at !== null) {
    return NextResponse.json({ error: 'Team is already archived.', code: 'already_archived' }, { status: 409 });
  }

  let rows;
  try {
    rows = await sql`
      UPDATE hr_teams SET archived_at = NOW(), updated_at = NOW()
      WHERE id = ${id}::uuid AND organisation_id = ${session.organisationId}
      RETURNING archived_at
    `;
  } catch (err) {
    console.error('[hr/teams/[id]/archive POST] update failed', err);
    return NextResponse.json({ error: 'Could not archive team.' }, { status: 500 });
  }

  const archivedAt = (rows[0] as { archived_at: string }).archived_at;

  {
    const { ipAddress, userAgent } = extractRequestMeta(req);
    await logHrEvent(
      { organisationId: session.organisationId, userId: session.userId, ipAddress, userAgent },
      {
        action: 'hr_team.archived',
        resourceType: 'hr_team',
        resourceId: id,
        beforeState: { archived_at: null },
        afterState: { archived_at: archivedAt },
      },
    );
  }

  return NextResponse.json({ archived: true });
}
