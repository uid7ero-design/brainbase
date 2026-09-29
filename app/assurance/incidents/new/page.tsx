import { viewerCan } from '@/lib/assurance/authorize';
import { listAssetOptions, listExternalOrganisationOptions, listLocationOptions, listRiskLevels } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { INCIDENT_CATEGORIES } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import AssuranceForm from '../../_components/AssuranceForm';
import { Breadcrumbs, Card, Notice, PageHeader, enumOptions } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export default async function NewIncidentPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  if (!viewerCan(viewer, 'record')) {
    return <Notice tone="warning">You can view incidents, but reporting one needs manager access in BrainBase.</Notice>;
  }
  const [risks, users, locations, assets, orgs] = await Promise.all([
    listRiskLevels(viewer.organisationId),
    listOrgUserOptions(viewer.organisationId),
    listLocationOptions(viewer.organisationId),
    listAssetOptions(viewer.organisationId),
    listExternalOrganisationOptions(viewer.organisationId),
  ]);

  return (
    <div style={{ maxWidth: 760 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/incidents', label: 'Incidents' }, { label: 'Report' }]} />
      <PageHeader title="Report an incident" subtitle="Capture what happened. Triage, investigation and corrective action follow as separate, explicit steps." />
      <Card>
        <AssuranceForm
          endpoint="/api/assurance/incidents"
          redirectTo="/assurance/incidents/{id}"
          submitLabel="Report incident"
          fields={[
            { kind: 'text', name: 'title', label: 'Short title', required: true, placeholder: 'e.g. Slip on wet floor at Depot 2 wash bay' },
            { kind: 'select', name: 'category', label: 'Category', required: true, options: enumOptions(INCIDENT_CATEGORIES) },
            { kind: 'datetime', name: 'occurredAt', label: 'When did it happen?', required: true, defaultNow: true },
            { kind: 'textarea', name: 'description', label: 'What happened?', required: true, rows: 5 },
            { kind: 'textarea', name: 'immediateResponse', label: 'Immediate response taken', rows: 3, help: 'Anything done straight away to make the situation safe.' },
            { kind: 'select', name: 'riskLevelId', label: 'Risk level', options: risks.map(r => ({ value: r.id, label: r.name })), help: risks.length === 0 ? 'No risk levels are configured for your organisation yet.' : undefined },
            { kind: 'select', name: 'ownerUserId', label: 'Owner', options: users.map(u => ({ value: u.id, label: u.name })), emptyLabel: 'Unassigned' },
            { kind: 'select', name: 'locationId', label: 'Location', options: locations.map(l => ({ value: l.id, label: l.reference ? `${l.name} (${l.reference})` : l.name })) },
            { kind: 'select', name: 'assetId', label: 'Asset', options: assets.map(a => ({ value: a.id, label: a.reference ? `${a.name} (${a.reference})` : a.name })) },
            { kind: 'select', name: 'externalOrganisationId', label: 'External organisation involved', options: orgs.map(o => ({ value: o.id, label: o.name })) },
            { kind: 'checkbox', name: 'restricted', label: 'Restricted incident', help: 'Only you, the owner, the reporter and organisation admins will be able to see it — including its findings, actions and evidence.' },
          ]}
        />
      </Card>
    </div>
  );
}
