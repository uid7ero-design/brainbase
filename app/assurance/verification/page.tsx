import Link from 'next/link';
import { listRecentVerifications, listVerificationQueue } from '@/lib/assurance/verifications';
import { listContractorEvidenceQueue, listEvidenceVerificationQueue, listRecentEvidenceDecisions } from '@/lib/assurance/evidence';
import { getAssuranceTimeZone } from '@/lib/assurance/deadlines';
import { viewerCan } from '@/lib/assurance/authorize';
import { isPast } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../_components/pageAccess';
import {
  Badge, DataTable, DateCell, Dim, EmptyState, Notice, PageHeader, RecordLink, RefChip, Row, Section, td, tableStyles,
} from '../_components/ui';

export const dynamic = 'force-dynamic';

const HREF = {
  incident: '/assurance/incidents', investigation: '/assurance/investigations', inspection: '/assurance/inspections', audit: '/assurance/audits',
  finding: '/assurance/findings', action: '/assurance/actions', verification: '/assurance/actions',
} as const;

function Eligibility({ canVerify, eligible, why }: { canVerify: boolean; eligible: boolean; why: string }) {
  if (!canVerify) return <Dim>—</Dim>;
  return eligible
    ? <Badge value="YES" tone="success" label="Yes" />
    : <span title={why}><Badge value="NO" tone="neutral" label="Not independent" /></span>;
}

