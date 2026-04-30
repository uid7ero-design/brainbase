import { NextResponse } from 'next/server';
import { deleteSession } from '@/lib/session';

// POST — called by sendBeacon in secure mode on tab close,
// and by the standard logout flow as a fetch-based alternative.
export async function POST() {
  await deleteSession();
  return NextResponse.json({ ok: true });
}
