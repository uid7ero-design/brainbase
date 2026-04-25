import { NextRequest, NextResponse } from 'next/server';
import { writeTokens } from '../../../../../lib/gmail/tokens';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const error = searchParams.get('error');
  const dashboard = new URL('/dashboard', req.url).toString();

  if (error || !code) {
    console.error('[Gmail callback] error:', error);
    return NextResponse.redirect(dashboard);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri:  process.env.GMAIL_REDIRECT_URI!,
      client_id:     process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
    }),
  });

  if (!tokenRes.ok) {
    console.error('[Gmail callback] token exchange failed:', tokenRes.status);
    return NextResponse.redirect(dashboard);
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json();

  // Fetch user email for display
  let email: string | undefined;
  try {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const user = await userRes.json();
    email = user.email;
  } catch {}

  writeTokens({
    access_token,
    refresh_token,
    expires_at: Date.now() + (expires_in ?? 3600) * 1000,
    email,
  });

  return NextResponse.redirect(dashboard);
}
