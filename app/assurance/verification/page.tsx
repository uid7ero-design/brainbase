import { listRecentVerifications, listVerificationQueue } from '@/lib/assurance/verifications';
import { viewerCan } from '@/lib/assurance/authorize';
import { isPast } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../_components/pageAccess';
import { Badge, DataTable, DateCell, Dim, Notice, PageHeader, RecordLink, Row, Section, td, tableStyles } from '../_components/ui';

export const dynamic = 'force-dynamic';

export default async function VerificationPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const [queue, recent] = await Promise.all([listVerificationQueue(viewer), listRecentVerifications(viewer, 50)]);
  const canVerify = viewerCan(viewer, 'verify');

  return (
    <div style={{ maxWidth: 1200 }}>
      <PageHeader help="verification"
        title="Verification"
        subtitle="Independent confirmation that corrective work genuinely resolved the issue. Verifying never closes an action — closure is a separate, explicit step."
      />
      {!canVerify && <div style={{ marginBottom: 16 }}><Notice>You can see the verification queue, but recording a verification needs manager access.</Notice></div>}

      <Section title="Awaiting verification" count={queue.length}>
        <DataTable headers={['Action', 'Priority', 'Owner', 'Work completed', 'Evidence', 'Attempts', 'Due', 'You can verify']} minWidth={1000}
          empty={queue.length === 0 ? 'Nothing is waiting for verification.' : undefined}>
          {queue.map((q, i) => (
            <Row key={q.id} last={i === queue.length - 1}>
              <td style={{ ...td, maxWidth: 300 }}><RecordLink href={`/assurance/actions/${q.id}#verification`} reference={q.action_reference} title={q.title} /></td>
              <td style={td}><Badge value={q.priority} /></td>
              <td style={td}>{q.owner_name ?? <Dim>Unassigned</Dim>}</td>
              <td style={td}><DateCell value={q.work_completed_at} />{q.work_completed_by_name && <div className={tableStyles.meta}>{q.work_completed_by_name}</div>}</td>
              <td style={td}>{q.active_evidence_count > 0 ? `${q.active_evidence_count} linked` : <span style={{ color: 'var(--status-warning)' }}>None</span>}</td>
              <td style={td}>{q.attempt_count}</td>
              <td style={td}><DateCell value={q.due_at} overdue={isPast(q.due_at)} /></td>
              <td style={td}>{!canVerify ? <Dim>—</Dim> : q.can_verify ? <Badge value="YES" tone="success" label="Yes" /> : <span title="You own this action or completed its work"><Badge value="NO" tone="neutral" label="Not independent" /></span>}</td>
            </Row>
          ))}
        </DataTable>
      </Section>

      <Section title="Recent verification decisions" count={recent.length}>
        <DataTable headers={['Action', 'Attempt', 'Result', 'Verified by', 'When', 'Evidence', 'Notes']} minWidth={960}
          empty={recent.length === 0 ? 'No verifications have been recorded yet.' : undefined}>
          {recent.map((v, i) => (
            <Row key={v.id} last={i === recent.length - 1}>
              <td style={{ ...td, maxWidth: 280 }}><RecordLink href={`/assurance/actions/${v.action_id}`} reference={v.action_reference} title={v.action_title} /></td>
              <td style={td}>#{v.attempt_number}</td>
              <td style={td}><Badge value={v.result} /></td>
              <td style={td}>{v.verified_by_name ?? <Dim>—</Dim>}</td>
              <td style={td}><DateCell value={v.verified_at} withTime /></td>
              <td style={td}>{v.evidence_count || <Dim>0</Dim>}</td>
              <td style={{ ...td, maxWidth: 260, whiteSpace: 'pre-wrap' }}>{v.notes ?? <Dim>—</Dim>}</td>
            </Row>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
