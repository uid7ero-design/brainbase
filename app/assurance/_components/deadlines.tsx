// Deadline presentation for Finding / Action detail pages and the Deadlines
// register. Server-safe (no hooks); lifecycle controls are the existing
// client ActionPanel disclosure forms. The page decides which controls a
// viewer sees from their role; every API route and service re-checks
// permission, tenant, visibility and state regardless.
import type { ReactNode } from 'react';
import { formatAssuranceDate, formatAssuranceDateTime, assuranceLabel } from '@/lib/assurance/domain';
import {
  ESCALATION_LEVEL_MAX, URGENCY_LABEL, deadlineUrgency, isExtended, type DeadlineUrgency,
} from '@/lib/assurance/deadlineRules';
import type { EscalationRow, ExtensionHistoryRow, RecordTimeframe } from '@/lib/assurance/deadlines';
import type { AssuranceTone } from '@/lib/assurance/domain';
import ActionPanel from './ActionPanel';
import type { FormField } from './AssuranceForm';
import { Badge, Dim, KeyValues, assuranceStyles as styles } from './ui';

const URGENCY_TONE: Record<DeadlineUrgency, AssuranceTone> = {
  OVERDUE: 'danger',
  DUE_SOON: 'warning',
  ON_TRACK: 'neutral',
  CLOSED: 'neutral',
};

export function UrgencyBadge({ urgency }: { urgency: DeadlineUrgency }) {
  return <Badge value={urgency} tone={URGENCY_TONE[urgency]} label={URGENCY_LABEL[urgency]} />;
}

const TIMEFRAME_LABEL: Record<string, string> = {
  CLOSURE: 'Closure deadline',
  ACTION: 'Action deadline',
};
export const timeframeLabel = (type: string) => TIMEFRAME_LABEL[type] ?? `${assuranceLabel(type)} deadline`;

export type DeadlineCapabilities = {
  canRecord: boolean;
  canAdminister: boolean;
  userId: string;
  timeZone: string;
  users: { value: string; label: string }[];
};

const levelOptions = Array.from({ length: ESCALATION_LEVEL_MAX }, (_, i) => ({ value: String(i + 1), label: `Level ${i + 1}` }));

/** All deadlines of one finding or action, with history and the controls the viewer may use. */
export function DeadlineSection({ timeframes, caps, recordLabel }: { timeframes: RecordTimeframe[]; caps: DeadlineCapabilities; recordLabel: string }) {
  if (timeframes.length === 0) {
    return (
      <div className={styles.deadlineEmpty} role="status">
        <p className={styles.deadlineEmptyTitle}>No due date</p>
        <p className={styles.dim}>This {recordLabel} was created without a due date. A due date can only be set when the {recordLabel} is created.</p>
      </div>
    );
  }
  return (
    <div className={styles.deadlineList}>
      {timeframes.map(t => <TimeframeCard key={t.id} t={t} caps={caps} />)}
    </div>
  );
}

