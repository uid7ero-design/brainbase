import { notFound } from 'next/navigation';
import { getFindingDetail, FINDING_TRANSITIONS, type SourceRef } from '@/lib/assurance/findings';
import { listExternalOrganisationOptions } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { ACTION_PRIORITIES, ACTION_TYPES, assuranceLabel, formatAssuranceDateTime, isPast } from '@/lib/assurance/domain';
import {
  ACTION_CLOSURE_LABELS, ACTION_CLOSURE_TONES, ACTION_VERIFICATION_LABELS, ACTION_VERIFICATION_TONES, ACTION_WORK_LABELS,
  ACTION_WORK_TONES, FINDING_PROGRESS_LABELS, FINDING_PROGRESS_TONES, actionFacts, findingClosureReadiness, findingProgress,
  isActionFinished, isFindingTerminal,
} from '@/lib/assurance/findingRules';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import { EvidenceSection, NextStepButtons } from '../../_components/shared';
import { DeadlineSection } from '../../_components/deadlines';
import { getAssuranceTimeZone, listRecordTimeframes } from '@/lib/assurance/deadlines';
import {
  Badge, Breadcrumbs, Card, ChainStrip, DataTable, DateCell, Dim, HistoryList, KeyValues, Notice, PageHeader, Prose, RecordLink,
  RefChip, Row, Section, enumOptions, td, type ChainStep, assuranceStyles as styles } from '../../_components/ui';

export const dynamic = 'force-dynamic';

const SOURCE_HREF = {
  incident: '/assurance/incidents', investigation: '/assurance/investigations', inspection: '/assurance/inspections',
  audit: '/assurance/audits', contractor: '/assurance/contractors',
} as const;

const CONTEXT_LABEL: Record<SourceRef['kind'], string> = {
  incident: '', investigation: '', inspection: 'Checklist item', audit: 'Criterion', contractor: 'Requirement',
};

