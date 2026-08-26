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
import { Analytics } from '@vercel/analytics/next';

import { getSession } from '@/lib/session';
import sql from '@/lib/db';

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
  const session = await getSession();

  let serverSession: {
    role: string;
    name: string;
    avatarUrl?: string;
    enabledCapabilities?: string[];
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

    serverSession = {
      role: session.role,
      name: session.name,
      avatarUrl,
      enabledCapabilities,
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
            <OrgSwitcher />

            <TopNav
              serverSession={
                serverSession
              }
            />

            {children}
          </SessionProvider>
        </ThemeProvider>

        <ClarityLoader />
        <Analytics />
      </body>
    </html>
  );
}