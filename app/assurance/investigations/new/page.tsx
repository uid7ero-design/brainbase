import { viewerCan } from '@/lib/assurance/authorize';
import { listIncidentOptions } from '@/lib/assurance/incidents';
import { listRiskLevels } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { firstParam, isUuid } from '@/lib/assurance/input';
import { resolvePageViewer } from '../../_components/pageAccess';
import AssuranceForm from '../../_components/AssuranceForm';
import { Breadcrumbs, Card, Notice, PageHeader } from '../../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function NewInvestigationPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  if (!viewerCan(viewer, 'record')) {
    return <Notice tone="warning">Starting an investigation needs manager access in BrainBase.</Notice>;
  }
  const sp = await searchParams;
  const preselect = firstParam(sp.incident);
  const [incidents, users, risks] = await Promise.all([
    listIncidentOptions(viewer),
    listOrgUserOptions(viewer.organisationId),
    listRiskLevels(viewer.organisationId),
  ]);
  const incidentOptions = incidents.map(i => ({ value: i.id, label: i.label }));
  // Only preselect an incident the viewer can actually see (the list above is visibility-scoped).
  const primary = isUuid(preselect) && incidents.some(i => i.id === preselect) ? preselect : undefined;

  return (
    <div style={{ maxWidth: 760 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/investigations', label: 'Investigations' }, { label: 'Start' }]} />
      <PageHeader help="investigation-new" title="Start an investigation" subtitle="Link the incident(s) it covers. Completing the investigation later records its conclusion only — incidents and findings are closed separately." />
      <Card>
        <AssuranceForm
          endpoint="/api/assurance/investigations"
          redirectTo="/assurance/investigations/{id}"
          submitLabel="Start investigation"
          fields={[
            { kind: 'text', name: 'title', label: 'Title', required: true },
            { kind: 'textarea', name: 'scope', label: 'Scope', required: true, rows: 4, help: 'What the investigation will and will not examine.' },
            { kind: 'select', name: 'primaryIncidentId', label: 'Primary incident', options: incidentOptions, defaultValue: primary, emptyLabel: 'None' },
            { kind: 'multiselect', name: 'relatedIncidentIds', label: 'Related incidents', options: incidentOptions, help: 'Hold Ctrl/Cmd to select several.' },
            { kind: 'select', name: 'leadUserId', label: 'Lead investigator', options: users.map(u => ({ value: u.id, label: u.name })), emptyLabel: 'Unassigned' },
            { kind: 'select', name: 'riskLevelId', label: 'Risk level', options: risks.map(r => ({ value: r.id, label: r.name })) },
            { kind: 'date', name: 'targetCompletionAt', label: 'Target completion' },
            { kind: 'checkbox', name: 'restricted', label: 'Restricted investigation', help: 'Only you, the lead and organisation admins will see it and the findings raised from it. Required when any linked incident is restricted.' },
          ]}
        />
      </Card>
    </div>
  );
}
