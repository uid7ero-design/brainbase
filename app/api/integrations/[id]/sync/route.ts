import { NextRequest, NextResponse } from 'next/server';
import { requireRole, unauthorized, forbidden } from '@/lib/org';
import { runSync } from '@/lib/integrations/syncEngine';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('manager'); } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'Forbidden') return forbidden();
    return unauthorized();
  }

  const { id } = await params;
  try {
    const result = await runSync(id, session.organisationId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
