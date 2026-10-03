import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContractorDetail, listActiveRequirementOptions, type AssignmentView, type SubmissionView } from '@/lib/assurance/contractorAssurance';
import { ASSIGNMENT_STATE_LABEL, HEADLINE_LABEL, HEADLINE_TONE, type AssignmentState } from '@/lib/assurance/contractorAssuranceRules';
import { viewerCan } from '@/lib/assurance/authorize';
import { EVIDENCE_TYPES, FINDING_TYPES, assuranceLabel, formatAssuranceDate, formatAssuranceDateTime } from '@/lib/assurance/domain';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import {
  Badge, Breadcrumbs, Card, Dim, HistoryList, KeyValues, Notice, PageHeader, Section, enumOptions, assuranceStyles as styles, tableStyles,
} from '../../_components/ui';

export const dynamic = 'force-dynamic';

const STATE_TONE: Record<AssignmentState, 'danger' | 'warning' | 'success'> = {
  EXPIRED: 'danger', EXPIRING_SOON: 'warning', MISSING: 'warning', CURRENT: 'success',
};

/** Calendar dates (YYYY-MM-DD) are shown as dates, never shifted by a time zone. */
const cal = (iso: string | null) => (iso ? formatAssuranceDate(`${iso}T00:00:00Z`, 'UTC') : '—');

function SubmissionFacts({ s, tz }: { s: SubmissionView; tz: string }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'grid', gap: 2, overflowWrap: 'anywhere' }}>
      <div>
        <Link href={`/assurance/evidence/${s.evidence_id}`} className={tableStyles.link}>{s.evidence_reference}</Link>
        {s.title ? ` · ${s.title}` : ''} · {assuranceLabel(s.evidence_type)}
      </div>
      <div>Supplied {cal(s.supplied_on)}{s.effective_from ? ` · effective ${cal(s.effective_from)}` : ''} · {s.expires_on ? `expires ${cal(s.expires_on)}` : 'no expiry date'}</div>
      {s.held_at && <div>Held at: {s.held_at}</div>}
      <div>Recorded by {s.recorded_by_name ?? 'unknown'} · {formatAssuranceDateTime(s.recorded_at, tz)}</div>
      {s.decided_at && (
        <div>
          {s.status === 'WITHDRAWN' ? 'Withdrawn' : s.status === 'REJECTED' ? 'Rejected' : 'Accepted'} by {s.decided_by_name ?? 'unknown'} · {formatAssuranceDateTime(s.decided_at, tz)}
          {s.decision_reason ? ` — ${s.decision_reason}` : ''}
        </div>
      )}
      {s.superseded_at && <div>Superseded {formatAssuranceDateTime(s.superseded_at, tz)} by newer accepted evidence</div>}
      {s.notes && <div>Notes: {s.notes}</div>}
    </div>
  );
}

function SnapshotNotice({ s, a }: { s: SubmissionView; a: AssignmentView }) {
  if (!s.requirement_changed_since) return null;
  const then = s.snapshot, now = a.requirement;
  const text = (v: string | null) => (v && v.trim() ? v : 'none');
  const notice = (d: number | null) => (d ? `${d} days` : 'none');
  const changes: [string, string, string][] = [
    ['Name', then.name, now.name],
    ['Category', assuranceLabel(then.category), assuranceLabel(now.category)],
    ['Description', text(then.description), text(now.description)],
    ['Evidence guidance', text(then.evidence_guidance), text(now.evidence_guidance)],
    ['Expiry date', then.expiry_required ? 'required' : 'not required', now.expiry_required ? 'required' : 'not required'],
    ['Renewal notice', notice(then.renewal_notice_days), notice(now.renewal_notice_days)],
  ].filter(([, was, is]) => was !== is) as [string, string, string][];
  return (
    <Notice tone="warning">
      The requirement has changed since this evidence was recorded. The evidence was assessed against the requirement as it stood then.
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {changes.map(([field, was, is]) => <li key={field}>{field}: was <strong>{was}</strong>, now <strong>{is}</strong></li>)}
      </ul>
    </Notice>
  );
}

