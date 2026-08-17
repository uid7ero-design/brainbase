import { NextResponse } from 'next/server';
import { runAllSyncs } from '@/lib/integrations/syncEngine';
import { secureCompare } from '@/lib/secureCompare';

/**
 * GET /api/cron/sync
 * Called nightly by Vercel Cron. Runs all enabled integrations.
 * Protected by CRON_SECRET env var — fails closed: if the secret isn't
 * configured, the endpoint refuses every request rather than running
 * unauthenticated (an absent secret must never mean "open to anyone").
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/sync] CRON_SECRET is not configured — refusing all requests.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (!secureCompare(auth, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { total, errors } = await runAllSyncs();
    console.log(`[cron/sync] ran ${total} integrations, ${errors} errors`);
    return NextResponse.json({ success: true, total, errors });
  } catch (err) {
    console.error('[cron/sync] fatal:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
