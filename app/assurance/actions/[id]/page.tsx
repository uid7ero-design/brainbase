import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getActionDetail, listOrganiserItemOptions } from '@/lib/assurance/actions';
import { viewerCan } from '@/lib/assurance/authorize';
import { VERIFICATION_RESULTS, assuranceLabel, formatAssuranceDate, formatAssuranceDateTime, isPast } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import { EvidenceSection } from '../../_components/shared';
import { DeadlineSection } from '../../_components/deadlines';
import { getAssuranceTimeZone, listRecordTimeframes } from '@/lib/assurance/deadlines';
import { listOrgUserOptions } from '@/lib/assurance/users';
import {
  Badge, Breadcrumbs, Card, ChainStrip, DataTable, DateCell, Dim, HistoryList, KeyValues, Notice, PageHeader, Prose, RecordLink,
  Row, Section, enumOptions, td, type ChainStep, assuranceStyles as styles, tableStyles } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export default async function ActionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getActionDetail(viewer, id);
  if (!detail) notFound();
  const a = detail.action;
  const r = detail.readiness;
  const canRecord = viewerCan(viewer, 'record');
  const canVerify = viewerCan(viewer, 'verify');
  const [timeframes, tz, users] = await Promise.all([
    listRecordTimeframes(viewer, 'action', id), getAssuranceTimeZone(viewer.organisationId),
    canRecord ? listOrgUserOptions(viewer.organisationId) : Promise.resolve([]),
  ]);
  const canClose = viewerCan(viewer, 'close');
  const finished = a.status === 'CLOSED' || a.status === 'CANCELLED';
  const organiserOptions = canRecord && !finished ? await listOrganiserItemOptions(viewer) : [];
  const linkedTaskIds = new Set(detail.tasks.map(t => t.organiser_item_id));
  const latest = detail.verifications[0];
  const independent = a.owner_user_id !== viewer.userId && a.work_completed_by !== viewer.userId;
  const due = detail.timeframes.find(t => t.status === 'ACTIVE' || t.status === 'OVERDUE');
  const activeEvidence = detail.evidence.filter(e => !e.removed_at);

  const chain: ChainStep[] = [
    { label: 'Finding', state: 'done', detail: detail.findings.map(f => f.finding_reference).join(', ') || 'Restricted' },
    { label: 'Work', state: r.workCompleted ? 'done' : a.status === 'IN_PROGRESS' || a.status === 'OPEN' ? 'current' : 'pending', detail: r.workCompleted ? `Completed ${formatAssuranceDate(a.work_completed_at)}` : 'Not complete' },
    { label: 'Evidence', state: !a.evidence_required ? (activeEvidence.length > 0 ? 'done' : 'na') : r.evidenceSatisfied ? 'done' : a.status === 'AWAITING_EVIDENCE' ? 'blocked' : 'pending', detail: a.evidence_required ? `${activeEvidence.length} linked` : 'Optional' },
    { label: 'Verification', state: !a.verification_required ? 'na' : r.verificationSatisfied ? 'done' : latest ? 'blocked' : a.status === 'AWAITING_VERIFICATION' ? 'current' : 'pending', detail: !a.verification_required ? 'Not required' : latest ? assuranceLabel(latest.result) : 'Not yet' },
    { label: 'Closure', state: a.status === 'CLOSED' ? 'done' : r.canClose ? 'current' : 'pending', detail: a.status === 'CLOSED' ? formatAssuranceDate(a.closed_at) : r.canClose ? 'Ready to close' : 'Blocked' },
  ];

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/actions', label: 'Actions' }, { label: a.action_reference }]} />
      <PageHeader help="action"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{a.action_reference}</span>
          <Badge value={a.status} />
          <Badge value={a.priority} />
        </span>}
        title={a.title}
        subtitle={`${assuranceLabel(a.action_type)} action${a.owner_name ? ` · owned by ${a.owner_name}` : ''}`}
      />

      <Section title="Assurance chain">
        <Card><ChainStrip steps={chain} /></Card>
      </Section>

      {!finished && (canRecord || canVerify || canClose) && (
        <Section title="Next step">
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {canRecord && a.status === 'OPEN' && <ActionPanel label="Start work" endpoint={`/api/assurance/actions/${a.id}/start`} />}
              {canRecord && (a.status === 'OPEN' || a.status === 'IN_PROGRESS') && !r.workCompleted && (
                <ActionPanel label="Mark work complete" variant="primary" endpoint={`/api/assurance/actions/${a.id}/complete-work`} />
              )}
              {canRecord && a.status === 'IN_PROGRESS' && r.workCompleted && !r.canClose && (
                <ActionPanel label="Mark work complete again" endpoint={`/api/assurance/actions/${a.id}/complete-work`} />
              )}
              {canRecord && a.status === 'AWAITING_EVIDENCE' && (
                <ActionPanel label="Submit for verification" variant="primary" endpoint={`/api/assurance/actions/${a.id}/submit-evidence`} />
              )}
              {canVerify && a.status === 'AWAITING_VERIFICATION' && !r.verificationSatisfied && independent && (
                <ActionPanel label="Record verification" variant="primary" endpoint={`/api/assurance/actions/${a.id}/verifications`}
                  description="Independently confirm whether the corrective work genuinely resolved the finding. Verification history is permanent — a later check is recorded as a new attempt."
                  fields={[
                    { kind: 'select', name: 'result', label: 'Result', required: true, options: enumOptions(VERIFICATION_RESULTS) },
                    { kind: 'textarea', name: 'notes', label: 'Notes', rows: 3, help: 'Required unless the result is Accepted.' },
                    ...(activeEvidence.length > 0 ? [{ kind: 'multiselect' as const, name: 'evidenceIds', label: 'Evidence relied on', options: activeEvidence.map(e => ({ value: e.evidence_id, label: `${e.evidence_reference} — ${e.title ?? assuranceLabel(e.evidence_type)}` })) }] : []),
                  ]} submitLabel="Record verification" />
              )}
              {canClose && r.canClose && <ActionPanel label="Close action" variant="primary" endpoint={`/api/assurance/actions/${a.id}/close`} />}
              {canClose && (
                <ActionPanel label="Cancel action" variant="danger" endpoint={`/api/assurance/actions/${a.id}/cancel`}
                  fields={[{ kind: 'textarea', name: 'reason', label: 'Reason', required: true, rows: 2 }]} submitLabel="Cancel action" />
              )}
            </div>
            {canVerify && a.status === 'AWAITING_VERIFICATION' && !independent && (
              <Notice tone="warning">You own this action or completed its work, so you cannot verify it. Verification must be independent.</Notice>
            )}
            {!r.canClose && r.blockers.length > 0 && (
              <Notice tone="info">
                <strong>Before this action can be closed:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.blockers.map(b => <li key={b}>{b}</li>)}</ul>
              </Notice>
            )}
          </div>
        </Section>
      )}

      <Section title="Overview" id="overview">
        <Card>
          <KeyValues items={[
            { label: 'Owner', value: a.owner_name ?? <Dim>Unassigned</Dim> },
            { label: 'Contractor / organisation', value: a.responsible_external_organisation_name },
            { label: 'Due', value: due ? <DateCell value={due.current_due_at} timeZone={tz} overdue={!finished && isPast(due.current_due_at)} /> : null },
            { label: 'Evidence required', value: a.evidence_required ? 'Yes' : 'No' },
            { label: 'Verification required', value: a.verification_required ? 'Yes (independent)' : 'No' },
            { label: 'Work completed', value: a.work_completed_at ? `${formatAssuranceDateTime(a.work_completed_at)}${a.work_completed_by_name ? ` by ${a.work_completed_by_name}` : ''}` : null },
            { label: 'Created by', value: a.created_by_name },
          ]} />
          {a.description && <div style={{ marginTop: 16 }}><div style={subhead}>What needs to be done</div><Prose>{a.description}</Prose></div>}
        </Card>
      </Section>

      <Section title="Deadline" count={timeframes.length} id="deadline">
        <DeadlineSection timeframes={timeframes} recordLabel="action"
          caps={{ canRecord, canAdminister: viewerCan(viewer, 'administer'), userId: viewer.userId, timeZone: tz, users: users.map(u => ({ value: u.id, label: u.name })) }} />
      </Section>

      <Section title="Findings addressed" count={detail.findings.length} id="findings">
        {detail.findings.length === 0 ? <Card><Dim>No visible findings.</Dim></Card> : (
          <DataTable headers={['Finding', 'Type', 'Status']} minWidth={520}>
            {detail.findings.map((f, i) => (
              <Row key={f.id} last={i === detail.findings.length - 1}>
                <td style={td}><RecordLink href={`/assurance/findings/${f.id}`} reference={f.finding_reference} title={f.title} /></td>
                <td style={td}>{assuranceLabel(f.finding_type)}</td>
                <td style={td}><Badge value={f.status} /></td>
              </Row>
            ))}
          </DataTable>
        )}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>Closing this action does not close these findings — each finding is closed explicitly.</p>
      </Section>

      <Section title="Organiser tasks" count={detail.tasks.length} id="tasks">
        <div style={{ display: 'grid', gap: 10 }}>
          {detail.tasks.length === 0 ? <Card><Dim>No Organiser tasks are linked.</Dim></Card> : (
            <DataTable headers={['Task', 'Relationship', 'Task status']} minWidth={520}>
              {detail.tasks.map((t, i) => (
                <Row key={t.link_id} last={i === detail.tasks.length - 1}>
                  <td style={{ ...td, color: 'var(--text-primary)' }}>{t.name}</td>
                  <td style={td}>{assuranceLabel(t.relationship_type)}</td>
                  <td style={td}>{t.status ?? <Dim>—</Dim>}</td>
                </Row>
              ))}
            </DataTable>
          )}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            Tasks track day-to-day work in <Link href="/organiser" style={{ color: 'inherit' }}>Organiser</Link>. Completing a task never completes, verifies or closes this action.
          </p>
          {canRecord && !finished && organiserOptions.length > 0 && (
            <ActionPanel label="Link Organiser task" endpoint={`/api/assurance/actions/${a.id}/tasks`}
              fields={[
                { kind: 'select', name: 'organiserItemId', label: 'Task', required: true, options: organiserOptions.filter(o => !linkedTaskIds.has(o.id)).map(o => ({ value: o.id, label: o.label })) },
                { kind: 'select', name: 'relationshipType', label: 'Relationship', required: true, options: enumOptions(['IMPLEMENTATION', 'FOLLOW_UP', 'EVIDENCE_COLLECTION', 'OTHER']), defaultValue: 'IMPLEMENTATION' },
              ]} submitLabel="Link task" />
          )}
        </div>
      </Section>

      <Section title="Evidence" count={activeEvidence.length} id="evidence">
        <EvidenceSection rows={detail.evidence} target="action" targetId={a.id} canRecord={canRecord}
          locked={a.status === 'CLOSED' ? 'This action is closed; its evidence is part of the closure record.' : a.status === 'CANCELLED' ? 'This action is cancelled.' : undefined} />
      </Section>

      <Section title="Verification history" count={detail.verifications.length} id="verification">
        {detail.verifications.length === 0 ? <Card><Dim>{a.verification_required ? 'No verification has been recorded yet.' : 'Verification is not required for this action.'}</Dim></Card> : (
          <DataTable headers={['Attempt', 'Result', 'Verified by', 'When', 'Evidence', 'Notes']} minWidth={760}>
            {detail.verifications.map((v, i) => (
              <Row key={v.id} last={i === detail.verifications.length - 1}>
                <td style={td}>#{v.attempt_number}</td>
                <td style={td}><Badge value={v.result} /></td>
                <td style={td}>{v.verified_by_name ?? <Dim>—</Dim>}</td>
                <td style={td}><DateCell value={v.verified_at} withTime /></td>
                <td style={td}>{v.evidence.length === 0 ? <Dim>—</Dim> : v.evidence.map(e => <div key={e.id}><Link href={`/assurance/evidence/${e.id}`} className={tableStyles.link}>{e.reference}</Link></div>)}</td>
                <td style={{ ...td, maxWidth: 280, whiteSpace: 'pre-wrap' }}>{v.notes ?? <Dim>—</Dim>}</td>
              </Row>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="History" id="history">
        <Card>
          {a.status === 'CLOSED' && <p style={{ fontSize: 13, margin: '0 0 12px' }}>Closed {formatAssuranceDateTime(a.closed_at)}{a.closed_by_name ? ` by ${a.closed_by_name}` : ''}.</p>}
          <HistoryList entries={detail.history} />
        </Card>
      </Section>
    </div>
  );
}

const subhead = { fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 } as const;
