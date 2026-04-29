import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { consumeToken } from '@/lib/tokens';

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';

  if (!token) {
    return NextResponse.redirect(`${APP}/verify-email?status=invalid`);
  }

  const userId = await consumeToken(token, 'verify');

  if (!userId) {
    return NextResponse.redirect(`${APP}/verify-email?status=invalid`);
  }

  await sql`
    UPDATE users
    SET email_verified = true, email_verified_at = NOW()
    WHERE id = ${userId}
  `;

  return NextResponse.redirect(`${APP}/verify-email?status=success`);
}
