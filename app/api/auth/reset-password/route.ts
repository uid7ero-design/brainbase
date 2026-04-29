import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { consumeToken } from '@/lib/tokens';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { token, password } = body ?? {};

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token is required.' }, { status: 400 });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters.' }, { status: 400 });
  }

  const userId = await consumeToken(token, 'reset');

  if (!userId) {
    return NextResponse.json(
      { error: 'This reset link is invalid or has expired. Please request a new one.' },
      { status: 400 },
    );
  }

  const hash = await bcrypt.hash(password, 12);

  await sql`
    UPDATE users
    SET password_hash = ${hash},
        email_verified = true,
        email_verified_at = COALESCE(email_verified_at, NOW())
    WHERE id = ${userId}
  `;

  return NextResponse.json({ ok: true });
}
