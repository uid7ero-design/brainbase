import { NextResponse } from 'next/server';

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
  'user-top-read',
  'user-read-email',
  'user-read-private',
].join(' ');

export async function GET() {
  const clientId   = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Missing SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI in .env.local' },
      { status: 500 }
    );
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    scope:         SCOPES,
    redirect_uri:  redirectUri,
    show_dialog:   'true',
  });

  return NextResponse.json({
    url: `https://accounts.spotify.com/authorize?${params}`,
  });
}
