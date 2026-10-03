import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getInspectionDetail } from '@/lib/assurance/inspections';
import { listExternalOrganisationOptions, listRiskLevels } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel, formatAssuranceDateTime, isPast } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import { EvidenceSection, FindingsTable, LinkExistingFinding, raiseFindingFields } from '../../_components/shared';
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
  const requiredMissing = detail.checklist.filter(i => i.required && !detail.responses.some(r => r.item_key === i.key)).length;
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

      {canRecord && (ins.status === 'PLANNED' || ins.status === 'IN_PROGRESS') && (
        <Section title="Next step">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {ins.status === 'PLANNED' && <ActionPanel label="Start inspection" endpoint={`/api/assurance/inspections/${ins.id}/start`} variant="primary" />}
            {ins.status === 'IN_PROGRESS' && (
              <ActionPanel label="Complete inspection" endpoint={`/api/assurance/inspections/${ins.id}/complete`} variant="primary"
                description={requiredMissing > 0
                  ? `${requiredMissing} required item(s) still need a response — completion will be refused until they are answered.`
                  : 'Completing locks the responses. Findings are never created or closed automatically — raise them from failed items.'}
                fields={[{ kind: 'textarea', name: 'summary', label: 'Summary', rows: 3 }]} submitLabel="Complete inspection" />
            )}
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
          />
        </div>
      </Section>

      <Section title="Findings" count={detail.findings.length} id="findings"
        actions={canRecord && ins.status !== 'CANCELLED' ? (
          <LinkExistingFinding endpoint={`/api/assurance/inspections/${ins.id}/findings`} options={openFindings} linkedIds={new Set(detail.findings.map(f => f.id))} />
        ) : undefined}>
        <FindingsTable rows={detail.findings} hiddenCount={detail.hiddenFindingCount} emptyText="No findings have been raised from this inspection." />
      </Section>

      <Section title="Evidence" count={detail.evidence.filter(e => !e.removed_at).length} id="evidence">
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
