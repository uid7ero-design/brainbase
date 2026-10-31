import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getInspectionDetail } from '@/lib/assurance/inspections';
import { listExternalOrganisationOptions, listRiskLevels } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel, formatAssuranceDateTime, isPast } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import {
  CompletionReadiness, EvidenceSection, FindingsTable, LinkExistingFinding, LinkedActionsTable, evidenceFields, raiseFindingFields,
} from '../../_components/shared';
import { listOpenFindingOptions } from '@/lib/assurance/findings';
import {
  Badge, Breadcrumbs, Card, DateCell, Dim, HistoryList, KeyValues, Notice, PageHeader, Prose, Section, assuranceStyles as styles, tableStyles } from '../../_components/ui';
import InspectionRunner, { type RunnerFinding, type RunnerResponse } from './InspectionRunner';

export const dynamic = 'force-dynamic';

export default async function InspectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getInspectionDetail(viewer, id);
  if (!detail) notFound();
  const ins = detail.inspection;
  const canRecord = viewerCan(viewer, 'record');
  const canClose = viewerCan(viewer, 'close');
  const adHoc = !ins.template_version_id;
  const [risks, users, orgs, openFindings] = canRecord
    ? await Promise.all([
      listRiskLevels(viewer.organisationId), listOrgUserOptions(viewer.organisationId), listExternalOrganisationOptions(viewer.organisationId),
      ins.status !== 'CANCELLED' ? listOpenFindingOptions(viewer) : [],
    ])
    : [[], [], [], []];
  const open = ins.status === 'PLANNED' || ins.status === 'IN_PROGRESS';
  const activeEvidence = detail.evidence.filter(e => !e.removed_at);
  const evidenceByItem: Record<string, number> = {};
  for (const e of activeEvidence) if (e.item_key) evidenceByItem[e.item_key] = (evidenceByItem[e.item_key] ?? 0) + 1;
  const openActions = detail.actions.filter(a => a.status !== 'CLOSED' && a.status !== 'CANCELLED').length;
  const newerVersion = ins.template_version_number !== null && ins.latest_template_version_number !== null
    && ins.latest_template_version_number > ins.template_version_number;

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/inspections', label: 'Inspections' }, { label: ins.inspection_reference }]} />
      <PageHeader help="inspection"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{ins.inspection_reference}</span>
          <Badge value={ins.status} />
          <Badge value={adHoc ? 'AD_HOC' : 'TEMPLATE'} tone="neutral" label={adHoc ? 'Ad hoc' : 'Template'} />
        </span>}
        title={ins.title}
        subtitle={`${assuranceLabel(ins.inspection_type)} inspection${ins.location_name ? ` · ${ins.location_name}` : ''}`}
      />

      {open && (
        <Section title="What remains" id="readiness">
          <CompletionReadiness readiness={detail.readiness} noun="inspection" findingCount={detail.findings.length}
            openActionCount={openActions} evidenceCount={activeEvidence.length} />
        </Section>
      )}

      {canRecord && open && (
        <Section title="Next step">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {ins.status === 'PLANNED' && <ActionPanel label="Start inspection" endpoint={`/api/assurance/inspections/${ins.id}/start`} variant="primary" />}
            {ins.status === 'IN_PROGRESS' && (
              <ActionPanel label="Complete inspection" endpoint={`/api/assurance/inspections/${ins.id}/complete`} variant="primary"
                description={detail.readiness.ready
                  ? 'Completing locks the responses. It does not create, close or change any finding, action or evidence.'
                  : `${detail.readiness.blockers.join(' ')} Completion will be refused until this is resolved.`}
                fields={[{ kind: 'textarea', name: 'summary', label: 'Summary', rows: 3 }]} submitLabel="Complete inspection" />
            )}
            <ActionPanel label={ins.inspector_name ? 'Change inspector' : 'Assign inspector'} endpoint={`/api/assurance/inspections/${ins.id}/inspector`}
              extraBody={{ expectedInspectorUserId: ins.inspector_user_id ?? null }}
              description="The inspector is responsible for conducting this inspection. Changing the inspector changes nothing else."
              fields={[{ kind: 'select', name: 'inspectorUserId', label: 'Inspector', options: users.map(u => ({ value: u.id, label: u.name })), defaultValue: ins.inspector_user_id ?? undefined, emptyLabel: 'Unassigned' }]}
              submitLabel="Save inspector" />
            {canClose && (
              <ActionPanel label="Cancel inspection" endpoint={`/api/assurance/inspections/${ins.id}/cancel`} variant="danger"
                description="Cancelling stops the inspection. Its responses and evidence can no longer be changed. The reason is kept in the history."
                fields={[{ kind: 'textarea', name: 'reason', label: 'Reason', required: true, rows: 2 }]} submitLabel="Cancel inspection" />
            )}
          </div>
        </Section>
      )}

      <Section title="Overview" id="overview">
        <Card>
          <KeyValues items={[
            { label: 'Inspector', value: ins.inspector_name ?? <Dim>Unassigned</Dim> },
            { label: 'Scheduled', value: <DateCell value={ins.scheduled_at} withTime overdue={ins.status === 'PLANNED' && isPast(ins.scheduled_at)} /> },
            { label: 'Started', value: ins.started_at ? formatAssuranceDateTime(ins.started_at) : null },
            { label: 'Completed', value: ins.completed_at ? formatAssuranceDateTime(ins.completed_at) : null },
            { label: 'Location', value: ins.location_name },
            { label: 'Asset', value: ins.asset_name },
            { label: 'External organisation', value: ins.external_organisation_name },
            {
              label: 'Checklist',
              value: adHoc ? 'Ad hoc (items recorded during the inspection)' : (
                <Link href={`/assurance/templates/inspection/${ins.template_id}`} className={tableStyles.link}>
                  {ins.template_name} · v{ins.template_version_number}
                </Link>
              ),
            },
          ]} />
          {ins.summary && <div style={{ marginTop: 14 }}><div style={subhead}>Summary</div><Prose>{ins.summary}</Prose></div>}
        </Card>
      </Section>

      <Section title="Checklist" id="checklist">
        <div style={{ display: 'grid', gap: 10 }}>
          {!adHoc && (
            <Notice>
              This inspection uses <strong>{ins.template_version_title ?? ins.template_name} — version {ins.template_version_number}</strong>, exactly as it was when the inspection was created.
              {newerVersion ? ` A newer version (v${ins.latest_template_version_number}) exists; it does not change this inspection.` : ''}
              {ins.template_instructions ? <><br /><span style={{ color: 'var(--text-secondary)' }}>{ins.template_instructions}</span></> : null}
            </Notice>
          )}
          {detail.invalidChecklistItems > 0 && <Notice tone="warning">{detail.invalidChecklistItems} item(s) in this version could not be read and are not shown.</Notice>}
          {ins.status === 'PLANNED' && <Dim>Start the inspection to record responses.</Dim>}
          <InspectionRunner
            inspectionId={ins.id}
            editable={canRecord && ins.status === 'IN_PROGRESS'}
            canRaiseFindings={canRecord && ins.status !== 'CANCELLED'}
            adHoc={adHoc}
            checklist={detail.checklist}
            responses={detail.responses as unknown as RunnerResponse[]}
            findings={detail.findings as unknown as RunnerFinding[]}
            findingFields={raiseFindingFields({ risks, users, orgs })}
            evidenceByItem={evidenceByItem}
            canAddEvidence={canRecord && ins.status !== 'CANCELLED'}
            evidenceFormFields={evidenceFields()}
          />
        </div>
      </Section>

      <Section title="Findings" count={detail.findings.length} id="findings"
        actions={canRecord && ins.status !== 'CANCELLED' ? (
          <LinkExistingFinding endpoint={`/api/assurance/inspections/${ins.id}/findings`} options={openFindings} linkedIds={new Set(detail.findings.map(f => f.id))} />
        ) : undefined}>
        <FindingsTable rows={detail.findings} hiddenCount={detail.hiddenFindingCount} emptyText="No findings have been raised from this inspection." />
      </Section>

      <Section title="Actions" count={detail.actions.length} id="actions">
        <LinkedActionsTable rows={detail.actions} emptyText="No actions have been raised from this inspection's findings." />
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
          Corrective work runs Inspection → Finding → Action. Actions are raised and closed on their finding; closing them does not change this inspection.
        </p>
      </Section>

      <Section title="Evidence" count={activeEvidence.length} id="evidence">
        <EvidenceSection rows={detail.evidence} target="inspection" targetId={ins.id} canRecord={canRecord && ins.status !== 'CANCELLED'}
          items={detail.responses.map(r => ({ value: r.item_key, label: r.item_label }))} />
      </Section>

      <Section title="History" id="history">
        <Card><HistoryList entries={detail.history} /></Card>
      </Section>
    </div>
  );
}

const subhead = { fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 } as const;
