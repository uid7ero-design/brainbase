import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import TopNav from "@/components/nav/TopNav";
import SessionProvider from "@/components/session/SessionProvider";
import { getSession } from "@/lib/session";
import sql from "@/lib/db";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Helena — Brainbase",
  description: "Voice-first AI command centre",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  let serverSession: { role: string; name: string; avatarUrl?: string } | null = null;
  let secureMode = false;

  if (session) {
    let avatarUrl: string | undefined;
    try {
      const [row] = await sql`SELECT avatar_url, preferences FROM users WHERE id = ${session.userId} LIMIT 1`;
      avatarUrl = (row?.avatar_url as string) || undefined;
      secureMode = !!(row?.preferences as Record<string, unknown>)?.secure_mode;
    } catch { /* pre-migration — no column yet */ }
    serverSession = { role: session.role, name: session.name, avatarUrl };
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionProvider
          hasSession={!!session}
          name={session?.name ?? ''}
          secureModeDefault={secureMode}
        >
          <TopNav serverSession={serverSession} />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
