import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/org'
import sql from '@/lib/db'
import { decrypt } from '@/lib/social/crypto'

/**
 * Rows written after the Phase 0.5 fix are encrypted (see
 * /api/auth/instagram/callback). Rows written before it are still plaintext
 * — decrypt() throws on anything that isn't its own iv:tag:ciphertext hex
 * format, so a plaintext legacy token falls through to being used as-is.
 * This is a deliberate, documented backward-compatibility path, not a bug:
 * migrating existing rows is a tracked follow-up, not performed here.
 */
function decryptOrLegacyPlaintext(value: string): string {
  try {
    return decrypt(value)
  } catch {
    return value
  }
}

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await sql`
    SELECT access_token, instagram_account_id, platform_username
    FROM social_connections
    WHERE organisation_id = ${session.organisationId} AND platform = 'instagram'
    LIMIT 1
  `
  const conn = rows[0]
  if (!conn) return NextResponse.json({ connected: false })

  const { access_token, instagram_account_id, platform_username } = conn as {
    access_token: string
    instagram_account_id: string | null
    platform_username: string | null
  }

  if (!instagram_account_id) return NextResponse.json({ connected: true, posts: [], username: platform_username })

  const bearerToken = decryptOrLegacyPlaintext(access_token)
  const mediaRes = await fetch(
    `https://graph.facebook.com/v21.0/${instagram_account_id}/media?fields=id,caption,media_url,thumbnail_url,timestamp,permalink,media_type&limit=9&access_token=${bearerToken}`
  )
  const mediaData = await mediaRes.json() as { data?: unknown[]; error?: { message: string } }

  if (mediaData.error) {
    return NextResponse.json({ connected: true, error: mediaData.error.message, posts: [] })
  }

  return NextResponse.json({
    connected: true,
    username: platform_username,
    posts: mediaData.data ?? [],
  }, {
    headers: { 'Cache-Control': 'private, max-age=900' },
  })
}
