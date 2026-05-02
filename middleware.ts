import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt, encrypt, SESSION_LIFETIME_MS, REFRESH_THRESHOLD_MS, COOKIE_OPTIONS } from '@/lib/session';

const PUBLIC = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/terms',
  '/privacy',
  '/pricing',
  '/demo',
  '/',
  '/tennis',
  '/api/auth',   // all /api/auth/* routes are public
  '/api/lead',
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const token = req.cookies.get('session')?.value;
  const session = await decrypt(token);

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // /admin — super_admin only
  if (pathname.startsWith('/admin') && session.role !== 'super_admin') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  // /command — manager, admin, super_admin only (not viewer)
  const COMMAND_ROLES = ['manager', 'admin', 'super_admin'];
  if (pathname.startsWith('/command') && !COMMAND_ROLES.includes(session.role)) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  const res = NextResponse.next();

  // Sliding refresh: re-issue cookie if within 2h of expiry
  const expiresAt = new Date(session.expiresAt);
  const msRemaining = expiresAt.getTime() - Date.now();
  if (msRemaining > 0 && msRemaining < REFRESH_THRESHOLD_MS) {
    const newExpiry = new Date(Date.now() + SESSION_LIFETIME_MS);
    const newToken = await encrypt({ ...session, expiresAt: newExpiry.toISOString() });
    res.cookies.set('session', newToken, COOKIE_OPTIONS(newExpiry));
  }

  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:webp|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|mp3|mp4)$).*)'],
};
