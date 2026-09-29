import { viewerCan } from '@/lib/assurance/authorize';
import { listTemplates } from '@/lib/assurance/templates';
import { listAssetOptions, listExternalOrganisationOptions, listLocationOptions } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { INSPECTION_TYPES, assuranceLabel } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import AssuranceForm from '../../_components/AssuranceForm';
import { Breadcrumbs, Card, Notice, PageHeader, enumOptions } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export default async function NewInspectionPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  if (!viewerCan(viewer, 'record')) {
    return <Notice tone="warning">Planning an inspection needs manager access in BrainBase.</Notice>;
  }
  const [templates, users, locations, assets, orgs] = await Promise.all([
    listTemplates(viewer, { activeOnly: true }),
    listOrgUserOptions(viewer.organisationId),
    listLocationOptions(viewer.organisationId),
    listAssetOptions(viewer.organisationId),
    listExternalOrganisationOptions(viewer.organisationId),
  ]);
  const templateOptions = templates
    .filter(t => t.latest_version_id)
    .map(t => ({ value: t.latest_version_id!, label: `${t.name} — v${t.latest_version_number} (${t.latest_item_count ?? 0} items, ${assuranceLabel(t.inspection_type).toLowerCase()})` }));

  return (
    <div style={{ maxWidth: 760 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/inspections', label: 'Inspections' }, { label: 'Plan' }]} />
      <PageHeader help="inspection-new" title="Plan an inspection" subtitle="Choose a template to bind this inspection to its current checklist version, or leave it blank for an ad hoc inspection." />
      <Card>
        <AssuranceForm
          endpoint="/api/assurance/inspections"
          redirectTo="/assurance/inspections/{id}"
          submitLabel="Plan inspection"
          fields={[
            { kind: 'text', name: 'title', label: 'Title', required: true, placeholder: 'e.g. Monthly site safety walk — Northern Depot' },
            { kind: 'select', name: 'templateVersionId', label: 'Template', options: templateOptions, emptyLabel: 'Ad hoc (no template)',
              help: templateOptions.length === 0 ? 'No active templates yet — an admin can create one under Inspections → Templates.' : 'The inspection keeps this exact version even if the template changes later.' },
            { kind: 'select', name: 'inspectionType', label: 'Inspection type', options: enumOptions(INSPECTION_TYPES), emptyLabel: 'Use the template’s type', help: 'Required for an ad hoc inspection.' },
            { kind: 'datetime', name: 'scheduledAt', label: 'Scheduled for' },
            { kind: 'select', name: 'inspectorUserId', label: 'Inspector', options: users.map(u => ({ value: u.id, label: u.name })), emptyLabel: 'Unassigned' },
            { kind: 'select', name: 'locationId', label: 'Location', options: locations.map(l => ({ value: l.id, label: l.name })) },
            { kind: 'select', name: 'assetId', label: 'Asset', options: assets.map(a => ({ value: a.id, label: a.name })) },
            { kind: 'select', name: 'externalOrganisationId', label: 'Contractor / external organisation', options: orgs.map(o => ({ value: o.id, label: o.name })) },
          ]}
        />
      </Card>
    </div>
  );
}
