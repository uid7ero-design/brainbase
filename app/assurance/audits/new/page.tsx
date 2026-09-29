import { viewerCan } from '@/lib/assurance/authorize';
import { listAuditTemplates } from '@/lib/assurance/auditTemplates';
import { listAssetOptions, listExternalOrganisationOptions, listLocationOptions } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { AUDIT_TYPES, assuranceLabel } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import AssuranceForm from '../../_components/AssuranceForm';
import { Breadcrumbs, Card, Notice, PageHeader, enumOptions } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export default async function NewAuditPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  if (!viewerCan(viewer, 'record')) {
    return <Notice tone="warning">Planning an audit needs manager access in BrainBase.</Notice>;
  }
  const [templates, users, locations, assets, orgs] = await Promise.all([
    listAuditTemplates(viewer, { activeOnly: true }),
    listOrgUserOptions(viewer.organisationId),
    listLocationOptions(viewer.organisationId),
    listAssetOptions(viewer.organisationId),
    listExternalOrganisationOptions(viewer.organisationId),
  ]);
  const templateOptions = templates
    .filter(t => t.latest_version_id)
    .map(t => ({
      value: t.latest_version_id!,
      label: `${t.name} — v${t.latest_version_number} (${t.latest_criteria_count ?? 0} criteria${t.latest_standard_reference ? `, ${t.latest_standard_reference}` : ''}, ${assuranceLabel(t.audit_type).toLowerCase()})`,
    }));

  return (
    <div style={{ maxWidth: 760 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/audits', label: 'Audits' }, { label: 'Plan' }]} />
      <PageHeader help="audit-new" title="Plan an audit" subtitle="Choose a template to bind this audit to its current criteria version, or run an ad hoc audit against a named standard." />
      <Card>
        <AssuranceForm
          endpoint="/api/assurance/audits"
          redirectTo="/assurance/audits/{id}"
          submitLabel="Plan audit"
          fields={[
            { kind: 'text', name: 'title', label: 'Title', required: true, placeholder: 'e.g. Waste operations compliance audit — Northern Depot' },
            { kind: 'textarea', name: 'scope', label: 'Scope', required: true, rows: 3, help: 'What is being audited, and what is out of scope.' },
            { kind: 'select', name: 'templateVersionId', label: 'Template', options: templateOptions, emptyLabel: 'Ad hoc (no template)',
              help: templateOptions.length === 0 ? 'No active audit templates yet — an admin can create one under Audits → Templates.' : 'The audit keeps this exact version even if the template changes later.' },
            { kind: 'text', name: 'standardReference', label: 'Standard / reference', maxLength: 300,
              placeholder: 'e.g. Waste Operations Procedure v3', defaultValue: undefined },
            { kind: 'select', name: 'auditType', label: 'Audit type', options: enumOptions(AUDIT_TYPES), emptyLabel: 'Use the template’s type', help: 'An ad hoc audit needs a type and a standard / reference.' },
            { kind: 'datetime', name: 'scheduledAt', label: 'Scheduled for' },
            { kind: 'select', name: 'auditorUserId', label: 'Auditor', options: users.map(u => ({ value: u.id, label: u.name })), emptyLabel: 'Unassigned' },
            { kind: 'select', name: 'locationId', label: 'Location', options: locations.map(l => ({ value: l.id, label: l.name })) },
            { kind: 'select', name: 'assetId', label: 'Asset', options: assets.map(a => ({ value: a.id, label: a.name })) },
            { kind: 'select', name: 'externalOrganisationId', label: 'Contractor / external organisation', options: orgs.map(o => ({ value: o.id, label: o.name })) },
          ]}
        />
      </Card>
    </div>
  );
}
