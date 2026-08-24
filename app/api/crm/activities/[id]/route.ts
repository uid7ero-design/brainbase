import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'crm');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify CRM access.' }, { status: 503 });
    return forbidden();
  }
  const { id } = await params;

  await sql`DELETE FROM crm_activities WHERE id = ${id} AND organisation_id = ${session.organisationId}`;
  return NextResponse.json({ success: true });
}
