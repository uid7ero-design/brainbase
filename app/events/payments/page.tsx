import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import PaymentsClient from './PaymentsClient';

// Same staff gate as every other /events/* page (session + Events
// capability + role) — see app/events/[id]/check-in/page.tsx, which
// this mirrors exactly. requireRole('manager') here, not 'viewer':
// this page's one real action (Connect Stripe) is manager+-gated at
// the API layer already (see the connect route's own comment) — a
// viewer who somehow reached this page would see a page whose only
// button the API rejects, so redirecting before they land here is
// cleaner, matching the check-in page's identical reasoning.
export default async function EventsPaymentsPage() {
  let session;
  try {
    session = await requireRole('manager');
  } catch {
    redirect('/dashboard');
  }

  const capability = await checkCapability(session.organisationId, 'events');
  if (!capability.allowed) {
    return (
      <div style={{ padding: 48, fontFamily: 'var(--font-inter),-apple-system,sans-serif', color: '#e5e7eb' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Events &amp; Ticketing</h1>
        <p style={{ fontSize: 14, color: '#9ca3af' }}>
          The Events module is not enabled for your organisation. Contact a BrainBase administrator to request access.
        </p>
      </div>
    );
  }

  return <PaymentsClient />;
}
