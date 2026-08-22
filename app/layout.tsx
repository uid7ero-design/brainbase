import type { Metadata } from 'next';
import {
  Geist,
  Geist_Mono,
  Inter,
} from 'next/font/google';
import Script from 'next/script';

import './globals.css';

import TopNav from '@/components/nav/TopNav';
import RouteScrollReset from '@/components/nav/RouteScrollReset';
import SessionProvider from '@/components/session/SessionProvider';
import OrgSwitcher from '@/components/admin/OrgSwitcher';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

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

export const metadata: Metadata = {
  title: {
    default: 'BrainBase',
    template: '%s | BrainBase',
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

    serverSession = {
      role: session.role,
      name: session.name,
      avatarUrl,
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
    >
      <head>
        <meta
          name="application-name"
          content="BrainBase"
        />

        <meta
          name="apple-mobile-web-app-title"
          content="BrainBase"
        />

        <meta
          name="theme-color"
          content="#0A0D1A"
        />

        <Script
          id="brainbase-theme-init"
          strategy="beforeInteractive"
        >
          {`
            try {
              var theme =
                localStorage.getItem("bb-theme");

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
          `}
        </Script>
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

        <Script
          id="microsoft-clarity"
          strategy="afterInteractive"
        >
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){
                (c[a].q=c[a].q||[])
                  .push(arguments)
              };

              t=l.createElement(r);
              t.async=1;
              t.src=
                "https://www.clarity.ms/tag/"+i;

              y=l.getElementsByTagName(r)[0];

              y.parentNode.insertBefore(
                t,
                y
              );

            })(
              window,
              document,
              "clarity",
              "script",
              "wvg7lqjkde"
            );
          `}
        </Script>
      </body>
    </html>
  );
}