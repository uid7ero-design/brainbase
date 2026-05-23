import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/org'
import sql from '@/lib/db'

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

  const mediaRes = await fetch(
    `https://graph.facebook.com/v21.0/${instagram_account_id}/media?fields=id,caption,media_url,thumbnail_url,timestamp,permalink,media_type&limit=9&access_token=${access_token}`
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
