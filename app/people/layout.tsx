import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';

// HR-1 People Foundation — page-level capability enforcement, mirroring
// app/crm/layout.tsx's and app/organiser/layout.tsx's own established
// convention exactly: the API layer (every app/api/hr/** route) remains
// the actual authorization boundary; this is a UX gate so an unentitled
// organisation sees a clear message instead of a page that only fails
// once its data fetch returns 403.
export default async function PeopleLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireSession();
  } catch {
    redirect('/login');
  }

  const capability = await checkCapability(session.organisationId, 'people');

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
        <div style={{ fontSize: 16, fontWeight: 700 }}>People isn&apos;t enabled for your organisation</div>
        <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 360 }}>
          Ask a BrainBase admin to enable the People capability for your organisation to access your team directory.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: APP_HEADER_OFFSET_VH_CALC,
        background: '#07080B',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        color: '#f9fafb',
        padding: '36px 40px',
      }}
    >
      {children}
    </div>
  );
}
