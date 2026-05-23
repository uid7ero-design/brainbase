import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/org'

export async function GET() {
  await requireSession()

  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth')
  url.searchParams.set('client_id', process.env.META_APP_ID!)
  url.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI!)
  url.searchParams.set('scope', 'instagram_basic,pages_show_list,pages_read_engagement')
  url.searchParams.set('response_type', 'code')

  return NextResponse.redirect(url.toString())
}