export default async function VerificationPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const [evidenceQueue, contractorQueue, actionQueue, recentActions, recentEvidence, tz] = await Promise.all([
    listEvidenceVerificationQueue(viewer),
    listContractorEvidenceQueue(viewer),
    listVerificationQueue(viewer),
    listRecentVerifications(viewer, 50),
    listRecentEvidenceDecisions(viewer, 50),
    getAssuranceTimeZone(viewer.organisationId),
  ]);
  const canVerify = viewerCan(viewer, 'verify');
  const nothingWaiting = evidenceQueue.length + contractorQueue.length + actionQueue.length === 0;

  return (
    <div style={{ maxWidth: 1200 }}>
      <PageHeader help="verification"
        title="Verification"
        subtitle="What needs an assurance decision. Evidence decisions and action verification are separate, human decisions made by someone independent — and none of them closes anything by itself."
      />
      {!canVerify && <div style={{ marginBottom: 16 }}><Notice>You can see what is waiting, but accepting, rejecting or verifying needs manager access.</Notice></div>}

      {nothingWaiting && (
        <div style={{ marginBottom: 16 }}>
          <EmptyState title="Nothing is waiting for verification."
            body="Evidence appears here when someone submits it for verification, contractor evidence when it is recorded against a requirement, and actions when their work is completed." />
        </div>
      )}

      {evidenceQueue.length > 0 && (
        <Section title="Evidence awaiting verification" count={evidenceQueue.length}>
          <DataTable headers={['Evidence', 'Supports', 'Recorded by', 'Submitted', 'You can decide']} minWidth={900}>
            {evidenceQueue.map((q, i) => (
              <Row key={q.id} last={i === evidenceQueue.length - 1}>
                <td style={{ ...td, maxWidth: 300 }}>
                  <RecordLink href={`/assurance/evidence/${q.id}#decision`} reference={q.evidence_reference} title={q.title} />
                  {q.replaces_reference && <div className={tableStyles.meta}>Replaces {q.replaces_reference}</div>}
                </td>
                <td style={{ ...td, maxWidth: 280 }}>
                  {q.links.length === 0 ? <Dim>Not linked</Dim> : q.links.map(l => (
                    <RefChip key={`${l.kind}-${l.id}-${l.reference}`} href={`${HREF[l.kind]}/${l.id}`} reference={l.item ? `${l.reference} · ${l.item}` : l.reference} kind={l.kind} />
                  ))}
                </td>
                <td style={td}>{q.recorded_by_name ?? <Dim>—</Dim>}</td>
                <td style={td}><DateCell value={q.verification_requested_at} withTime timeZone={tz} />{q.requested_by_name && <div className={tableStyles.meta}>{q.requested_by_name}</div>}</td>
                <td style={td}><Eligibility canVerify={canVerify} eligible={q.can_decide} why="You recorded or captured this evidence, or own or completed an action it supports" /></td>
              </Row>
            ))}
          </DataTable>
        </Section>
      )}

      {contractorQueue.length > 0 && (
        <Section title="Contractor evidence awaiting review" count={contractorQueue.length}>
          <div style={{ display: 'grid', gap: 10 }}>
            <Dim>Decided in Contractor assurance, on the organisation&apos;s page.</Dim>
            <DataTable headers={['Evidence', 'Organisation', 'Requirement', 'Recorded', 'You can decide']} minWidth={860}>
              {contractorQueue.map((q, i) => (
                <Row key={q.submission_id} last={i === contractorQueue.length - 1}>
                  <td style={{ ...td, maxWidth: 260 }}><RecordLink href={`/assurance/evidence/${q.evidence_id}`} reference={q.evidence_reference} title={q.title} /></td>
                  <td style={td}><Link href={`/assurance/contractors/${q.external_organisation_id}`} className={tableStyles.link}>{q.external_organisation_name}</Link></td>
                  <td style={td}>{q.requirement_name}</td>
                  <td style={td}><DateCell value={q.recorded_at} withTime timeZone={tz} />{q.recorded_by_name && <div className={tableStyles.meta}>{q.recorded_by_name}</div>}</td>
                  <td style={td}><Eligibility canVerify={canVerify} eligible={q.can_decide} why="You recorded this evidence" /></td>
                </Row>
              ))}
            </DataTable>
          </div>
        </Section>
      )}

      {actionQueue.length > 0 && (
        <Section title="Actions awaiting verification" count={actionQueue.length}>
          <div style={{ display: 'grid', gap: 10 }}>
            <Dim>Verifying an action judges whether the corrective work resolved the issue. Closing the action is a separate step.</Dim>
            <DataTable headers={['Action', 'Priority', 'Owner', 'Work completed', 'Evidence', 'Attempts', 'Due', 'You can verify']} minWidth={1000}>
              {actionQueue.map((q, i) => (
                <Row key={q.id} last={i === actionQueue.length - 1}>
                  <td style={{ ...td, maxWidth: 300 }}><RecordLink href={`/assurance/actions/${q.id}#verification`} reference={q.action_reference} title={q.title} /></td>
                  <td style={td}><Badge value={q.priority} /></td>
                  <td style={td}>{q.owner_name ?? <Dim>Unassigned</Dim>}</td>
                  <td style={td}><DateCell value={q.work_completed_at} />{q.work_completed_by_name && <div className={tableStyles.meta}>{q.work_completed_by_name}</div>}</td>
                  <td style={td}>{q.active_evidence_count > 0 ? `${q.active_evidence_count} linked` : <span style={{ color: 'var(--status-warning)' }}>None</span>}</td>
                  <td style={td}>{q.attempt_count}</td>
                  <td style={td}><DateCell value={q.due_at} overdue={isPast(q.due_at)} /></td>
                  <td style={td}><Eligibility canVerify={canVerify} eligible={q.can_verify} why="You own this action or completed its work" /></td>
                </Row>
              ))}
            </DataTable>
          </div>
        </Section>
      )}

      <Section title="Recent evidence decisions" count={recentEvidence.length}>
        <DataTable headers={['Evidence', 'Decision', 'Decided by', 'When', 'Where decided', 'Reason']} minWidth={900}
          empty={recentEvidence.length === 0 ? 'No evidence has been accepted or rejected yet.' : undefined}>
          {recentEvidence.map((d, i) => (
            <Row key={`${d.authority}-${d.evidence_id}`} last={i === recentEvidence.length - 1}>
              <td style={{ ...td, maxWidth: 280 }}><RecordLink href={`/assurance/evidence/${d.evidence_id}`} reference={d.evidence_reference} title={d.title} /></td>
              <td style={td}><Badge value={d.decision} tone={d.decision === 'ACCEPTED' ? 'success' : 'danger'} label={d.decision === 'ACCEPTED' ? 'Accepted' : 'Rejected'} /></td>
              <td style={td}>{d.decided_by_name ?? <Dim>—</Dim>}</td>
              <td style={td}><DateCell value={d.decided_at} withTime timeZone={tz} /></td>
              <td style={td}>{d.authority === 'contractor' && d.external_organisation_id
                ? <Link href={`/assurance/contractors/${d.external_organisation_id}`} className={tableStyles.link}>Contractor assurance</Link>
                : 'Evidence'}</td>
              <td style={{ ...td, maxWidth: 260, whiteSpace: 'pre-wrap' }}>{d.reason ?? <Dim>—</Dim>}</td>
            </Row>
          ))}
        </DataTable>
      </Section>

      <Section title="Recent action verifications" count={recentActions.length}>
        <DataTable headers={['Action', 'Attempt', 'Result', 'Verified by', 'When', 'Evidence', 'Notes']} minWidth={960}
          empty={recentActions.length === 0 ? 'No action verifications have been recorded yet.' : undefined}>
          {recentActions.map((v, i) => (
            <Row key={v.id} last={i === recentActions.length - 1}>
              <td style={{ ...td, maxWidth: 280 }}><RecordLink href={`/assurance/actions/${v.action_id}`} reference={v.action_reference} title={v.action_title} /></td>
              <td style={td}>#{v.attempt_number}</td>
              <td style={td}><Badge value={v.result} /></td>
              <td style={td}>{v.verified_by_name ?? <Dim>—</Dim>}</td>
              <td style={td}><DateCell value={v.verified_at} withTime timeZone={tz} /></td>
              <td style={td}>{v.evidence_count || <Dim>0</Dim>}</td>
              <td style={{ ...td, maxWidth: 260, whiteSpace: 'pre-wrap' }}>{v.notes ?? <Dim>—</Dim>}</td>
            </Row>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
