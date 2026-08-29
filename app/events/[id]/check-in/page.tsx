import { redirect, notFound } from 'next/navigation';
import { requireRole } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import CheckInClient from './CheckInClient';

// Same staff gate as every other /events/[id]/* page (session + Events
// capability + role) — see app/events/[id]/page.tsx, which this
// mirrors exactly. requireRole('manager') here, not 'viewer': check-in
// is a mutation-capable page (the confirm/undo actions require
// manager+ — see app/api/events/[id]/check-in/confirm/route.ts's own
// comment for the full reasoning), so a viewer who somehow reached this
// page would see a scanner/search UI whose every action the API
// rejects — cleaner to redirect them before they land here at all.
export default async function CheckInPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  if (!id) notFound();

  return <CheckInClient eventId={id} />;
}
