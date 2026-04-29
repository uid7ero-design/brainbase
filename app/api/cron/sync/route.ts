import { NextResponse } from 'next/server';
import { runAllSyncs } from '@/lib/integrations/syncEngine';

/**
 * GET /api/cron/sync
 * Called nightly by Vercel Cron. Runs all enabled integrations.
 * Protected by CRON_SECRET env var.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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
