import { NextRequest, NextResponse } from 'next/server';
import { writeTokens } from '../../../../lib/spotify/tokens';
import { requireGlobalIntegrationAccess } from '../../../../lib/globalIntegrationAccess';
import { verifyOAuthState } from '../../../../lib/oauthState';

export async function GET(req: NextRequest) {
  const dashboard = new URL('/dashboard', req.url).toString();

  try {
    await requireGlobalIntegrationAccess('SPOTIFY_OWNER_ORG_ID', 'viewer');
  } catch {
    return NextResponse.redirect(`${dashboard}?error=unauthorized`);
  }

  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  const stateOk = await verifyOAuthState('spotify_oauth_state', state);
  if (!stateOk) {
    console.error('[Spotify callback] OAuth state missing or mismatched');
    return NextResponse.redirect(`${dashboard}?error=invalid_state`);
  }

  if (error || !code) {
    console.error('[Spotify callback] error:', error);
    return NextResponse.redirect(dashboard);
  }

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    }),
  });

  if (!tokenRes.ok) {
    console.error('[Spotify callback] token exchange failed:', tokenRes.status);
    return NextResponse.redirect(dashboard);
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json();

  writeTokens({
    access_token,
    refresh_token,
    expires_at: Date.now() + (expires_in ?? 3600) * 1000,
  });

  return NextResponse.redirect(dashboard);
}
