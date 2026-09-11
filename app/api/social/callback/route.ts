import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/org';
import { cookies } from 'next/headers';
import sql from '@/lib/db';
import { exchangeCodeForToken, getLongLivedToken, getConnectedIGAccount } from '@/lib/social/instagram';
import { encrypt } from '@/lib/social/crypto';

export async function GET(req: NextRequest) {
  // SEC-1B3: was raw getSession() — the JWT-only claim, never revalidated
  // against the DB. This is the browser's OAuth redirect BACK to our own
  // domain — our own session cookie travels with it exactly like any
  // other same-site GET navigation, so this is not a pre-auth state; the
  // caller must already have a fully-established session, same
  // precondition getSession() already required. The separate
  // social_oauth_state cookie below is the OAuth handshake's own CSRF
  // check and is unrelated to (and unaffected by) this session check.
  // requireSession() (lib/org.ts) re-reads the caller's current role/
  // organisation/status from the database on every call, so a since-
  // deactivated, since-reassigned, or deleted user's still-valid JWT can
  // no longer complete this connection under their old org — same
  // fallback (redirect to /login) as before, gated first, before any
  // state/code parsing or external token exchange.
  let session;
  try { session = await requireSession(); } catch { return NextResponse.redirect(new URL('/login', req.url)); }

  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/dashboard/social?error=oauth_denied', req.url));
  }

  const cookieStore = await cookies();
  const savedState  = cookieStore.get('social_oauth_state')?.value;
  cookieStore.delete('social_oauth_state');

  if (!state || state !== savedState) {
    return NextResponse.redirect(new URL('/dashboard/social?error=invalid_state', req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/dashboard/social?error=no_code', req.url));
  }

  try {
    const origin      = new URL(req.url).origin;
    const redirectUri = `${origin}/api/social/callback`;

    const { access_token: shortToken } = await exchangeCodeForToken(code, redirectUri);
    const { access_token: longToken, expires_in } = await getLongLivedToken(shortToken);

    const account = await getConnectedIGAccount(longToken);
    if (!account) {
      return NextResponse.redirect(new URL('/dashboard/social?error=no_ig_account', req.url));
    }

    const encryptedToken = encrypt(longToken);
    const expiresAt      = expires_in
      ? new Date(Date.now() + expires_in * 1000).toISOString()
      : null;

    await sql`
      INSERT INTO social_accounts
        (organisation_id, platform, account_name, account_id, access_token_encrypted, token_expires_at, connected_at, updated_at)
      VALUES
        (${session.organisationId}::uuid, 'instagram', ${account.name}, ${account.id},
         ${encryptedToken}, ${expiresAt}::timestamptz, NOW(), NOW())
      ON CONFLICT (organisation_id, platform, account_id)
      DO UPDATE SET
        account_name           = EXCLUDED.account_name,
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        token_expires_at       = EXCLUDED.token_expires_at,
        updated_at             = NOW()
    `;

    return NextResponse.redirect(new URL('/dashboard/social?connected=1', req.url));
  } catch (err) {
    console.error('[social/callback]', err);
    return NextResponse.redirect(new URL('/dashboard/social?error=connect_failed', req.url));
  }
}
