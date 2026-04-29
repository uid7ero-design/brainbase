import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import { listConnectors } from '@/lib/integrations/registry';
import IntegrationsClient from './IntegrationsClient';
import type { Integration } from '@/lib/integrations/types';

export default async function IntegrationsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const rows = await sql`
    SELECT * FROM integrations
    WHERE organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `.catch(() => []);

  const connectors = listConnectors().map(c => ({
    id: c.id, label: c.label, description: c.description,
  }));

  return (
    <IntegrationsClient
      integrations={rows as unknown as Integration[]}
      connectors={connectors}
    />
  );
}
