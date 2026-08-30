import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import ClientEventsClient from './ClientEventsClient';

// Platform-wide event oversight — BrainBase super admins only. Relies
// primarily on app/admin/layout.tsx's own super_admin gate (every
// route nested under /admin/* is already covered there); this
// redundant check matches the same defensive convention
// app/admin/orgs/page.tsx and app/admin/users/page.tsx already use.
// Deliberately uses getSession() directly, not requireSession() — like
// every other /admin/* page, this must reflect the platform identity,
// never a super_admin's current org_override (impersonation is for
// entering a SPECIFIC client's tenant-scoped Events module via "Open
// event" below, not for viewing this oversight screen itself).
export default async function AdminClientEventsPage() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') redirect('/');

  return <ClientEventsClient />;
}