export default async function ContractorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getContractorDetail(viewer, id);
  if (!detail) notFound();
  const canRecord = viewerCan(viewer, 'record');
  const canVerify = viewerCan(viewer, 'verify');
  const canClose = viewerCan(viewer, 'close');
  const [requirementOptions, users] = await Promise.all([
    canRecord ? listActiveRequirementOptions(viewer) : Promise.resolve([]),
    canRecord ? listOrgUserOptions(viewer.organisationId) : Promise.resolve([]),
  ]);
  const { organisation: o, scope, assignments, tz } = { ...detail, tz: detail.timeZone };
  const activeRequirementIds = new Set(assignments.filter(a => a.status === 'ACTIVE').map(a => a.requirement.id));
  const assignable = requirementOptions.filter(r => !activeRequirementIds.has(r.id));
  const inScope = scope?.status === 'IN_SCOPE';
  const active = assignments.filter(a => a.status === 'ACTIVE');
  const cancelled = assignments.filter(a => a.status === 'CANCELLED');
  const userOptions = users.map(u => ({ value: u.id, label: u.name }));
  // The history spans scope, assignment and evidence rows, so each entry names what it is about.
  const requirementFor = new Map<string, string>();
  for (const a of assignments) {
    requirementFor.set(a.id, a.requirement.name);
    for (const s of a.history) requirementFor.set(s.id, a.requirement.name);
  }
  const kindLabel: Record<string, string> = {
    assurance_external_organisation_scope: 'Scope',
    assurance_requirement_assignment: 'Assignment',
    assurance_contractor_evidence: 'Evidence',
  };
  const historyEntries = detail.history.map(e => {
    const verb = assuranceLabel((e.action.split('.')[1] ?? e.action).toUpperCase()).toLowerCase();
    const about = requirementFor.get(e.resource_id);
    return { ...e, label: `${kindLabel[e.resource_type] ?? 'Record'} ${verb}${about ? ` — ${about}` : ''}` };
  });

  return (
    <div style={{ maxWidth: 1040 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/contractors', label: 'Contractor assurance' }, { label: o.reference }]} />
      <PageHeader help="contractor"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{o.reference}</span>
          {!scope ? <Badge value="NOT_IN_SCOPE" tone="neutral" label="Not in Assurance scope" />
            : scope.status === 'OUT_OF_SCOPE' ? <Badge value="OUT_OF_SCOPE" tone="neutral" label="Out of scope" />
            : <Badge value={detail.headline} tone={HEADLINE_TONE[detail.headline]} label={HEADLINE_LABEL[detail.headline]} />}
          {o.status !== 'ACTIVE' && <Badge value={o.status} tone="neutral" />}
        </span>}
        title={o.name}
        subtitle={<>{o.roles.length ? o.roles.map(r => assuranceLabel(r)).join(', ') : 'No relationship roles recorded'} · shared record in <Link href="/assurance/settings/reference-data/external-organisations" className={tableStyles.link}>Settings → Reference data</Link></>}
      />

      {!scope && (
        <Section title="Assurance scope">
          <Card>
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>This organisation is not in Assurance scope. Bring it into scope to assign requirements and record evidence.</p>
            {canRecord && o.status === 'ACTIVE' && (
              <ActionPanel label="Bring into Assurance scope" variant="primary" endpoint="/api/assurance/contractors/scope" extraBody={{ externalOrganisationId: o.id }}
                fields={[
                  { kind: 'select', name: 'responsibleUserId', label: 'Responsible person (optional)', options: userOptions, emptyLabel: 'No one' },
                  { kind: 'textarea', name: 'notes', label: 'Notes (optional)', rows: 2 },
                ]}
                submitLabel="Bring into scope" />
            )}
          </Card>
        </Section>
      )}

      {scope && (
        <Section title="Assurance scope">
          <Card>
            <KeyValues items={[
              { label: 'Scope', value: scope.status === 'IN_SCOPE' ? 'In scope' : 'Out of scope' },
              { label: 'Responsible', value: scope.responsible_name ?? <Dim>—</Dim> },
              { label: 'Scope changed', value: formatAssuranceDateTime(scope.status_changed_at, tz) },
              { label: 'Active requirements', value: String(active.length) },
              { label: 'Expired / expiring soon', value: `${detail.counts.EXPIRED} / ${detail.counts.EXPIRING_SOON}` },
              { label: 'Missing / awaiting review', value: `${detail.counts.MISSING} / ${detail.awaiting_review}` },
            ]} />
            {scope.notes && <p style={{ fontSize: 13, margin: '10px 0 0', overflowWrap: 'anywhere' }}>{scope.notes}</p>}
            {scope.status === 'OUT_OF_SCOPE' && (
              <div style={{ marginTop: 10 }}><Notice>Out of scope: hidden from the register. Requirements, evidence and history are kept unchanged, and no new requirements can be assigned.</Notice></div>
            )}
            {canRecord && (
              <div style={{ marginTop: 12 }}>
                <ActionPanel label="Change scope or responsible person" endpoint="/api/assurance/contractors/scope"
                  extraBody={{ externalOrganisationId: o.id, lockVersion: scope.lock_version }}
                  description="Moving an organisation out of scope keeps all assignments, evidence and history; nothing is cancelled or deleted."
                  fields={[
                    { kind: 'select', name: 'status', label: 'Scope', required: true, defaultValue: scope.status,
                      options: [{ value: 'IN_SCOPE', label: 'In scope' }, { value: 'OUT_OF_SCOPE', label: 'Out of scope' }] },
                    { kind: 'select', name: 'responsibleUserId', label: 'Responsible person', options: userOptions, emptyLabel: 'No one', defaultValue: scope.responsible_user_id ?? '' },
                    { kind: 'textarea', name: 'notes', label: 'Notes', rows: 2, defaultValue: scope.notes ?? '' },
                  ]}
                  submitLabel="Save scope" />
              </div>
            )}
          </Card>
        </Section>
      )}

      {scope && inScope && canRecord && (
        <div style={{ margin: '0 0 18px' }}>
          {assignable.length > 0 ? (
            <ActionPanel label="Assign a requirement" variant="primary" endpoint="/api/assurance/contractors/assignments" extraBody={{ externalOrganisationId: o.id }}
              fields={[
                { kind: 'select', name: 'requirementId', label: 'Requirement', required: true,
                  options: assignable.map(r => ({ value: r.id, label: `${r.name} (${r.requirement_code})` })) },
                { kind: 'calendarDate', name: 'requiredFrom', label: 'Required from (optional)' },
                { kind: 'calendarDate', name: 'dueDate', label: 'Evidence due by (optional)' },
                { kind: 'select', name: 'reviewerUserId', label: 'Reviewer (optional)', options: userOptions, emptyLabel: 'No one' },
                { kind: 'textarea', name: 'notes', label: 'Notes (optional)', rows: 2 },
              ]}
              submitLabel="Assign requirement" />
          ) : (
            <Dim>{requirementOptions.length === 0
              ? <>No active requirements in the <Link href="/assurance/contractors/requirements" className={tableStyles.link}>requirement library</Link> yet.</>
              : 'Every active requirement is already assigned.'}</Dim>
          )}
        </div>
      )}

      {scope && active.length === 0 && <Section title="Requirements"><Card><Dim>No requirements are assigned.</Dim></Card></Section>}

      {active.map(a => (
        <Section key={a.id} title={a.requirement.name} id={`a-${a.id}`}>
          <Card>
            <div className={styles.eyebrowRow} style={{ marginBottom: 8, flexWrap: 'wrap' }}>
              {a.state && <Badge value={a.state} tone={STATE_TONE[a.state]} label={ASSIGNMENT_STATE_LABEL[a.state]} />}
              {a.pending.length > 0 && <Badge value="AWAITING_REVIEW" tone="info" label={`${a.pending.length} awaiting review`} />}
              {a.requirement.status === 'INACTIVE' && <Badge value="INACTIVE" tone="neutral" label="Requirement inactive" />}
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.requirement.requirement_code} · {assuranceLabel(a.requirement.category)}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, overflowWrap: 'anywhere' }}>
              {a.requirement.description && <div>{a.requirement.description}</div>}
              {a.requirement.evidence_guidance && <div>Evidence: {a.requirement.evidence_guidance}</div>}
              <div>
                Expiry {a.requirement.expiry_required ? 'required' : 'not required'} · renewal notice {a.requirement.renewal_notice_days ? `${a.requirement.renewal_notice_days} days` : 'none'}
                {a.due_date ? ` · evidence due by ${cal(a.due_date)}` : ''}{a.reviewer_name ? ` · reviewer ${a.reviewer_name}` : ''}
              </div>
              {a.requirement.status === 'INACTIVE' && <div>This requirement is inactive in the library: it cannot be newly assigned, but this assignment and its history continue.</div>}
            </div>

            <h3 style={{ fontSize: 13, margin: '8px 0 4px' }}>Current evidence</h3>
            {a.current ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <SubmissionFacts s={a.current} tz={tz} />
                <SnapshotNotice s={a.current} a={a} />
              </div>
            ) : <Dim>No accepted evidence.</Dim>}

            {a.pending.length > 0 && <h3 style={{ fontSize: 13, margin: '12px 0 4px' }}>Awaiting review</h3>}
            {a.pending.map(p => (
              <div key={p.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8, display: 'grid', gap: 6 }}>
                <SubmissionFacts s={p} tz={tz} />
                <SnapshotNotice s={p} a={a} />
                <div className={styles.row} style={{ gap: 8 }}>
                  {canVerify && p.recorded_by !== viewer.userId && (
                    <ActionPanel label="Accept or reject" variant="primary" endpoint={`/api/assurance/contractors/submissions/${p.id}/decide`}
                      extraBody={{ lockVersion: p.lock_version }}
                      description={a.current
                        ? 'Accepting makes this the current evidence; the previously accepted evidence is kept as superseded history. Rejecting leaves the current evidence in place.'
                        : 'Accepting makes this the current evidence for the requirement.'}
                      fields={[
                        { kind: 'select', name: 'decision', label: 'Decision', required: true, options: [{ value: 'ACCEPT', label: 'Accept' }, { value: 'REJECT', label: 'Reject' }] },
                        { kind: 'textarea', name: 'reason', label: 'Reason (required to reject)', rows: 2 },
                      ]}
                      submitLabel="Record decision" />
                  )}
                  {canVerify && p.recorded_by === viewer.userId && <Dim>You recorded this evidence, so someone else must accept or reject it.</Dim>}
                  {canRecord && (
                    <ActionPanel label="Withdraw" endpoint={`/api/assurance/contractors/submissions/${p.id}/withdraw`} extraBody={{ lockVersion: p.lock_version }}
                      fields={[{ kind: 'textarea', name: 'reason', label: 'Reason (optional)', rows: 2 }]} submitLabel="Withdraw evidence" />
                  )}
                </div>
              </div>
            ))}

            {canRecord && (
              <div className={styles.row} style={{ gap: 8, marginTop: 12 }}>
                <ActionPanel label="Record evidence" endpoint={`/api/assurance/contractors/assignments/${a.id}/submissions`}
                  description="Record what was supplied and where the document is held. There is no file upload yet; the original stays where it is held. A replacement never deletes earlier evidence."
                  fields={[
                    { kind: 'text', name: 'title', label: 'Title', required: true, placeholder: 'e.g. Certificate of currency 2026–27' },
                    { kind: 'select', name: 'evidenceType', label: 'Evidence type', options: enumOptions(EVIDENCE_TYPES), defaultValue: 'DOCUMENT', required: true },
                    { kind: 'text', name: 'heldAt', label: 'Document location or link', maxLength: 500, placeholder: 'e.g. shared drive path or document URL' },
                    { kind: 'calendarDate', name: 'suppliedOn', label: 'Supplied on', required: true },
                    { kind: 'calendarDate', name: 'effectiveFrom', label: 'Effective from (optional)' },
                    { kind: 'calendarDate', name: 'expiresOn', label: a.requirement.expiry_required ? 'Expires on (needed before it can be accepted)' : 'Expires on (optional)' },
                    { kind: 'textarea', name: 'description', label: 'Description (optional)', rows: 2 },
                    { kind: 'textarea', name: 'notes', label: 'Notes (optional)', rows: 2 },
                  ]}
                  submitLabel="Record evidence" />
                <ActionPanel label="Raise finding" endpoint="/api/assurance/findings" extraBody={{ requirementAssignmentId: a.id }}
                  description="Only raise a finding when there is a genuine assurance issue. Missing or expired evidence does not create one automatically. Actions are then created from the finding."
                  fields={[
                    { kind: 'select', name: 'findingType', label: 'Finding type', required: true, options: enumOptions(FINDING_TYPES) },
                    { kind: 'text', name: 'title', label: 'Title', required: true },
                    { kind: 'textarea', name: 'description', label: 'Description', required: true, rows: 3 },
                  ]}
                  submitLabel="Raise finding" />
                {canClose && (
                  <ActionPanel label="Cancel assignment" variant="danger" endpoint={`/api/assurance/contractors/assignments/${a.id}/cancel`}
                    extraBody={{ lockVersion: a.lock_version }}
                    description="The requirement stops applying to this organisation. Its evidence and decisions stay in the history."
                    fields={[{ kind: 'textarea', name: 'reason', label: 'Reason', required: true, rows: 2 }]} submitLabel="Cancel assignment" />
                )}
              </div>
            )}

            {a.findings.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 12 }}>
                <strong>Findings:</strong>{' '}
                {a.findings.map((f, i) => (
                  <span key={f.id}>{i > 0 ? ', ' : ''}<Link href={`/assurance/findings/${f.id}`} className={tableStyles.link}>{f.finding_reference}</Link> {f.title} ({assuranceLabel(f.status).toLowerCase()})</span>
                ))}
              </div>
            )}

            {a.history.filter(s => s.status !== 'SUBMITTED' && s.status !== 'ACCEPTED').length > 0 && (
              <details className={styles.details} style={{ marginTop: 12 }}>
                <summary>Evidence history ({a.history.filter(s => s.status !== 'SUBMITTED' && s.status !== 'ACCEPTED').length})</summary>
                <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                  {a.history.filter(s => s.status !== 'SUBMITTED' && s.status !== 'ACCEPTED').map(s => (
                    <div key={s.id} style={{ display: 'grid', gap: 4 }}>
                      <div><Badge value={s.status} /></div>
                      <SubmissionFacts s={s} tz={tz} />
                      <SnapshotNotice s={s} a={a} />
                    </div>
                  ))}
                </div>
              </details>
            )}
          </Card>
        </Section>
      ))}

      {cancelled.length > 0 && (
        <Section title="Cancelled assignments" count={cancelled.length}>
          {cancelled.map(a => (
            <details key={a.id} className={styles.details} style={{ marginBottom: 8 }}>
              <summary>{a.requirement.name} · cancelled {a.cancelled_at ? formatAssuranceDateTime(a.cancelled_at, tz) : ''}</summary>
              <Card>
                {a.cancel_reason && <p style={{ fontSize: 12, margin: '0 0 8px' }}>Reason: {a.cancel_reason}</p>}
                {a.history.length === 0 ? <Dim>No evidence was recorded.</Dim> : a.history.map(s => (
                  <div key={s.id} style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                    <div><Badge value={s.status} /></div>
                    <SubmissionFacts s={s} tz={tz} />
                  </div>
                ))}
              </Card>
            </details>
          ))}
        </Section>
      )}

      <Section title="History">
        <Card><HistoryList entries={historyEntries} timeZone={tz} /></Card>
      </Section>
    </div>
  );
}
