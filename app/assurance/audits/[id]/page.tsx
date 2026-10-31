import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAuditDetail } from '@/lib/assurance/audits';
import { listOpenFindingOptions } from '@/lib/assurance/findings';
import { listExternalOrganisationOptions, listRiskLevels } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel, formatAssuranceDateTime, isPast } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import {
  CompletionReadiness, evidenceFields, EvidenceSection, FindingsTable, LinkedActionsTable, LinkExistingFinding, raiseFindingFields,
} from '../../_components/shared';
import {
  Badge, Breadcrumbs, Card, DateCell, Dim, HistoryList, KeyValues, Notice, PageHeader, Prose, Section, assuranceStyles as styles, tableStyles } from '../../_components/ui';
import AuditRunner, { type AuditRunnerFinding, type AuditRunnerResponse } from './AuditRunner';

export const dynamic = 'force-dynamic';

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getAuditDetail(viewer, id);
  if (!detail) notFound();
  const au = detail.audit;
  const canRecord = viewerCan(viewer, 'record');
  const canClose = viewerCan(viewer, 'close');
  const adHoc = !au.template_version_id;
  const cancelled = au.status === 'CANCELLED';
  const [risks, users, orgs, openFindings] = canRecord && !cancelled
    ? await Promise.all([
      listRiskLevels(viewer.organisationId), listOrgUserOptions(viewer.organisationId),
      listExternalOrganisationOptions(viewer.organisationId), listOpenFindingOptions(viewer),
    ])
    : [[], [], [], []];
  const linkedIds = new Set(detail.findings.map(f => f.id));
  const open = au.status === 'PLANNED' || au.status === 'IN_PROGRESS';
  const activeEvidence = detail.evidence.filter(e => !e.removed_at);
  const evidenceByCriterion: Record<string, number> = {};
  for (const e of activeEvidence) if (e.item_key) evidenceByCriterion[e.item_key] = (evidenceByCriterion[e.item_key] ?? 0) + 1;
  const openActions = detail.actions.filter(a => a.status !== 'CLOSED' && a.status !== 'CANCELLED').length;
  const newerVersion = au.template_version_number !== null && au.latest_template_version_number !== null
    && au.latest_template_version_number > au.template_version_number;
  const gaps = detail.responses.filter(r => r.outcome === 'NON_COMPLIANT' || r.outcome === 'PARTIAL');
  const gapsWithoutFinding = gaps.filter(r => !detail.findings.some(f => f.source_criterion_key === r.criterion_key));

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/audits', label: 'Audits' }, { label: au.audit_reference }]} />
      <PageHeader help="audit"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{au.audit_reference}</span>
          <Badge value={au.status} />
          <Badge value={adHoc ? 'AD_HOC' : 'TEMPLATE'} tone="neutral" label={adHoc ? 'Ad hoc' : 'Template'} />
        </span>}
        title={au.title}
        subtitle={`${assuranceLabel(au.audit_type)} audit${au.standard_reference ? ` against ${au.standard_reference}` : ''}`}
      />

      {open && (
        <Section title="What remains" id="readiness">
          <CompletionReadiness readiness={detail.readiness} noun="audit" findingCount={detail.findings.length}
            openActionCount={openActions} evidenceCount={activeEvidence.length} />
        </Section>
      )}

      {canRecord && open && (
        <Section title="Next step">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {au.status === 'PLANNED' && <ActionPanel label="Start audit" endpoint={`/api/assurance/audits/${au.id}/start`} variant="primary" />}
            {au.status === 'IN_PROGRESS' && (
              <ActionPanel label="Complete audit" endpoint={`/api/assurance/audits/${au.id}/complete`} variant="primary"
                description={detail.readiness.ready
                  ? 'Completing records the summary and recommendations. It does not create, close or change any finding, action or evidence.'
                  : `${detail.readiness.blockers.join(' ')} Completion will be refused until this is resolved.`}
                fields={[
                  { kind: 'textarea', name: 'summary', label: 'Summary', rows: 3 },
                  { kind: 'textarea', name: 'recommendations', label: 'Recommendations', rows: 4, help: 'Advice for improvement. Formal corrective work belongs in Findings → Actions.' },
                ]} submitLabel="Complete audit" />
            )}
            <ActionPanel label={au.auditor_name ? 'Change auditor' : 'Assign auditor'} endpoint={`/api/assurance/audits/${au.id}/auditor`}
              extraBody={{ expectedAuditorUserId: au.auditor_user_id ?? null }}
              description="The auditor is responsible for conducting this audit. Changing the auditor changes nothing else."
              fields={[{ kind: 'select', name: 'auditorUserId', label: 'Auditor', options: users.map(u => ({ value: u.id, label: u.name })), defaultValue: au.auditor_user_id ?? undefined, emptyLabel: 'Unassigned' }]}
              submitLabel="Save auditor" />
            {canClose && (
              <ActionPanel label="Cancel audit" endpoint={`/api/assurance/audits/${au.id}/cancel`} variant="danger"
                fields={[{ kind: 'textarea', name: 'reason', label: 'Reason', required: true, rows: 2 }]} submitLabel="Cancel audit" />
            )}
          </div>
        </Section>
      )}

      <Section title="Overview" id="overview">
        <Card>
          <KeyValues items={[
            { label: 'Auditor', value: au.auditor_name ?? <Dim>Unassigned</Dim> },
            { label: 'Scheduled', value: <DateCell value={au.scheduled_at} withTime overdue={au.status === 'PLANNED' && isPast(au.scheduled_at)} /> },
            { label: 'Started', value: au.started_at ? formatAssuranceDateTime(au.started_at) : null },
            { label: 'Completed', value: au.completed_at ? formatAssuranceDateTime(au.completed_at) : null },
            { label: 'Location', value: au.location_name },
            { label: 'Asset', value: au.asset_name },
            { label: 'Contractor / organisation', value: au.external_organisation_name },
            { label: 'Planned by', value: au.created_by_name },
          ]} />
          {au.summary && <div style={{ marginTop: 14 }}><div style={subhead}>Summary</div><Prose>{au.summary}</Prose></div>}
        </Card>
      </Section>

      <Section title="Scope & standard" id="scope">
        <Card>
          <KeyValues columns={2} items={[
            { label: 'Standard / reference', value: au.standard_reference },
            {
              label: 'Criteria',
              value: adHoc ? 'Ad hoc (criteria recorded during the audit)' : (
                <Link href={`/assurance/templates/audit/${au.template_id}`} className={tableStyles.link}>
                  {au.template_name} · v{au.template_version_number}
                </Link>
              ),
            },
          ]} />
          <div style={{ marginTop: 14 }}><div style={subhead}>Scope</div><Prose>{au.scope}</Prose></div>
        </Card>
      </Section>

      <Section title="Criteria" id="criteria">
        <div style={{ display: 'grid', gap: 10 }}>
          {!adHoc && (
            <Notice>
              This audit uses <strong>{au.template_version_title ?? au.template_name} — version {au.template_version_number}</strong>
              {au.template_version_standard_reference ? ` (${au.template_version_standard_reference})` : ''}, exactly as it was when the audit was planned.
              {newerVersion ? ` A newer version (v${au.latest_template_version_number}) exists; it does not change this audit.` : ''}
              {au.template_instructions ? <><br /><span style={{ color: 'var(--text-secondary)' }}>{au.template_instructions}</span></> : null}
            </Notice>
          )}
          {detail.invalidCriteria > 0 && <Notice tone="warning">{detail.invalidCriteria} criteri{detail.invalidCriteria === 1 ? 'on' : 'a'} in this version could not be read and {detail.invalidCriteria === 1 ? 'is' : 'are'} not shown.</Notice>}
          {au.status === 'PLANNED' && <Dim>Start the audit to record ratings.</Dim>}
          {gapsWithoutFinding.length > 0 && canRecord && !cancelled && (
            <Notice tone="warning">
              {gapsWithoutFinding.length} non-compliant or partial criteri{gapsWithoutFinding.length === 1 ? 'on has' : 'a have'} no finding raised.
              Raise a finding where formal corrective work is needed — nothing is created automatically.
            </Notice>
          )}
          <AuditRunner
            auditId={au.id}
            editable={canRecord && au.status === 'IN_PROGRESS'}
            canRaiseFindings={canRecord && !cancelled}
            adHoc={adHoc}
            criteria={detail.criteria}
            responses={detail.responses as unknown as AuditRunnerResponse[]}
            findings={detail.findings as unknown as AuditRunnerFinding[]}
            findingFields={raiseFindingFields({ risks, users, orgs })}
            evidenceByCriterion={evidenceByCriterion}
            canAddEvidence={canRecord && !cancelled}
            evidenceFormFields={evidenceFields()}
          />
        </div>
      </Section>

      <Section title="Findings" count={detail.findings.length} id="findings"
        actions={canRecord && !cancelled ? (
          <LinkExistingFinding endpoint={`/api/assurance/audits/${au.id}/findings`} options={openFindings} linkedIds={linkedIds} />
        ) : undefined}>
        <FindingsTable rows={detail.findings} hiddenCount={detail.hiddenFindingCount} emptyText="No findings have been raised from this audit." />
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
          Corrective work runs Finding → Action → Evidence → Verification → Closure. There is no direct audit-to-action shortcut.
        </p>
      </Section>

      <Section title="Actions" count={detail.actions.length} id="actions">
        <LinkedActionsTable rows={detail.actions} emptyText="No actions have been raised from this audit's findings." />
      </Section>

      <Section title="Evidence" count={activeEvidence.length} id="evidence">
        <EvidenceSection rows={detail.evidence} target="audit" targetId={au.id} canRecord={canRecord}
          locked={cancelled ? 'This audit is cancelled; its evidence can no longer be changed.' : undefined}
          items={detail.responses.map(r => ({ value: r.criterion_key, label: r.criterion_label }))} />
      </Section>

      <Section title="Recommendations" id="recommendations">
        <Card>
          {au.recommendations ? <Prose>{au.recommendations}</Prose> : <Dim>{au.status === 'COMPLETED' ? 'No recommendations were recorded.' : 'Recommendations are recorded when the audit is completed.'}</Dim>}
        </Card>
      </Section>

      <Section title="History" id="history">
        <Card><HistoryList entries={detail.history} /></Card>
      </Section>
    </div>
  );
}

const subhead = { fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 } as const;
