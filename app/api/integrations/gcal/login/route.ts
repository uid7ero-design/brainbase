import { NextResponse } from 'next/server';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export async function GET() {
  const clientId    = process.env.GCAL_CLIENT_ID;
  const redirectUri = process.env.GCAL_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Missing GCAL_CLIENT_ID or GCAL_REDIRECT_URI in .env.local' },
      { status: 500 }
    );
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
  });

  return NextResponse.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  });
}
