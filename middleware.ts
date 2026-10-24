import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import sql from '@/lib/db';
import { managedRequestAllowed, moduleForPath } from '@/lib/organisationUsers/policy';
import {
  decrypt,
  encrypt,
  SESSION_LIFETIME_MS,
  REFRESH_THRESHOLD_MS,
  COOKIE_OPTIONS,
  roleGte,
  type Role,
} from '@/lib/session';

const PUBLIC = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/accept-invitation',
  '/verify-email',
  '/terms',
  '/privacy',
  '/pricing',
  '/demo',
  '/',
  '/tennis',
  '/web-systems',
  '/api/auth',
  '/api/lead',

  // Main client-operations pages
  '/client-operations',

  // Legacy redirects kept public
  '/for-coaches',

  '/request-demo',
  '/api/request-demo',

  // Business-card QR landing page
  '/connect',

  // Public Events & Ticketing Phase 2: /e/[organisationSlug]/[eventSlug]
  // — deliberately a namespace of its own, NOT '/events'. The
  // authenticated staff management UI already lives at '/events' and
  // '/events/[id]' (Phase 1); this array is matched by exact-path OR
  // prefix (`pathname === p || pathname.startsWith(p + '/')`), so
  // adding '/events' itself as a public prefix would also make the
  // staff management pages public. '/e' cannot collide with '/events'
  // under that same prefix rule, by construction.
  '/e',

  // Public Events & Ticketing Phase 3: /t/[ticketToken] — the digital
  // ticket page. Same reasoning as '/e' above: a deliberately separate
  // one-character prefix, chosen specifically so it cannot collide with
  // (or accidentally expose) '/events' or any staff management route —
  // see the Phase 3 report's public-route-safety section.
  '/t',

  // Booking-level multi-ticket wallet: /b/[bookingToken]/tickets — same
  // one-character-prefix reasoning as '/e' and '/t' above, and cannot
  // collide with either of them or with '/events'.
  '/b',
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');
  // Service/public endpoints retain their own authentication. They never derive
  // a staff identity or grant from this permission layer.
  if (pathname.startsWith('/api/cron/') || pathname.startsWith('/api/public/')) return NextResponse.next();
  if (!isApi && /^\/(Brand|brand|images|fonts|avatars)\//.test(pathname)) return NextResponse.next();
  const hostname = req.headers.get('host') ?? '';

  // ldtennis.com.au root → tennis landing page
  if (
    (
      hostname === 'ldtennis.com.au' ||
      hostname === 'www.ldtennis.com.au'
    ) &&
    pathname === '/'
  ) {
    return NextResponse.redirect(
      new URL('/tennis', req.url),
    );
  }

  // Public routes
  if (
    PUBLIC.some(
      p =>
        pathname === p ||
        pathname.startsWith(p + '/'),
    )
  ) {
    return NextResponse.next();
  }

  const token =
    req.cookies.get('session')?.value;

  const session = await decrypt(token);

  if (!session) {
    if (isApi) return NextResponse.next(); // existing route owns its 401/public contract
    const url = req.nextUrl.clone();
    url.pathname = '/login';

    return NextResponse.redirect(url);
  }

  // Phase C1.6: session.role is an unvalidated string from a decrypted JWT
  // (it can, in principle, hold any string — including 'analyst', which the
  // real DB enum can produce but which app/session.ts's Role type only
  // recently learned to recognise; see that file's own comment). Cast to
  // Role for roleGte()'s type signature only — its actual runtime safety
  // comes from failing closed (false) for anything not in ROLE_ORDER, the
  // same guarantee requireRole()/lib/org.ts's server-side checks rely on.
  let role = (session.role?.toLowerCase() ?? '') as Role;
  try {
    const users = await sql`SELECT role,status,organisation_id FROM users WHERE id=${session.userId} LIMIT 1`;
    const current = users[0];
    if (!current || current.status !== 'ACTIVE' || current.organisation_id !== session.organisationId) {
      return isApi ? NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } })
        : NextResponse.redirect(new URL('/login', req.url));
    }
    role = String(current.role).toLowerCase() as Role;
    if (role !== 'super_admin') {
      const rows = await sql`SELECT permissions,organisation_id FROM organisation_user_access WHERE user_id=${session.userId}`;
      if(rows.length && rows[0].organisation_id!==session.organisationId) return NextResponse.json({error:'Forbidden'},{status:403,headers:{'Cache-Control':'private, no-store'}});
      if (rows.length) {
        if (pathname === '/dashboard') return NextResponse.redirect(new URL('/workspace', req.url));
        let allowed = managedRequestAllowed(rows[0].permissions, pathname, req.method, role);
        const keys = moduleForPath(pathname);
        if (allowed && keys.length) {
          const entitled = await sql`SELECT m.key FROM modules m JOIN organisation_modules om ON om.module_key=m.key
            WHERE om.organisation_id=${session.organisationId} AND om.enabled=true AND m.active=true`;
          const effective = Object.fromEntries(Object.entries(rows[0].permissions as Record<string,unknown>)
            .filter(([key])=>entitled.some(row=>row.key===key)));
          allowed = managedRequestAllowed(effective, pathname, req.method, role);
        }
        if (!allowed) return NextResponse.json({ error: 'Your account does not have access to this area.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
      }
    }
  } catch {
    return NextResponse.json({ error: 'Access could not be verified. Please try again.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }

  // Phase C1.6: both checks now use the SAME shared roleGte()/ROLE_ORDER
  // lib/org.ts's requireRole() uses (imported from lib/session.ts, not
  // duplicated here) — previously this file maintained its own, separate
  // COMMAND_ROLES array that could silently drift from lib/org.ts's
  // ordering. /admin and /clients remain effectively super_admin-only
  // (roleGte against the top of the hierarchy is equivalent to an exact
  // match, since nothing outranks it) — expressed via the shared helper
  // instead of a bespoke equality check, for the same reason.
  if (
    (
      pathname.startsWith('/admin') ||
      pathname.startsWith('/clients')
    ) &&
    !roleGte(role, 'super_admin')
  ) {
    return NextResponse.redirect(
      new URL('/dashboard', req.url),
    );
  }

  // /command — manager, admin, super_admin only
  if (
    pathname.startsWith('/command') &&
    !roleGte(role, 'manager')
  ) {
    return NextResponse.redirect(
      new URL('/dashboard', req.url),
    );
  }

  const res = NextResponse.next();
  if(isApi) res.headers.set('Cache-Control','private, no-store');

  // Sliding refresh:
  // re-issue cookie if within 2h of expiry
  const expiresAt = new Date(
    session.expiresAt,
  );

  const msRemaining =
    expiresAt.getTime() - Date.now();

  if (
    msRemaining > 0 &&
    msRemaining < REFRESH_THRESHOLD_MS
  ) {
    const newExpiry = new Date(
      Date.now() + SESSION_LIFETIME_MS,
    );

    const newToken = await encrypt({
      ...session,
      expiresAt:
        newExpiry.toISOString(),
    });

    res.cookies.set(
      'session',
      newToken,
      COOKIE_OPTIONS(newExpiry),
    );
  }

  return res;
}

export const config = {
  runtime: 'nodejs',
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
