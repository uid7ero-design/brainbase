import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSession, refreshSession } from '@/lib/session';

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await sql`UPDATE users SET last_seen_at = NOW() WHERE id = ${session.userId}`.catch(() => {});
  const ok = await refreshSession();

  return NextResponse.json({ ok, expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() });
}
