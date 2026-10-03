import { listRequirements } from '@/lib/assurance/contractorAssurance';
import { REQUIREMENT_CATEGORIES } from '@/lib/assurance/contractorAssuranceRules';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import type { FormField } from '../../_components/AssuranceForm';
import { Badge, Breadcrumbs, Card, Dim, EmptyState, Notice, PageHeader, Section, enumOptions, assuranceStyles as styles } from '../../_components/ui';

export const dynamic = 'force-dynamic';

function requirementFields(r?: { name: string; description: string | null; category: string; evidence_guidance: string | null;
  expiry_required: boolean; renewal_notice_days: number | null; display_order: number }): FormField[] {
  return [
    { kind: 'text', name: 'name', label: 'Name', required: true, defaultValue: r?.name, placeholder: 'e.g. Public liability insurance' },
    { kind: 'select', name: 'category', label: 'Category', required: true, options: enumOptions(REQUIREMENT_CATEGORIES), defaultValue: r?.category },
    { kind: 'textarea', name: 'description', label: 'Description (optional)', rows: 2, defaultValue: r?.description ?? '' },
    { kind: 'textarea', name: 'evidenceGuidance', label: 'Evidence guidance (optional)', rows: 2, defaultValue: r?.evidence_guidance ?? '',
      help: 'What evidence satisfies this requirement. Your organisation sets this; BrainBase does not assume legal thresholds.' },
    { kind: 'checkbox', name: 'expiryRequired', label: 'Evidence must have an expiry date', defaultChecked: r?.expiry_required ?? false },
    { kind: 'number', name: 'renewalNoticeDays', label: 'Renewal notice (days, optional)', min: 1, max: 365,
      defaultValue: r?.renewal_notice_days ? String(r.renewal_notice_days) : '',
      help: 'Evidence expiring within this many days shows as "Expiring soon". Leave blank for no expiring-soon state.' },
    { kind: 'number', name: 'displayOrder', label: 'Display order', min: 0, max: 9999, defaultValue: String(r?.display_order ?? 0) },
  ];
}

export default async function RequirementLibraryPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const canAdminister = viewerCan(viewer, 'administer');
  const rows = await listRequirements(viewer);

  return (
    <div style={{ maxWidth: 1000 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/contractors', label: 'Contractor assurance' }, { label: 'Requirement library' }]} />
      <PageHeader help="contractor-requirements"
        title="Requirement library"
        subtitle="What your organisation requires external organisations to demonstrate. Requirements are assigned to organisations in Assurance scope."
      />
      {!canAdminister && <div style={{ marginBottom: 16 }}><Notice>Only organisation admins can add or change requirements.</Notice></div>}
      {canAdminister && (
        <div style={{ marginBottom: 18 }}>
          <ActionPanel label="New requirement" variant="primary" endpoint="/api/assurance/contractors/requirements"
            fields={[
              { kind: 'text', name: 'requirementCode', label: 'Code', required: true, maxLength: 40, placeholder: 'e.g. PL-INS' },
              ...requirementFields(),
            ]}
            submitLabel="Create requirement" />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No requirements yet" body={canAdminister ? 'Create the first requirement above.' : 'An organisation admin can create requirements.'} />
      ) : rows.map(r => (
        <Section key={r.id} title={r.name} id={`r-${r.id}`}>
          <Card>
            <div className={styles.eyebrowRow} style={{ flexWrap: 'wrap', marginBottom: 6 }}>
              <span className={styles.refEyebrow}>{r.requirement_code}</span>
              <Badge value={r.status} tone={r.status === 'ACTIVE' ? 'success' : 'neutral'} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{assuranceLabel(r.category)}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'grid', gap: 2, overflowWrap: 'anywhere' }}>
              {r.description && <div>{r.description}</div>}
              {r.evidence_guidance && <div>Evidence: {r.evidence_guidance}</div>}
              <div>Expiry {r.expiry_required ? 'required' : 'not required'} · renewal notice {r.renewal_notice_days ? `${r.renewal_notice_days} days` : 'none'}</div>
              <div>Assigned to {r.active_assignment_count} organisation{r.active_assignment_count === 1 ? '' : 's'}{r.assignment_count > r.active_assignment_count ? ` (${r.assignment_count - r.active_assignment_count} cancelled)` : ''}</div>
            </div>
            {canAdminister && (
              <div className={styles.row} style={{ gap: 8, marginTop: 10 }}>
                <ActionPanel label="Edit" endpoint={`/api/assurance/contractors/requirements/${r.id}/update`} extraBody={{ lockVersion: r.lock_version }}
                  description="Evidence already recorded keeps the requirement as it stood when it was recorded; edits apply to evidence recorded afterwards."
                  fields={requirementFields(r)} submitLabel="Save requirement" />
                <ActionPanel label={r.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'} variant={r.status === 'ACTIVE' ? 'danger' : 'secondary'}
                  endpoint={`/api/assurance/contractors/requirements/${r.id}/status`}
                  extraBody={{ status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', lockVersion: r.lock_version }}
                  submitLabel={r.status === 'ACTIVE' ? 'Deactivate requirement' : 'Reactivate requirement'}
                  confirm={r.status === 'ACTIVE'
                    ? 'A deactivated requirement can no longer be assigned. Existing assignments, evidence and history are kept and continue.'
                    : 'The requirement can be assigned again.'} />
              </div>
            )}
            {r.assignment_count === 0 && !canAdminister && <Dim>Not assigned yet.</Dim>}
          </Card>
        </Section>
      ))}
    </div>
  );
}
