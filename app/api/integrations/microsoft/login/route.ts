import { NextResponse } from 'next/server';
import { requireGlobalIntegrationAccess, integrationAccessErrorStatus } from '@/lib/globalIntegrationAccess';
import { createOAuthState } from '@/lib/oauthState';
import { MS365_SCOPES } from '@/lib/microsoft/tokens';

// Founder OS Phase E.5A — starts the Microsoft identity platform OAuth
// authorization-code flow for BrainBase's single, global Microsoft 365
// business connection. Same access boundary as Gmail/GCal login
// ('manager'+, or super_admin unconditionally) — initiating a NEW
// connection is a higher-trust action than merely checking status.
//
// Single-tenant by construction: the authorize URL is built against
// https://login.microsoftonline.com/{OUR_OWN_TENANT_ID}/... (never the
// multi-tenant /common/ or /organizations/ endpoint), so Microsoft can
// only ever issue a code/token for BrainBase's own configured tenant —
// there is no caller-supplied tenant to validate against, by design.
export async function GET() {
  try {
    await requireGlobalIntegrationAccess('MS365_OWNER_ORG_ID', 'manager');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  const tenantId = process.env.MS365_TENANT_ID;
  const clientId = process.env.MS365_CLIENT_ID;
  const redirectUri = process.env.MS365_REDIRECT_URI;
  if (!tenantId || !clientId || !redirectUri) {
    return NextResponse.json({ error: 'Microsoft 365 integration is not configured' }, { status: 500 });
  }

  const state = await createOAuthState('ms365_oauth_state');

  const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('scope', MS365_SCOPES);
  authUrl.searchParams.set('state', state);

  return NextResponse.redirect(authUrl.toString());
}