export default async function FindingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getFindingDetail(viewer, id);
  if (!detail) notFound();
  const f = detail.finding;
  const canRecord = viewerCan(viewer, 'record');
  const canClose = viewerCan(viewer, 'close');
  const open = !isFindingTerminal(f.status);
  const [users, orgs] = canRecord && open
    ? await Promise.all([listOrgUserOptions(viewer.organisationId), listExternalOrganisationOptions(viewer.organisationId)])
    : [[], []];
  const [timeframes, tz] = await Promise.all([listRecordTimeframes(viewer, 'finding', id), getAssuranceTimeZone(viewer.organisationId)]);

  const next = FINDING_TRANSITIONS[f.status].filter(s => (s === 'CLOSED' || s === 'CANCELLED' ? canClose : canRecord));
  const actions = detail.actions;
  const openActions = actions.filter(a => !isActionFinished(a.status));
  const closedActions = actions.filter(a => a.status === 'CLOSED');
  const evidenceNeeded = actions.filter(a => a.evidence_required && a.status !== 'CANCELLED');
  const evidenceMet = evidenceNeeded.filter(a => a.active_evidence_count > 0);
  const verificationNeeded = actions.filter(a => a.verification_required && a.status !== 'CANCELLED');
  const verified = verificationNeeded.filter(a => a.latest_verification_result === 'ACCEPTED' || a.latest_verification_result === 'NOT_APPLICABLE');
  const due = detail.timeframes.find(t => t.status === 'ACTIVE' || t.status === 'OVERDUE');
  const closureOverdue = open && !!due && isPast(due.current_due_at);
  const progress = findingProgress({
    status: f.status,
    open_action_count: openActions.length + detail.hiddenOpenActionCount,
    closed_action_count: closedActions.length,
  });
  const readiness = findingClosureReadiness({
    status: f.status,
    openVisibleActions: openActions.map(a => ({ reference: a.action_reference })),
    openHiddenActions: detail.hiddenOpenActionCount,
    viewerCanClose: canClose,
    closureOverdue,
  });
  const lastReopen = detail.reopenings[0];

  const chain: ChainStep[] = [
    { label: 'Source', state: detail.sources.length > 0 ? 'done' : 'na', detail: detail.sources.length > 0 ? detail.sources.map(s => s.reference).join(', ') : 'Raised directly' },
    { label: 'Finding', state: 'done', detail: assuranceLabel(f.status) },
    { label: 'Action', state: actions.length === 0 ? (open ? 'pending' : 'na') : openActions.length === 0 ? 'done' : 'current', detail: actions.length === 0 ? 'None yet' : `${actions.length - openActions.length}/${actions.length} finished` },
    { label: 'Evidence', state: evidenceNeeded.length === 0 ? 'na' : evidenceMet.length === evidenceNeeded.length ? 'done' : 'pending', detail: evidenceNeeded.length === 0 ? 'Not required' : `${evidenceMet.length}/${evidenceNeeded.length} actions evidenced` },
    { label: 'Verification', state: verificationNeeded.length === 0 ? 'na' : verified.length === verificationNeeded.length ? 'done' : 'pending', detail: verificationNeeded.length === 0 ? 'Not required' : `${verified.length}/${verificationNeeded.length} verified` },
    { label: 'Closure', state: f.status === 'CLOSED' ? 'done' : readiness.canCloseNow ? 'current' : 'pending', detail: f.status === 'CLOSED' ? `Closed ${formatAssuranceDateTime(f.closed_at, tz)}` : 'Explicit step' },
  ];

  const reasonField = (label: string) => [{ kind: 'textarea' as const, name: 'reason', label, required: true, rows: 3 }];

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/findings', label: 'Findings' }, { label: f.finding_reference }]} />
      <PageHeader help="finding"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{f.finding_reference}</span>
          <Badge value={f.status} />
          {open && <Badge value={progress} label={FINDING_PROGRESS_LABELS[progress]} tone={FINDING_PROGRESS_TONES[progress]} />}
          <Badge value={f.finding_type} tone="neutral" />
          {detail.reopenings.length > 0 && <Badge value="REOPENED" label={`Reopened ${detail.reopenings.length}×`} tone="warning" />}
        </span>}
        title={f.title}
        subtitle={`Identified ${formatAssuranceDateTime(f.identified_at, tz)}${f.created_by_name ? ` by ${f.created_by_name}` : ''}`}
      />

      <Section title="Assurance chain">
        <Card><ChainStrip steps={chain} /></Card>
      </Section>

      {open && lastReopen && f.status === 'UNDER_REVIEW' && (
        <Notice tone="warning">
          Reopened {formatAssuranceDateTime(lastReopen.reopened_at, tz)}{lastReopen.reopened_by_name ? ` by ${lastReopen.reopened_by_name}` : ''}: {lastReopen.reason}
          {' '}— earlier actions stay as they were. Add a new corrective action for any follow-up work.
        </Notice>
      )}

      {open && (
        <Section title="Closure readiness" id="readiness">
          <Card>
            <div style={subhead}>What still prevents this finding from being closed?</div>
            {readiness.blockers.length === 0
              ? <p style={{ fontSize: 13, margin: 0 }}>Nothing. {actions.length === 0 ? 'No corrective actions are linked.' : 'Every linked action is closed or cancelled.'} Closure is still an explicit decision.</p>
              : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{readiness.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
            {readiness.notes.length > 0 && (
              <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)' }}>{readiness.notes.map(n => <li key={n}>{n}</li>)}</ul>
            )}
          </Card>
        </Section>
      )}

      {next.length > 0 && (
        <Section title="Next step">
          <NextStepButtons
            endpoint={`/api/assurance/findings/${f.id}/status`}
            options={next.map(s => ({
              status: s,
              label: s === 'CLOSED' ? 'Close finding' : s === 'CANCELLED' ? 'Cancel finding' : `Move to ${assuranceLabel(s).toLowerCase()}`,
              variant: s === 'CANCELLED' ? 'danger' : s === 'CLOSED' ? 'primary' : 'secondary',
              ...(s === 'CLOSED' ? {
                fields: reasonField('Closure reason'),
                description: 'Record why this finding is resolved. Closing does not close its actions or source records.',
              } : s === 'CANCELLED' ? {
                fields: reasonField('Cancellation reason'),
                description: 'Cancelling records that this finding will not be pursued (for example, a duplicate). It cannot be reopened.',
              } : {}),
            }))}
          />
          {next.includes('CLOSED') && !readiness.canCloseNow && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>Closing will be refused until the items under Closure readiness are resolved.</p>
          )}
        </Section>
      )}

      {f.status === 'CLOSED' && canClose && (
        <Section title="Next step">
          <ActionPanel label="Reopen finding" endpoint={`/api/assurance/findings/${f.id}/reopen`}
            description="Reopening returns the finding to Under review and records why. It does not reopen any action, source record or evidence decision, and does not change its deadline. Add a new corrective action for follow-up work."
            fields={reasonField('Reopen reason')} submitLabel="Reopen finding" />
        </Section>
      )}

      <Section title="Overview" id="overview">
        <Card>
          <KeyValues items={[
            { label: 'Risk', value: f.risk_name },
            { label: 'Responsible', value: f.responsible_name ?? <Dim>Unassigned</Dim> },
            { label: 'Responsible organisation', value: f.responsible_external_organisation_name },
            { label: 'Resolve by', value: due ? <DateCell value={due.current_due_at} timeZone={tz} overdue={closureOverdue} /> : null },
            { label: 'Location', value: f.location_name },
            { label: 'Asset', value: f.asset_name },
          ]} />
          <div style={{ marginTop: 16 }}><div style={subhead}>Description</div><Prose>{f.description}</Prose></div>
        </Card>
      </Section>

      <Section title="Source" count={detail.sources.length} id="source">
        {detail.sources.length === 0 ? <Card><Dim>Raised directly — not linked to a source record.</Dim></Card> : (
          <DataTable headers={['Source', 'Record', 'Item / criterion']} minWidth={480}>
            {detail.sources.map((s, i) => (
              <Row key={`${s.kind}-${s.id}-${s.context_key ?? ''}`} last={i === detail.sources.length - 1}>
                <td style={td}>{assuranceLabel(s.kind.toUpperCase())}</td>
                <td style={td}><RefChip href={`${SOURCE_HREF[s.kind]}/${s.id}`} reference={s.reference} kind={s.kind} /></td>
                <td style={td}>{s.context
                  ? <span><Dim>{CONTEXT_LABEL[s.kind]}: </Dim>{s.context}</span>
                  : s.kind === 'inspection' || s.kind === 'audit' ? <Dim>Whole {s.kind}</Dim> : <Dim>—</Dim>}</td>
              </Row>
            ))}
          </DataTable>
        )}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>Source links are permanent. Closing or reopening this finding never changes its source records.</p>
      </Section>

      {!open && (
        <Section title="Closure record" id="closure">
          <Card>
            <KeyValues columns={1} items={[
              { label: f.status === 'CLOSED' ? 'Closed' : 'Status', value: f.status === 'CLOSED' ? `${formatAssuranceDateTime(f.closed_at, tz)}${f.closed_by_name ? ` by ${f.closed_by_name}` : ''}` : assuranceLabel(f.status) },
              { label: f.status === 'CLOSED' ? 'Closure reason' : 'Cancellation reason', value: f.closure_reason ?? <Dim>No reason recorded — this finding was {f.status === 'CLOSED' ? 'closed' : 'cancelled'} before reasons were captured.</Dim> },
            ]} />
          </Card>
        </Section>
      )}

      <Section title="Deadline" count={timeframes.length} id="deadline">
        <DeadlineSection timeframes={timeframes} recordLabel="finding"
          caps={{ canRecord, canAdminister: viewerCan(viewer, 'administer'), userId: viewer.userId, timeZone: tz, users: users.map(u => ({ value: u.id, label: u.name })) }} />
        {detail.reopenings.length > 0 && timeframes.length > 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>Reopening does not reset or extend the deadline. Request an extension if more time is needed.</p>
        )}
      </Section>

      <Section title="Corrective actions" count={actions.length} id="actions"
        actions={canRecord && open ? (
          <ActionPanel label="Create action" variant="primary" endpoint="/api/assurance/actions" extraBody={{ findingIds: [f.id] }}
            redirectTo="/assurance/actions/{id}" submitLabel="Create action"
            description={`The action is linked to ${f.finding_reference}. Completing its work, verifying it and closing it are separate steps, and none of them closes this finding.`}
            fields={[
              { kind: 'select', name: 'actionType', label: 'Action type', required: true, options: enumOptions(ACTION_TYPES), defaultValue: 'CORRECTIVE' },
              { kind: 'text', name: 'title', label: 'Title', required: true },
              { kind: 'textarea', name: 'description', label: 'What needs to be done', rows: 3 },
              { kind: 'select', name: 'priority', label: 'Priority', required: true, options: enumOptions(ACTION_PRIORITIES), defaultValue: 'MEDIUM' },
              { kind: 'select', name: 'ownerUserId', label: 'Owner', options: users.map(u => ({ value: u.id, label: u.name })), emptyLabel: 'Unassigned' },
              { kind: 'select', name: 'responsibleExternalOrganisationId', label: 'Contractor / external organisation', options: orgs.map(o => ({ value: o.id, label: o.name })) },
              { kind: 'date', name: 'dueAt', label: 'Due' },
              { kind: 'checkbox', name: 'evidenceRequired', label: 'Evidence required before closure', defaultChecked: true },
              { kind: 'checkbox', name: 'verificationRequired', label: 'Independent verification required before closure', defaultChecked: true },
            ]} />
        ) : undefined}>
        {actions.length === 0 ? <Card><Dim>No corrective actions yet.</Dim></Card> : (
          <DataTable headers={['Action', 'Status', 'Work', 'Verification', 'Closed', 'Evidence', 'Owner', 'Due']} minWidth={980}>
            {actions.map((a, i) => {
              const facts = actionFacts(a);
              return (
                <Row key={a.id} last={i === actions.length - 1}>
                  <td style={td}><RecordLink href={`/assurance/actions/${a.id}`} reference={a.action_reference} title={a.title} /></td>
                  <td style={td}><Badge value={a.status} /></td>
                  <td style={td}><Badge value={facts.work} label={ACTION_WORK_LABELS[facts.work]} tone={ACTION_WORK_TONES[facts.work]} /></td>
                  <td style={td}><Badge value={facts.verification} label={ACTION_VERIFICATION_LABELS[facts.verification]} tone={ACTION_VERIFICATION_TONES[facts.verification]} /></td>
                  <td style={td}><Badge value={facts.closure} label={ACTION_CLOSURE_LABELS[facts.closure]} tone={ACTION_CLOSURE_TONES[facts.closure]} /></td>
                  <td style={td}>{a.active_evidence_count === 0
                    ? (a.evidence_required ? <span style={{ color: 'var(--status-warning)' }}>Required</span> : <Dim>None</Dim>)
                    : `${a.accepted_evidence_count} accepted / ${a.active_evidence_count} linked`}</td>
                  <td style={td}>{a.owner_name ?? <Dim>Unassigned</Dim>}</td>
                  <td style={td}><DateCell value={a.due_at} timeZone={tz} overdue={!isActionFinished(a.status) && isPast(a.due_at)} /></td>
                </Row>
              );
            })}
          </DataTable>
        )}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
          Closed actions are never reopened. Follow-up corrective work is a new action linked to this finding; earlier actions and their verification history stay as they are.
        </p>
      </Section>

      {detail.reopenings.length > 0 && (
        <Section title="Reopen history" count={detail.reopenings.length} id="reopenings">
          <DataTable headers={['#', 'Reopened', 'Reopen reason', 'Previous closure', 'Previous closure reason']} minWidth={760}>
            {detail.reopenings.map((r, i) => (
              <Row key={r.id} last={i === detail.reopenings.length - 1}>
                <td style={td}>{r.reopen_number}</td>
                <td style={td}>{formatAssuranceDateTime(r.reopened_at, tz)}{r.reopened_by_name ? <div><Dim>{r.reopened_by_name}</Dim></div> : null}</td>
                <td style={{ ...td, maxWidth: 260, whiteSpace: 'pre-wrap' }}>{r.reason}</td>
                <td style={td}>{formatAssuranceDateTime(r.previous_closed_at, tz)}{r.previous_closed_by_name ? <div><Dim>{r.previous_closed_by_name}</Dim></div> : null}</td>
                <td style={{ ...td, maxWidth: 260, whiteSpace: 'pre-wrap' }}>{r.previous_closure_reason ?? <Dim>No reason recorded</Dim>}</td>
              </Row>
            ))}
          </DataTable>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>Reopen history is permanent and cannot be edited.</p>
        </Section>
      )}

      <Section title="Evidence" count={detail.evidence.filter(e => !e.removed_at).length} id="evidence">
        <EvidenceSection rows={detail.evidence} target="finding" targetId={f.id} canRecord={canRecord && open} />
      </Section>

      <Section title="History" id="history">
        <Card>
          <HistoryList entries={detail.history} timeZone={tz} />
        </Card>
      </Section>
    </div>
  );
}

const subhead = { fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 } as const;
