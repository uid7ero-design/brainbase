import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import sql from '@/lib/db';
import EventsListClient from './EventsListClient';

export default async function EventsPage() {
  // Phase 1 is staff-only: no session at all, or a role below viewer,
  // sends the caller back to the dashboard exactly like middleware.ts
  // does for /admin and /command on an insufficient role.
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

  // Public event link (Part B) — the organisation's own slug, never
  // fetched by the existing GET /api/events (SELECT e.* from events
  // only, no join to organisations) and not worth adding there just
  // for a display-only link. One small, read-only, additive query,
  // scoped to this page's own already-authenticated session — no new
  // API route, no change to any existing Events endpoint.
  const [orgRow] = await sql`SELECT slug FROM organisations WHERE id = ${session.organisationId} LIMIT 1`;
  const organisationSlug = (orgRow?.slug as string | undefined) ?? null;

  return (
    <EventsListClient
      canManage={session.role === 'manager' || session.role === 'admin' || session.role === 'super_admin'}
      organisationSlug={organisationSlug}
    />
  );
}
