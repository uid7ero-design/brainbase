import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import { getProductUsage } from '@/lib/founder/usageSignals';

// Founder OS Phase E.3 — real Product Usage aggregate. super_admin only,
// the same requireFounderSession() pattern used by every other founder/*
// route (app/api/founder/tasks/route.ts, app/api/founder/system/route.ts).
// No usage query executes until auth has succeeded.
//
// Returns aggregate counts only — no organisation ids, no user ids, no
// filenames, no author names, no briefing/insight content, no raw rows.
// All-or-nothing: getProductUsage() either resolves with every count or
// throws, in which case the frontend renders the same "Not connected"
// state as any other Founder OS panel's load failure — a query failure
// is never converted into a 0.

async function requireFounderSession() {
  const session = await getAuthSession();
  if (session.role !== 'super_admin') throw new Error('Forbidden');
  return session;
}

export async function GET() {
  try {
    await requireFounderSession();
  } catch (err) {
    const status = (err as Error).message === 'Forbidden' ? 403 : 401;
    return NextResponse.json({ error: (err as Error).message || 'Unauthorized' }, { status });
  }

  try {
    const usage = await getProductUsage();
    return NextResponse.json(usage);
  } catch (err) {
    console.error('[GET /api/founder/usage]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