function TimeframeCard({ t, caps }: { t: RecordTimeframe; caps: DeadlineCapabilities }) {
  const urgency = deadlineUrgency(t.current_due_at, t.open);
  const extended = isExtended(t.original_due_at, t.current_due_at);
  const pending = t.extensions.find(x => x.status === 'PENDING');
  const openEscalations = t.escalations.filter(e => e.status === 'OPEN' || e.status === 'ACKNOWLEDGED');
  const tz = caps.timeZone;
  const canAct = t.open && caps.canRecord;

  return (
    <section className={styles.deadlineCard} aria-label={timeframeLabel(t.timeframe_type)}>
      <div className={styles.deadlineHead}>
        <span className={styles.deadlineTitle}>{timeframeLabel(t.timeframe_type)}</span>
        <span className={styles.deadlineBadges}>
          <UrgencyBadge urgency={urgency} />
          {extended && <Badge value="EXTENDED" tone="info" label="Extended" />}
          {openEscalations.length > 0 && <Badge value="ESCALATED" tone="accent" label={`Escalated · Level ${Math.max(...openEscalations.map(e => e.escalation_level))}`} />}
        </span>
      </div>
      <KeyValues columns={3} items={[
        { label: 'Effective due date', value: formatAssuranceDateTime(t.current_due_at, tz) },
        { label: 'Original due date', value: formatAssuranceDateTime(t.original_due_at, tz) },
        { label: 'Deadline status', value: t.open ? (urgency === 'OVERDUE' ? 'Overdue' : 'Running') : 'Finished (record closed or cancelled)' },
      ]} />

      {pending && <PendingRequest x={pending} t={t} caps={caps} />}

      {canAct && (
        <div className={styles.row} style={{ marginTop: 12 }}>
          {!pending && (
            <ActionPanel label="Request extension" endpoint={`/api/assurance/timeframes/${t.id}/extensions`}
              description={<>The effective due date stays <strong>{formatAssuranceDate(t.current_due_at, tz)}</strong> until an organisation admin approves the request. The original due date never changes.</>}
              fields={[
                { kind: 'date', name: 'requestedDueAt', label: 'New due date', required: true, help: 'Must be later than the current due date. Due at the end of the chosen day.' },
                { kind: 'textarea', name: 'reason', label: 'Reason', required: true, rows: 3 },
              ]}
              submitLabel="Request extension" />
          )}
          <ActionPanel label="Escalate" endpoint={`/api/assurance/timeframes/${t.id}/escalations`}
            description="Escalating flags this deadline for elevated attention. It does not change the due date or the record, and does not imply fault."
            fields={[
              { kind: 'select', name: 'level', label: 'Escalation level', required: true, options: levelOptions, defaultValue: '1' },
              { kind: 'textarea', name: 'reason', label: 'Reason', required: true, rows: 3 },
              { kind: 'select', name: 'assignedUserId', label: 'Assign to (optional)', options: caps.users, emptyLabel: 'No one' },
            ]}
            submitLabel="Escalate" />
        </div>
      )}

      <ExtensionHistory rows={t.extensions} tz={tz} />
      <Escalations rows={t.escalations} caps={caps} tz={tz} />
    </section>
  );
}

function PendingRequest({ x, t, caps }: { x: ExtensionHistoryRow; t: RecordTimeframe; caps: DeadlineCapabilities }) {
  const tz = caps.timeZone;
  const mine = x.requested_by === caps.userId;
  const canDecide = caps.canAdminister && !mine;
  const canWithdraw = caps.canRecord && (mine || caps.canAdminister);
  const summary: ReactNode = (
    <dl className={styles.deadlineImpact}>
      <div><dt>Current</dt><dd>{formatAssuranceDate(t.current_due_at, tz)}</dd></div>
      <div><dt>Requested</dt><dd>{formatAssuranceDate(x.requested_due_at, tz)}</dd></div>
      <div><dt>Asked by</dt><dd>{x.requested_by_name ?? 'Unknown'} · {formatAssuranceDateTime(x.requested_at, tz)}</dd></div>
      <div><dt>Reason</dt><dd>{x.reason}</dd></div>
    </dl>
  );
  return (
    <div className={styles.deadlinePending} role="group" aria-label="Extension request awaiting a decision">
      <p className={styles.deadlinePendingTitle}>Extension requested — awaiting a decision</p>
      {summary}
      {mine && <p className={styles.dim} style={{ margin: '8px 0 0' }}>You asked for this extension, so another organisation admin must decide it.</p>}
      {!caps.canAdminister && <p className={styles.dim} style={{ margin: '8px 0 0' }}>An organisation admin decides extension requests.</p>}
      <div className={styles.row} style={{ marginTop: 10 }}>
        {canDecide && (
          <ActionPanel label="Approve" variant="primary" endpoint={`/api/assurance/extensions/${x.id}/approve`}
            description={<>Approving moves the effective due date from <strong>{formatAssuranceDate(t.current_due_at, tz)}</strong> to <strong>{formatAssuranceDate(x.requested_due_at, tz)}</strong> (or the date you choose below). The original due date and the request history are kept.</>}
            fields={[
              { kind: 'date', name: 'approvedDueAt', label: 'Approve a different date (optional)', help: 'Leave blank to approve the requested date. Must be later than the current due date.' },
              { kind: 'textarea', name: 'notes', label: 'Notes (optional)', rows: 2 },
            ]}
            submitLabel="Approve extension" />
        )}
        {canDecide && (
          <ActionPanel label="Reject" variant="danger" endpoint={`/api/assurance/extensions/${x.id}/reject`}
            description="Rejecting keeps the current due date. The request stays in the history."
            fields={[{ kind: 'textarea', name: 'notes', label: 'Reason for rejecting', required: true, rows: 2 }]}
            submitLabel="Reject extension" />
        )}
        {canWithdraw && (
          <ActionPanel label="Withdraw request" endpoint={`/api/assurance/extensions/${x.id}/cancel`}
            confirm="Withdraw this extension request? The current due date stays as it is; the request stays in the history as withdrawn."
            submitLabel="Withdraw request" />
        )}
      </div>
    </div>
  );
}

