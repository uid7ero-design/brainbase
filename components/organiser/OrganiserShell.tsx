'use client';
import { useOpsTheme } from '@/components/ops/theme';

// Phase D.4.4E — replaces WorkspaceShell as app/organiser/page.tsx's outer
// wrapper. Deliberately minimal: TopNav is already rendered globally by
// app/layout.tsx above every route including /organiser, so this shell
// owns ONLY the rail+canvas flex layout for the remaining viewport below
// it — no Sidebar, no OpBar (its title/clock/profile bar duplicates
// TopNav's own profile/logout menu and the board toolbar's own board-name
// display; see the D.4.4D-R audit), no session or capability fetch (both
// already resolved by TopNav/the page itself), no auth logic, no DB
// access. WorkspaceShell itself is untouched and keeps serving Command
// Centre and Bin Maintenance exactly as before.

interface OrganiserShellProps {
  rail: React.ReactNode;
  children: React.ReactNode;
}

export default function OrganiserShell({ rail, children }: OrganiserShellProps) {
  const t = useOpsTheme();

  return (
    <>
      {/* Same "body owns no scroll, the shell's own inner regions do"
          convention WorkspaceShell already established — without this,
          a fixed-position full-viewport shell and the page's own body
          scroll fight each other. */}
      <style dangerouslySetInnerHTML={{ __html: `body { overflow: hidden !important; }` }} />
      <div style={{
        // Same "sit below the global 52px TopNav" convention WorkspaceShell
        // already established — not a new offset, not a second header.
        position: 'fixed', top: 52, left: 0, right: 0, bottom: 0,
        display: 'flex',
        background: t.pageBg,
        fontFamily: 'var(--font-inter),"Inter",-apple-system,sans-serif',
        overflow: 'hidden',
        zIndex: 50,
      }}>
        {rail}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {children}
        </div>
      </div>
    </>
  );
}
