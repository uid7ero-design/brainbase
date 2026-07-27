import { NextResponse } from 'next/server';
import { requireGlobalIntegrationAccess, integrationAccessErrorStatus } from '../../../../../lib/globalIntegrationAccess';
import { createOAuthState } from '../../../../../lib/oauthState';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export async function GET() {
  try {
    await requireGlobalIntegrationAccess('GMAIL_OWNER_ORG_ID', 'manager');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  const clientId    = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Missing GMAIL_CLIENT_ID or GMAIL_REDIRECT_URI in .env.local' },
      { status: 500 }
    );
  }

  const state = await createOAuthState('gmail_oauth_state');

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state,
  });

  return NextResponse.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  });
}
