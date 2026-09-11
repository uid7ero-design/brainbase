import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { headers } from 'next/headers';
import sql from '@/lib/db';
import { requireSession } from '@/lib/org';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  // SEC-1B3: was raw getSession() — the JWT-only claim, never revalidated
  // against the DB. This route re-verifies the CURRENT session's own
  // password (a client-side "lock screen" re-entry, not a pre-auth flow —
  // a valid, already-established session cookie is a precondition either
  // way), so requireSession() applies safely here: a since-deactivated,
  // since-deleted, or since-reassigned user's still-valid JWT can no
  // longer "unlock" under their old identity, even if they somehow still
  // know their own password. The route's own existing password_hash
  // lookup/bcrypt check below is unchanged.
  let session;
  try { session = await requireSession(); } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  // Rate limit: 5 attempts per 15 min per user
  const ip = ((await headers()).get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  if (!checkRateLimit(`verify-lock:${session.userId}:${ip}`, 5, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const { password } = body as { password?: string };

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password required.' }, { status: 400 });
  }

  const rows = await sql`SELECT password_hash FROM users WHERE id = ${session.userId} LIMIT 1`;
  if (!rows[0]) {
    return NextResponse.json({ error: 'User not found.' }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, rows[0].password_hash as string);
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
