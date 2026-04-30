import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { headers } from 'next/headers';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
