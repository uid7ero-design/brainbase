import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import { encrypt } from '@/lib/social/crypto'
import { verifyOAuthState } from '@/lib/oauthState'
import { STATE_COOKIE } from '../connect/route'

const APP_ID = process.env.META_APP_ID!
const APP_SECRET = process.env.META_APP_SECRET!
const REDIRECT_URI = process.env.META_REDIRECT_URI!

export async function GET(req: NextRequest) {
  // Same role floor as the connect step — writing a new token is a
  // token-changing action, restricted to manager+.
  let session
  try {
    session = await requireRole('manager')
  } catch (err) {
    const insufficientRole = err instanceof Error && err.message === 'Forbidden'
    return NextResponse.redirect(
      insufficientRole
        ? new URL('/admin/founder?ig_error=Forbidden', req.url)
        : new URL('/login', req.url),
    )
  }

  // State is verified before the OAuth code is ever exchanged — a missing,
  // malformed, mismatched, or expired state all fail identically, and the
  // state cookie is consumed (one-time use) whether verification succeeds
  // or fails. Never log the state value itself.
  const providedState = req.nextUrl.searchParams.get('state')
  const stateOk = await verifyOAuthState(STATE_COOKIE, providedState)
  if (!stateOk) {
    console.error('[Instagram callback] OAuth state missing, malformed, mismatched, or expired')
    return NextResponse.redirect(new URL('/admin/founder?ig_error=invalid_state', req.url))
  }

  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error_description')
  if (!code) {
    return NextResponse.redirect(new URL(`/admin/founder?ig_error=${encodeURIComponent(error ?? 'Access denied')}`, req.url))
  }

  // Exchange code for short-lived user access token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${APP_SECRET}&code=${code}`
  )
  const tokenData = await tokenRes.json() as { access_token?: string; error?: { message: string } }
  if (!tokenData.access_token) {
    return NextResponse.redirect(new URL(`/admin/founder?ig_error=${encodeURIComponent(tokenData.error?.message ?? 'Token exchange failed')}`, req.url))
  }

  // Exchange for long-lived token (60 days)
  const longRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
  )
  const longData = await longRes.json() as { access_token?: string; expires_in?: number }
  const longToken = longData.access_token ?? tokenData.access_token
  const expiresAt = longData.expires_in
    ? new Date(Date.now() + longData.expires_in * 1000).toISOString()
    : null

  // Find connected Instagram Business Account via Facebook Pages
  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?access_token=${longToken}`
  )
  const pagesData = await pagesRes.json() as { data?: Array<{ id: string; access_token: string }> }

  let igAccountId: string | null = null
  let igUsername: string | null = null

  for (const page of pagesData.data ?? []) {
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
    )
    const igData = await igRes.json() as { instagram_business_account?: { id: string } }
    if (igData.instagram_business_account?.id) {
      igAccountId = igData.instagram_business_account.id
      // Get username
      const nameRes = await fetch(
        `https://graph.facebook.com/v21.0/${igAccountId}?fields=username&access_token=${longToken}`
      )
      const nameData = await nameRes.json() as { username?: string }
      igUsername = nameData.username ?? null
      break
    }
  }

  // Every new write is encrypted with the same AES-256-GCM helper the newer
  // social_accounts flow already uses (lib/social/crypto.ts) — no new
  // plaintext token is ever written here again. Existing rows written before
  // this fix remain plaintext at rest (see the read-side fallback in
  // /api/instagram/feed) — migrating them is a tracked follow-up, not
  // performed here (no uncontrolled production-data migration).
  const encryptedToken = encrypt(longToken)

  // Upsert into social_connections
  await sql`
    INSERT INTO social_connections (organisation_id, platform, access_token, token_expires_at, instagram_account_id, platform_username)
    VALUES (${session.organisationId}, 'instagram', ${encryptedToken}, ${expiresAt}, ${igAccountId}, ${igUsername})
    ON CONFLICT (organisation_id, platform)
    DO UPDATE SET
      access_token = EXCLUDED.access_token,
      token_expires_at = EXCLUDED.token_expires_at,
      instagram_account_id = EXCLUDED.instagram_account_id,
      platform_username = EXCLUDED.platform_username,
      updated_at = NOW()
  `

  return NextResponse.redirect(new URL('/admin/founder?ig_connected=1', req.url))
}
