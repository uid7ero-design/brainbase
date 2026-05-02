import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';

const SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_manage_comments',
  'pages_show_list',
  'pages_read_engagement',
].join(',');

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const appId = process.env.META_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: 'META_APP_ID is not configured. Enable demo mode instead.' }, { status: 503 });
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/social/callback`;

  const state = randomBytes(16).toString('hex');
  const cookieStore = await cookies();
  cookieStore.set('social_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  redirectUri,
    scope:         SCOPES,
    response_type: 'code',
    state,
  });

  return NextResponse.redirect(
    `https://www.facebook.com/v20.0/dialog/oauth?${params}`,
  );
}
