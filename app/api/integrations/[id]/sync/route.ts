import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/org';
import { runSync } from '@/lib/integrations/syncEngine';

/** POST /api/integrations/[id]/sync — manually trigger a sync */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const { id } = await params;
  try {
    const result = await runSync(id, session.organisationId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
