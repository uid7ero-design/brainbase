import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';
import CrmSidebar from './_components/CrmSidebar';

// Standalone CRM product shell. Page-level capability enforcement,
// mirroring the check every app/api/crm/** route already performs —
// the API layer remains the actual authorization boundary; this is a
// UX gate so an unentitled organisation sees a clear message instead
// of a page that only fails once its data fetches start returning 403.
//
// minHeight uses the shared APP_HEADER_OFFSET_VH_CALC (lib/layout/
// headerOffset.ts), not a hardcoded `calc(100vh - 52px)` — this file
// was the one consumer PR #109's own sweep of that exact bug class
// missed (its header comment lists every other fixed consumer —
// OrganiserShell, WorkspaceShell, AdminAside, CrmSidebar itself,
// Founder OS, the deployments page, client detail, OnboardingWizard —
// but not this file). CrmSidebar.tsx already correctly uses the same
// shared var for its own sticky top/height; this brings its parent
// layout into agreement with it, so both size themselves off the same
// real, measured header height (TopNav's 52px, plus OrgSwitcher's own
// extra height for a resolved super_admin session) instead of two
// different, silently-inconsistent numbers.
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireSession();
  } catch {
    redirect('/login');
  }

  const capability = await checkCapability(session.organisationId, 'crm');

  if (!capability.allowed) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: APP_HEADER_OFFSET_VH_CALC,
          gap: 10,
          textAlign: 'center',
          padding: 32,
          background: '#07080B',
          color: '#f9fafb',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>CRM isn&apos;t enabled for your organisation</div>
        <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 360 }}>
          Ask a BrainBase admin to enable the CRM capability for your organisation to access companies, contacts,
          deals, and activities.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        minHeight: APP_HEADER_OFFSET_VH_CALC,
        background: '#07080B',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        color: '#f9fafb',
      }}
    >
      <CrmSidebar />
      <main style={{ flex: 1, overflow: 'auto', padding: '36px 40px' }}>{children}</main>
    </div>
  );
}
