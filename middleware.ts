import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/session';

const PUBLIC = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/terms',
  '/privacy',
  '/',
  '/api/auth',   // all /api/auth/* routes are public
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
    return NextResponse.redirect(new URL('/dashboard/overview', req.url));
  }

  // /command — manager, admin, super_admin only (not viewer)
  const COMMAND_ROLES = ['manager', 'admin', 'super_admin'];
  if (pathname.startsWith('/command') && !COMMAND_ROLES.includes(session.role)) {
    return NextResponse.redirect(new URL('/dashboard/overview', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:webp|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|mp3|mp4)$).*)'],
};
