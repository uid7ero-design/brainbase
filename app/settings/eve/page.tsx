import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { getOrganisationEveEnabled } from '@/lib/organisations/eveEnablement';
import EveSettingsClient from './EveSettingsClient';

// admin+ only — the same floor as app/api/organisations/eve/route.ts, using
// the same requireRole()+redirect page pattern as app/settings/branding.
export default async function EveSettingsPage() {
  let organisationId: string;
  try {
    ({ organisationId } = await requireRole('admin'));
  } catch {
    redirect('/');
  }

  const [eveEnabled, capability] = await Promise.all([
    getOrganisationEveEnabled(organisationId),
    checkCapability(organisationId, 'events'),
  ]);

  return <EveSettingsClient initialEveEnabled={eveEnabled === true} eventsEntitled={capability.allowed} />;
}
