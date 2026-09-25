// Public routes whose page body has been converted to the --bb-* token
// system and therefore renders correctly in both light and dark themes.
// On any other public route the public nav pins itself to dark (matching
// that page's still-hardcoded dark body) and hides the theme toggle, so a
// light-theme visitor never sees a light header over a dark page.
// Add a route here only once its page has been converted.
export const THEMED_PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/pricing',
  '/client-operations',
  '/client-operations/demo',
  '/web-systems',
  '/demo',
  '/request-demo',
  '/privacy',
  '/terms',
];

export function isThemedPublicRoute(pathname: string | null | undefined): boolean {
  return !!pathname && THEMED_PUBLIC_ROUTES.includes(pathname);
}

export type PublicNavLink = { href: string; label: string; match?: (pathname: string) => boolean };

/** Same links, in the same order, as the previous TopNav PublicNav. */
export const PUBLIC_NAV_LINKS: readonly PublicNavLink[] = [
  { href: '/#product', label: 'Product', match: () => false },
  { href: '/client-operations', label: 'Client Operations' },
  { href: '/web-systems', label: 'Web Systems' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'Demo', match: p => p === '/demo' },
];

export function isActiveLink(link: PublicNavLink, pathname: string): boolean {
  return link.match ? link.match(pathname) : pathname.startsWith(link.href);
}
