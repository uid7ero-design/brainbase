import type { Metadata } from 'next';
import {
  Geist,
  Geist_Mono,
  Inter,
} from 'next/font/google';

import './globals.css';

import TopNav from '@/components/nav/TopNav';
import RouteScrollReset from '@/components/nav/RouteScrollReset';
import SessionProvider from '@/components/session/SessionProvider';
import OrgSwitcher from '@/components/admin/OrgSwitcher';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import ClarityLoader from '@/components/analytics/ClarityLoader';

import { requireSession } from '@/lib/org';
import sql from '@/lib/db';
import { resolveDashboardVariant } from '@/lib/dashboard/clientDashboard';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: [
    '300',
    '400',
    '500',
    '600',
    '700',
  ],
});

const THEME_INIT_SCRIPT = `
  try {
    var theme = localStorage.getItem("bb-theme");

    if (theme === "light") {
      document.documentElement.setAttribute(
        "data-theme",
        "light"
      );
    } else {
      document.documentElement.setAttribute(
        "data-theme",
        "dark"
      );
    }
  } catch (e) {}
`;

export const metadata: Metadata = {
  title: {
    default: 'BRΛINBΛSE',
    template: '%s | BRΛINBΛSE',
  },

  description:
    'Operational intelligence, insight and automation in one place.',

  icons: {
    icon: [
      {
        url: '/Brand/favicon.ico',
      },
      {
        url: '/Brand/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: '/Brand/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],

    shortcut: '/Brand/favicon.ico',

    apple: [
      {
        url: '/Brand/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // requireSession() (not the raw getSession() JWT decode) so that
  // organisationId here already reflects an active super_admin
  // org_override — otherwise every value derived below (enabledCapabilities,
  // dashboardVariant) would always reflect the founder's OWN organisation
  // regardless of impersonation, making TopNav's capability-gated nav
  // items (Events, CRM) silently wrong while "viewing as" a client org.
  // role/name/userId are still the real, logged-in person's own identity
  // — impersonation changes which organisation's DATA is shown, never who
  // the founder is. Falls back to null on any failure (no session, or an
  // invalid/stale one) exactly like the previous getSession()-based
  // check — requireSession() throws where getSession() would have
  // resolved to null.
  let session: Awaited<ReturnType<typeof requireSession>> | null = null;
  try {
    session = await requireSession();
  } catch {
    session = null;
  }

  let serverSession: {
    role: string;
    name: string;
    avatarUrl?: string;
    enabledCapabilities?: string[];
    dashboardVariant?: 'ld-tennis' | 'brainbase-hq' | null;
  } | null = null;

  let secureMode = false;

  if (session) {
    let avatarUrl:
      | string
      | undefined;

    try {
      const [row] = await sql`
        SELECT avatar_url, preferences
        FROM users
        WHERE id = ${session.userId}
        LIMIT 1
      `;

      avatarUrl =
        (row?.avatar_url as string) ||
        undefined;

      secureMode = !!(
        row?.preferences as Record<
          string,
          unknown
        >
      )?.secure_mode;
    } catch {
      /*
        Optional profile fields may not exist
        in every environment.

        Allow the application to continue loading.
      */
    }

    // Same projection /api/me exposes — UX data only, not an
    // authorization boundary (the API/page-level capability checks
    // remain the real enforcement). Kept in its own try/catch so a
    // failure here can never affect the rest of the session.
    let enabledCapabilities: string[] = [];
    try {
      const capabilityRows = await sql`
        SELECT m.key
        FROM organisation_modules om
        JOIN modules m ON m.key = om.module_key
        WHERE om.organisation_id = ${session.organisationId}
          AND om.enabled = true
          AND m.active = true
      `;
      enabledCapabilities = (
        capabilityRows as { key: string }[]
      ).map(r => r.key);
    } catch {
      /* UX projection only — fail closed to an empty list. */
    }

    // Same resolver app/dashboard/page.tsx already uses to decide between
    // the Founder OS redirect, TennisDashboard, and the generic
    // OrganisationDashboard — reused here (not reinvented) so TopNav's
    // tenant classification can never disagree with the actual routing
    // decision. Slug-driven, never a hardcoded org id/env var. Wrapped in
    // its own try/catch, same fail-closed discipline as every other
    // DB-derived field above, so a resolver failure degrades to no
    // bespoke variant rather than blocking the page.
    let dashboardVariant: 'ld-tennis' | 'brainbase-hq' | null = null;
    try {
      dashboardVariant = await resolveDashboardVariant(session.organisationId, session.role);
    } catch {
      /* UX projection only — fail closed to no bespoke variant. */
    }

    serverSession = {
      role: session.role,
      name: session.name,
      avatarUrl,
      enabledCapabilities,
      dashboardVariant,
    };
  }

  return (
    <html
      lang="en"
      data-theme="dark"
      className={`
        ${geistSans.variable}
        ${geistMono.variable}
        ${inter.variable}
        h-full
        antialiased
      `}
      suppressHydrationWarning
    >
      <head>
        <meta
          name="application-name"
          content="BRΛINBΛSE"
        />

        <meta
          name="apple-mobile-web-app-title"
          content="BRΛINBΛSE"
        />

        <meta
          name="theme-color"
          content="#0A0D1A"
        />

        <script
          id="brainbase-theme-init"
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>

      <body className="min-h-full flex flex-col">
        <RouteScrollReset />

        <ThemeProvider>
          <SessionProvider
            hasSession={!!session}
            name={session?.name ?? ''}
            secureModeDefault={secureMode}
          >
            {/* initialRole comes from the SAME server-side requireSession()
                call TopNav's own isSuperAdmin gate already uses via
                serverSession below — OrgSwitcher no longer depends
                entirely on its own client-side fetch('/api/me') just to
                decide whether to render at all. See OrgSwitcher.tsx's
                own header comment for the failure mode this closes. */}
            <OrgSwitcher initialRole={session?.role ?? null} />

            <TopNav
              serverSession={
                serverSession
              }
            />

            {children}
          </SessionProvider>
        </ThemeProvider>

        <ClarityLoader />
      </body>
    </html>
  );
}