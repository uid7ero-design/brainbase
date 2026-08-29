import { redirect, notFound } from 'next/navigation';
import { requireRole } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import EventDetailClient from './EventDetailClient';

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireRole('viewer');
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

  return <EventDetailClient eventId={id} canManage={session.role === 'manager' || session.role === 'admin' || session.role === 'super_admin'} />;
}
