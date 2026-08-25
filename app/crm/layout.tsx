import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import CrmSidebar from './_components/CrmSidebar';

// Standalone CRM product shell. Page-level capability enforcement,
// mirroring the check every app/api/crm/** route already performs —
// the API layer remains the actual authorization boundary; this is a
// UX gate so an unentitled organisation sees a clear message instead
// of a page that only fails once its data fetches start returning 403.
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
          minHeight: 'calc(100vh - 52px)',
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
        minHeight: 'calc(100vh - 52px)',
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
