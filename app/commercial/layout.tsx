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
// Gated on 'quotes' OR 'invoicing' specifically, not a dedicated
// 'commercial' key (none exists). Originally 'quotes'-only (Quotes was
// the only real Commercial transactional workflow at the time — see
// app/api/commercial/customers/route.ts's identical comment for that
// history), widened here (Phase C4.2) because 'quotes' and 'invoicing'
// are independently-entitlable capability keys by design (see
// lib/commercial/authorize.ts's own CommercialCapabilityKey union) — an
// organisation with Invoicing but not Quotes must still be able to enter
// this shell to reach /commercial/invoices, or the two keys would be
// independent in name only. CommercialSidebar itself still decides which
// NAV ITEMS to show based on each capability individually (see its own
// `invoicingEnabled` prop below) — this layout-level check only decides
// whether the shell renders at all.
export default async function CommercialLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireSession();
  } catch {
    redirect('/login');
  }

  const [quotesCapability, invoicingCapability, purchasingCapability] = await Promise.all([
    checkCapability(session.organisationId, 'quotes'),
    checkCapability(session.organisationId, 'invoicing'),
    checkCapability(session.organisationId, 'purchasing'),
  ]);

  if (!quotesCapability.allowed && !invoicingCapability.allowed && !purchasingCapability.allowed) {
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
          Ask a BrainBase admin to enable Quotes, Invoicing, or Purchasing for your organisation to access the Commercial suite.
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
      <CommercialSidebar quotesEnabled={quotesCapability.allowed} invoicingEnabled={invoicingCapability.allowed} purchasingEnabled={purchasingCapability.allowed} />
      <main style={{ flex: 1, overflow: 'auto', padding: '36px 40px' }}>{children}</main>
    </div>
  );
}
