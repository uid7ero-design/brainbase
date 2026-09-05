import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';
import CommercialSidebar from './_components/CommercialSidebar';

// Phase C3 — standalone Commercial product shell, modeled directly on
// app/crm/layout.tsx's identical shape (page-level UX gate; the API
// layer's own authorizeCommercialRequest() calls remain the real
// authorization boundary — see lib/commercial/authorize.ts).
//
// Gated on 'quotes' specifically, not a dedicated 'commercial' key (none
// exists) — Quotes is the only real Commercial transactional workflow in
// this phase, and Customers/Products exist only in service of it. See
// app/api/commercial/customers/route.ts's identical comment for the full
// rationale.
export default async function CommercialLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireSession();
  } catch {
    redirect('/login');
  }

  const capability = await checkCapability(session.organisationId, 'quotes');

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
        <div style={{ fontSize: 16, fontWeight: 700 }}>Commercial isn&apos;t enabled for your organisation</div>
        <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 360 }}>
          Ask a BrainBase admin to enable the Quotes capability for your organisation to access Customers,
          Products &amp; Services, and Quotes.
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
      <CommercialSidebar />
      <main style={{ flex: 1, overflow: 'auto', padding: '36px 40px' }}>{children}</main>
    </div>
  );
}