function ExtensionHistory({ rows, tz }: { rows: ExtensionHistoryRow[]; tz: string }) {
  const decided = rows.filter(r => r.status !== 'PENDING');
  if (decided.length === 0) return null;
  return (
    <div className={styles.deadlineHistory}>
      <p className={styles.deadlineSubhead}>Extension history</p>
      <ol className={styles.history}>
        {decided.map(r => (
          <li key={r.id}>
            <span className={styles.historyWhen}>{formatAssuranceDateTime(r.decided_at ?? r.requested_at, tz)}</span>
            <span className={styles.historyWhat}>
              <Badge value={r.status} label={r.status === 'CANCELLED' ? 'Withdrawn' : assuranceLabel(r.status)} />{' '}
              {formatAssuranceDate(r.previous_due_at, tz)} → {formatAssuranceDate(r.approved_due_at ?? r.requested_due_at, tz)}
              {r.status !== 'APPROVED' && <Dim> (requested)</Dim>}
              <span className={styles.deadlineReason}>Reason: {r.reason}</span>
              {r.decision_notes && <span className={styles.deadlineReason}>{r.status === 'REJECTED' ? 'Rejected because' : 'Notes'}: {r.decision_notes}</span>}
            </span>
            <span className={styles.historyWho}>{r.requested_by_name ?? 'Unknown'}{r.decided_by_name ? ` · decided by ${r.decided_by_name}` : ''}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Escalations({ rows, caps, tz }: { rows: EscalationRow[]; caps: DeadlineCapabilities; tz: string }) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.deadlineHistory}>
      <p className={styles.deadlineSubhead}>Escalations</p>
      <ol className={styles.history}>
        {rows.map(e => (
          <li key={e.id}>
            <span className={styles.historyWhen}>{formatAssuranceDateTime(e.escalated_at, tz)}</span>
            <span className={styles.historyWhat}>
              <Badge value={e.status} label={assuranceLabel(e.status)} /> Level {e.escalation_level}
              <span className={styles.deadlineReason}>Reason: {e.reason}</span>
              {e.assigned_user_name && <span className={styles.deadlineReason}>Assigned to {e.assigned_user_name}</span>}
              {e.acknowledged_at && <span className={styles.deadlineReason}>Acknowledged by {e.acknowledged_by_name ?? 'Unknown'} · {formatAssuranceDateTime(e.acknowledged_at, tz)}</span>}
              {e.resolved_at && <span className={styles.deadlineReason}>Resolved by {e.resolved_by_name ?? 'Unknown'} · {formatAssuranceDateTime(e.resolved_at, tz)}</span>}
              {e.notes && <span className={styles.deadlineReason}>Notes: {e.notes}</span>}
              {caps.canRecord && <EscalationControls e={e} />}
            </span>
            <span className={styles.historyWho}>{e.escalated_by_name ?? 'Unknown'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EscalationControls({ e }: { e: EscalationRow }) {
  const base = `/api/assurance/escalations/${e.id}`;
  const notes: FormField = { kind: 'textarea', name: 'notes', label: 'Notes (optional)', rows: 2 };
  if (e.status !== 'OPEN' && e.status !== 'ACKNOWLEDGED') return null;
  return (
    <span className={styles.row} style={{ marginTop: 8 }}>
      {e.status === 'OPEN' && (
        <ActionPanel label="Acknowledge" endpoint={`${base}/acknowledge`} fields={[notes]} submitLabel="Acknowledge escalation"
          description="Acknowledging records that someone has picked this up. It does not change the deadline or the record." />
      )}
      {e.status === 'ACKNOWLEDGED' && (
        <ActionPanel label="Resolve" endpoint={`${base}/resolve`} fields={[notes]} submitLabel="Resolve escalation"
          description="Resolving ends this escalation only. It does not complete or close the work, meet the deadline or change the due date." />
      )}
      <ActionPanel label="Cancel escalation" variant="danger" endpoint={`${base}/cancel`}
        fields={[{ kind: 'textarea', name: 'notes', label: 'Reason for cancelling', required: true, rows: 2 }]}
        submitLabel="Cancel escalation" />
    </span>
  );
}
