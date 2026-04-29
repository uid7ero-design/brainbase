import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { createToken } from '@/lib/tokens';
import { sendEmail, verificationEmail } from '@/lib/email';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = (body?.email as string)?.trim().toLowerCase();

  if (!email) return NextResponse.json({ error: 'email is required.' }, { status: 400 });

  // Rate-limit: 3 resends per 15 min per email
  if (!checkRateLimit(`resend:${email}`, 3, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const rows = await sql`
    SELECT id, name, email_verified FROM users WHERE email = ${email} LIMIT 1
  `;
  const user = rows[0];

  // Always return success to avoid user enumeration
  if (!user || user.email_verified) {
    return NextResponse.json({ ok: true });
  }

  const token = await createToken(user.id as string, 'verify', 24 * 60 * 60_000);
  const { subject, html } = verificationEmail(user.name as string, token);
  await sendEmail({ to: email, subject, html }).catch(err =>
    console.error('[resend-verification]', err),
  );

  return NextResponse.json({ ok: true });
}
