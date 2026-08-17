import { NextResponse } from 'next/server';
import { requireGlobalIntegrationAccess, integrationAccessErrorStatus } from '../../../../lib/globalIntegrationAccess';
import { createOAuthState } from '../../../../lib/oauthState';

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
  try {
    await requireGlobalIntegrationAccess('SPOTIFY_OWNER_ORG_ID', 'viewer');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  const clientId   = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Missing SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI in .env.local' },
      { status: 500 }
    );
  }

  const state = await createOAuthState('spotify_oauth_state');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    scope:         SCOPES,
    redirect_uri:  redirectUri,
    show_dialog:   'true',
    state,
  });

  return NextResponse.json({
    url: `https://accounts.spotify.com/authorize?${params}`,
  });
}
