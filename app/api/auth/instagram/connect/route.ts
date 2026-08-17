import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import { createOAuthState } from '@/lib/oauthState'

export const STATE_COOKIE = 'instagram_oauth_state'

export async function GET() {
  // Connecting a shared Instagram/Facebook account is a token-changing action —
  // require manager+, matching the pattern used for the Gmail/GCal/Spotify
  // integrations rather than allowing any authenticated viewer.
  try {
    await requireRole('manager')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const state = await createOAuthState(STATE_COOKIE)

  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth')
  url.searchParams.set('client_id', process.env.META_APP_ID!)
  url.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI!)
  url.searchParams.set('scope', 'instagram_basic,pages_show_list,pages_read_engagement')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
