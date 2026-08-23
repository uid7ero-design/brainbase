import { NextRequest, NextResponse } from 'next/server';
import { requireGlobalIntegrationAccess } from '@/lib/globalIntegrationAccess';
import { verifyOAuthState } from '@/lib/oauthState';
import { writeConnection, MS365_SCOPES } from '@/lib/microsoft/tokens';

// Founder OS Phase E.5A — Microsoft OAuth callback. Exchanges the
// authorization code for tokens, performs the smallest possible Graph
// identity check (/me — email/userPrincipalName only), and stores the
// result via writeConnection() (encrypted, Neon-backed — see
// lib/microsoft/tokens.ts). Deliberately does NOT fetch calendar
// events, mail, contacts, or files — E.5A is connection status only.
//
// Redirects to /admin/founder (Founder OS's own page) rather than the
// generic /dashboard Gmail/GCal redirect to — this route is Founder-OS-
// specific, so landing the founder back in the exact context they
// started from is a small, self-contained improvement scoped only to
// this new route; Gmail/GCal's own callback is untouched.
export async function GET(req: NextRequest) {
  const founderOS = new URL('/admin/founder', req.url).toString();

  try {
    await requireGlobalIntegrationAccess('MS365_OWNER_ORG_ID', 'manager');
  } catch {
    return NextResponse.redirect(`${founderOS}?ms_error=unauthorized`);
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  const stateOk = await verifyOAuthState('ms365_oauth_state', state);
  if (!stateOk) {
    console.error('[MS365 callback] OAuth state missing or mismatched');
    return NextResponse.redirect(`${founderOS}?ms_error=invalid_state`);
  }

  if (error || !code) {
    console.error('[MS365 callback] error:', error);
    return NextResponse.redirect(`${founderOS}?ms_error=oauth_failed`);
  }

  const tenantId = process.env.MS365_TENANT_ID;
  const clientId = process.env.MS365_CLIENT_ID;
  const clientSecret = process.env.MS365_CLIENT_SECRET;
  const redirectUri = process.env.MS365_REDIRECT_URI;
  if (!tenantId || !clientId || !clientSecret || !redirectUri) {
    console.error('[MS365 callback] Microsoft 365 integration is not configured');
    return NextResponse.redirect(`${founderOS}?ms_error=not_configured`);
  }

  let tokenRes: Response;
  try {
    tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        scope: MS365_SCOPES,
      }),
    });
  } catch (err) {
    console.error('[MS365 callback] token exchange request failed:', (err as Error).message);
    return NextResponse.redirect(`${founderOS}?ms_error=token_exchange_failed`);
  }

  if (!tokenRes.ok) {
    console.error('[MS365 callback] token exchange failed:', tokenRes.status);
    return NextResponse.redirect(`${founderOS}?ms_error=token_exchange_failed`);
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json() as {
    access_token?: string; refresh_token?: string; expires_in?: number;
  };
  if (!access_token || !refresh_token) {
    console.error('[MS365 callback] token response missing access_token/refresh_token');
    return NextResponse.redirect(`${founderOS}?ms_error=token_exchange_failed`);
  }

  // Smallest possible Graph identity check — /me only, never
  // calendar/mail/contacts/files. Failure here doesn't abort the
  // connection; it just leaves accountEmail blank rather than losing
  // the whole connection over a non-essential identity lookup.
  let accountEmail = '';
  try {
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json() as { mail?: string; userPrincipalName?: string };
      accountEmail = me.mail ?? me.userPrincipalName ?? '';
    }
  } catch (err) {
    console.warn('[MS365 callback] identity check failed:', (err as Error).message);
  }

  await writeConnection({
    accountEmail,
    tenantId,
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: Date.now() + (expires_in ?? 3600) * 1000,
  });

  return NextResponse.redirect(`${founderOS}?ms_connected=1`);
}
