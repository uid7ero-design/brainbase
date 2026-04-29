import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { createToken } from '@/lib/tokens';
import { sendEmail, passwordResetEmail } from '@/lib/email';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = (body?.email as string)?.trim().toLowerCase();

  if (!email) return NextResponse.json({ error: 'email is required.' }, { status: 400 });

  // Rate-limit: 3 requests per 15 min per email
  if (!checkRateLimit(`pwd-reset:${email}`, 3, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const rows = await sql`SELECT id, name FROM users WHERE email = ${email} LIMIT 1`;
  const user = rows[0];

  // Always return success — never reveal whether the email exists
  if (!user) return NextResponse.json({ ok: true });

  const token = await createToken(user.id as string, 'reset', 60 * 60_000); // 1 hour
  const { subject, html } = passwordResetEmail(user.name as string, token);
  await sendEmail({ to: email, subject, html }).catch(err =>
    console.error('[forgot-password]', err),
  );

  return NextResponse.json({ ok: true });
}
