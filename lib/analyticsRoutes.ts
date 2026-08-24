/**
 * Routes eligible for public marketing analytics (Microsoft Clarity).
 *
 * This is intentionally a separate, narrower allowlist from middleware.ts's
 * PUBLIC route list. "Doesn't require a session" and "safe to run marketing
 * analytics on" are different questions — /request-demo, /login and /signup
 * are all publicly reachable but are deliberately excluded here because they
 * involve entering personal information or account credentials.
 *
 * Default-deny: a route not listed here does not get analytics, including
 * every authenticated/customer/admin workspace route. When adding a new
 * public marketing page, it must be added here explicitly to opt in.
 */
export const CLARITY_ALLOWED_ROUTES = [
  '/',
  '/pricing',
  '/demo',
  '/client-operations',
  '/web-systems',
  '/privacy',
  '/terms',
];

export function isClarityAllowedRoute(pathname: string): boolean {
  return CLARITY_ALLOWED_ROUTES.some(route => {
    if (route === '/') {
      return pathname === '/';
    }

    return pathname === route || pathname.startsWith(`${route}/`);
  });
}
