import Link from 'next/link';
import type { EvidenceLinkRow } from '@/lib/assurance/incidents';
import { EVIDENCE_TYPES, FINDING_TYPES, assuranceLabel, type EvidenceLinkTarget } from '@/lib/assurance/domain';
import {
  EVIDENCE_STATE_LABEL, EVIDENCE_STATE_TONE, evidenceState,
  type ContractorSubmissionStatus, type EvidenceVerificationStatus,
} from '@/lib/assurance/evidenceRules';
import type { RiskLevelOption, NamedOption } from '@/lib/assurance/lookups';
import type { OrgUserOption } from '@/lib/assurance/users';
import type { ExecutionReadiness } from '@/lib/assurance/executionRules';
import ActionPanel from './ActionPanel';
import type { FormField } from './AssuranceForm';
import { Badge, Card, DataTable, DateCell, Dim, RecordLink, Row, assuranceStyles as styles, enumOptions, tableStyles, td } from './ui';

// Detail-page building blocks shared by Incident / Investigation /
// Inspection / Finding / Action pages.

/** The single authoritative evidence state (contractor submission wins), as a badge. */
export function EvidenceStateBadge({ verificationStatus, contractorStatus }: { verificationStatus?: string; contractorStatus?: string | null }) {
  if (!verificationStatus) return null;
  const { state, authority } = evidenceState({
    verificationStatus: verificationStatus as EvidenceVerificationStatus,
    contractorStatus: (contractorStatus ?? null) as ContractorSubmissionStatus | null,
  });
  return (
    <span title={authority === 'contractor' ? 'Decided in Contractor assurance' : undefined}>
      <Badge value={state} tone={EVIDENCE_STATE_TONE[state]} label={EVIDENCE_STATE_LABEL[state]} />
      {authority === 'contractor' && <div className={tableStyles.meta}>Contractor assurance</div>}
    </span>
  );
}

/**
 * Evidence linked to a record. `items` (inspection checklist items or audit
 * criteria recorded on this record) lets new evidence carry that structured
 * context; it is fixed once linked.
 */
export function EvidenceSection({ rows, target, targetId, canRecord, locked, items }: {
  rows: EvidenceLinkRow[]; target: EvidenceLinkTarget; targetId: string; canRecord: boolean; locked?: string;
  items?: { value: string; label: string }[];
}) {
  const active = rows.filter(r => !r.removed_at);
  const removed = rows.filter(r => r.removed_at);
  const withItems = target === 'inspection' || target === 'audit';
  const itemLabel = target === 'audit' ? 'Criterion' : 'Checklist item';
  return (
    <div className={styles.stackTight}>
      {active.length === 0 ? (
        <Card><Dim>No evidence is linked.</Dim></Card>
      ) : (
        <DataTable headers={withItems ? ['Evidence', 'Type', itemLabel, 'Verification', 'Linked', ''] : ['Evidence', 'Type', 'Purpose', 'Verification', 'Linked', '']} minWidth={720}>
          {active.map((r, i) => (
            <Row key={r.link_id} last={i === active.length - 1}>
              <td style={td}><RecordLink href={`/assurance/evidence/${r.evidence_id}`} reference={r.evidence_reference} title={r.title} /></td>
              <td style={td}>{assuranceLabel(r.evidence_type)}</td>
              {withItems
                ? <td style={td}>{r.item_label ?? <Dim>Whole record</Dim>}{r.purpose && <div className={tableStyles.meta}>{r.purpose}</div>}</td>
                : <td style={td}>{r.purpose ?? <Dim>—</Dim>}</td>}
              <td style={td}><EvidenceStateBadge verificationStatus={r.verification_status} contractorStatus={r.contractor_status} /></td>
              <td style={td}><DateCell value={r.linked_at} /><div className={tableStyles.meta}>{r.linked_by_name ?? ''}</div></td>
              <td style={{ ...td, width: 1 }}>
                {canRecord && !locked && target !== 'verification' && (
                  <ActionPanel label="Remove link" variant="danger" endpoint="/api/assurance/evidence/unlink"
                    extraBody={{ target, linkId: r.link_id }}
                    description="The evidence record is kept. The link is marked removed with your reason, and stays visible in the history."
                    fields={[{ kind: 'text', name: 'reason', label: 'Reason for removal', required: true, maxLength: 1000 }]}
                    submitLabel="Remove link" />
                )}
              </td>
            </Row>
          ))}
        </DataTable>
      )}
      {removed.length > 0 && (
        <details className={styles.details}>
          <summary>{removed.length} removed link{removed.length === 1 ? '' : 's'} (history)</summary>
          <ul className={styles.history}>
            {removed.map(r => (
              <li key={r.link_id} style={{ color: 'var(--text-secondary)', display: 'block' }}>
                <Link href={`/assurance/evidence/${r.evidence_id}`} className={tableStyles.link}>{r.evidence_reference}</Link>
                {' '}removed <DateCell value={r.removed_at} /> by {r.removed_by_name ?? 'unknown'} — <em>{r.removal_reason}</em>
              </li>
            ))}
          </ul>
        </details>
      )}
      {locked && <Dim>{locked}</Dim>}
      {canRecord && !locked && (
        <ActionPanel label="Add evidence" endpoint="/api/assurance/evidence" extraBody={{ target, targetId }}
          description="Record what the proof is and where the original is held. (File upload is not available yet.)"
          fields={evidenceFields({
            item: withItems && items && items.length > 0
              ? { name: target === 'audit' ? 'criterionKey' : 'itemKey', label: `${itemLabel} (optional)`, options: items }
              : undefined,
          })} submitLabel="Add evidence" />
      )}
    </div>
  );
}

export function evidenceFields(opts: {
  item?: { name: 'itemKey' | 'criterionKey'; label: string; options: { value: string; label: string }[] };
  suppliers?: { value: string; label: string }[];
  purpose?: boolean;
} = {}): FormField[] {
  const fields: FormField[] = [
    { kind: 'select', name: 'evidenceType', label: 'Type', required: true, options: enumOptions(EVIDENCE_TYPES) },
    { kind: 'text', name: 'title', label: 'Title', required: true, placeholder: 'e.g. Photo of repaired handrail, north stairwell' },
    { kind: 'textarea', name: 'description', label: 'Description', rows: 3 },
    { kind: 'text', name: 'heldAt', label: 'Where the original is held', placeholder: 'e.g. Records system ref, shared drive path', maxLength: 500 },
    { kind: 'datetime', name: 'capturedAt', label: 'Captured', defaultNow: true },
  ];
  if (opts.suppliers && opts.suppliers.length > 0) {
    fields.push({ kind: 'select', name: 'supplierId', label: 'Supplied by (optional)', options: opts.suppliers, emptyLabel: 'Recorded internally' });
  }
  if (opts.item) fields.push({ kind: 'select', name: opts.item.name, label: opts.item.label, options: opts.item.options, emptyLabel: 'The whole record' });
  if (opts.purpose !== false) fields.push({ kind: 'text', name: 'purpose', label: 'Why it is linked here', maxLength: 500 });
  fields.push({ kind: 'checkbox', name: 'requestVerification', label: 'Submit for verification now',
    help: 'Someone other than you then accepts or rejects it. Leave unticked to correct it first.' });
  return fields;
}

export function FindingsTable({ rows, hiddenCount, emptyText }: {
  rows: { id: string; finding_reference: string; title: string; finding_type: string; status: string; identified_at: string | Date }[];
  hiddenCount: number; emptyText: string;
}) {
  return (
    <div className={styles.stackTight}>
      {rows.length === 0 ? <Card><Dim>{emptyText}</Dim></Card> : (
        <DataTable headers={['Finding', 'Type', 'Status', 'Identified']} minWidth={560}>
          {rows.map((f, i) => (
            <Row key={f.id} last={i === rows.length - 1}>
              <td style={td}><RecordLink href={`/assurance/findings/${f.id}`} reference={f.finding_reference} title={f.title} /></td>
              <td style={td}>{assuranceLabel(f.finding_type)}</td>
              <td style={td}><Badge value={f.status} /></td>
              <td style={td}><DateCell value={f.identified_at} /></td>
            </Row>
          ))}
        </DataTable>
      )}
      {hiddenCount > 0 && <Dim>{hiddenCount} further finding{hiddenCount === 1 ? ' is' : 's are'} linked to restricted records you cannot see.</Dim>}
    </div>
  );
}

/**
 * Actions that hang off a record's Findings (source → Finding → Action). The
 * Action is always reached through its Finding; there is no shortcut link.
 */
export function LinkedActionsTable({ rows, emptyText }: {
  rows: { id: string; action_reference: string; title: string; status: string; owner_name: string | null; finding_id: string; finding_reference: string }[];
  emptyText: string;
}) {
  if (rows.length === 0) return <Card><Dim>{emptyText}</Dim></Card>;
  return (
    <DataTable headers={['Action', 'Status', 'Owner', 'From finding']} minWidth={560}>
      {rows.map((a, i) => (
        <Row key={a.id} last={i === rows.length - 1}>
          <td style={td}><RecordLink href={`/assurance/actions/${a.id}`} reference={a.action_reference} title={a.title} /></td>
          <td style={td}><Badge value={a.status} /></td>
          <td style={td}>{a.owner_name ?? <Dim>Unassigned</Dim>}</td>
          <td style={td}><Link href={`/assurance/findings/${a.finding_id}`} className={tableStyles.link}>{a.finding_reference}</Link></td>
        </Row>
      ))}
    </DataTable>
  );
}

/** Register cell: progress (answered / required) and readiness, derived from real statuses only. */
export function ExecutionProgressCell({ readiness, status, noun }: { readiness: ExecutionReadiness; status: string; noun: 'inspection' | 'audit' }) {
  if (status === 'CANCELLED') return <Dim>—</Dim>;
  const word = noun === 'audit' ? 'assessed' : 'answered';
  return (
    <div style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
      {readiness.total === 0 && status === 'PLANNED' ? <Dim>Not started</Dim> : <>{readiness.answered}/{readiness.total} {word}</>}
      {readiness.requiredTotal > 0 && <div className={tableStyles.meta}>{readiness.requiredAnswered}/{readiness.requiredTotal} required</div>}
      {readiness.ready && <div><Badge value="READY" tone="success" label="Ready to complete" /></div>}
      {readiness.incomplete && <div><Badge value="INCOMPLETE" tone="warning" label="Incomplete" /></div>}
    </div>
  );
}

/** Register cell: linked Findings / open Actions / evidence the viewer may see. */
export function LinkedWorkCell({ findings, openActions, evidence }: { findings: number; openActions: number; evidence: number }) {
  if (findings === 0 && openActions === 0 && evidence === 0) return <Dim>—</Dim>;
  return (
    <div style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
      {findings > 0 && <div>{findings} finding{findings === 1 ? '' : 's'}</div>}
      {openActions > 0 && <div>{openActions} open action{openActions === 1 ? '' : 's'}</div>}
      {evidence > 0 && <div className={tableStyles.meta}>{evidence} evidence</div>}
    </div>
  );
}

/**
 * "What remains to be completed?" — the factual completion blockers (the
 * same rule the server enforces), with Findings / open Actions shown as
 * information only: they never block completion. Render it only while the
 * record is planned or in progress.
 */
export function CompletionReadiness({ readiness, noun, findingCount, openActionCount, evidenceCount }: {
  readiness: ExecutionReadiness; noun: 'inspection' | 'audit'; findingCount: number; openActionCount: number; evidenceCount: number;
}) {
  const itemWords = noun === 'audit' ? 'criteria' : 'items';
  return (
    <Card>
      <div className={styles.readiness}>
        <div className={styles.readinessHead}>
          <span className={styles.readinessState} data-ready={readiness.ready || undefined}>
            {readiness.ready ? 'Ready to complete' : 'Not ready to complete'}
          </span>
          <span className={styles.readinessProgress}>
            {readiness.answered} of {readiness.total} {itemWords} answered
            {readiness.requiredTotal > 0 && <> · {readiness.requiredAnswered} of {readiness.requiredTotal} required</>}
          </span>
        </div>
        {!readiness.ready && readiness.blockers.length > 0 && (
          <ul className={styles.readinessBlockers} aria-label="What prevents completion">
            {readiness.blockers.map(b => <li key={b}>{b}</li>)}
          </ul>
        )}
        <div className={styles.readinessInfo}>
          {findingCount} finding{findingCount === 1 ? '' : 's'} · {openActionCount} open action{openActionCount === 1 ? '' : 's'} · {evidenceCount} evidence
          <span className={styles.dim}> — shown for information; they do not block completion, and completing does not close them.</span>
        </div>
      </div>
    </Card>
  );
}

export function raiseFindingFields(opts: {
  risks: RiskLevelOption[]; users: OrgUserOption[]; orgs?: NamedOption[]; defaultType?: string; defaultTitle?: string; defaultDescription?: string;
}): FormField[] {
  return [
    { kind: 'select', name: 'findingType', label: 'Finding type', required: true, options: enumOptions(FINDING_TYPES), defaultValue: opts.defaultType },
    { kind: 'text', name: 'title', label: 'Title', required: true, defaultValue: opts.defaultTitle },
    { kind: 'textarea', name: 'description', label: 'Description', required: true, rows: 4, defaultValue: opts.defaultDescription },
    { kind: 'select', name: 'riskLevelId', label: 'Risk level', options: opts.risks.map(r => ({ value: r.id, label: r.name })) },
    { kind: 'select', name: 'responsibleUserId', label: 'Responsible person', options: opts.users.map(u => ({ value: u.id, label: u.name })), emptyLabel: 'Unassigned' },
    ...(opts.orgs ? [{ kind: 'select', name: 'responsibleExternalOrganisationId', label: 'Responsible external organisation', options: opts.orgs.map(o => ({ value: o.id, label: o.name })) } as FormField] : []),
    { kind: 'date', name: 'dueAt', label: 'Resolve by' },
  ];
}

export function NextStepButtons({ endpoint, options }: { endpoint: string; options: { status: string; label: string; fields?: FormField[]; variant?: 'primary' | 'secondary' | 'danger'; description?: string }[] }) {
  if (options.length === 0) return null;
  return (
    <div className={styles.row}>
      {options.map(o => (
        <ActionPanel key={o.status} label={o.label} endpoint={endpoint} extraBody={{ status: o.status }} fields={o.fields}
          variant={o.variant ?? 'secondary'} description={o.description} submitLabel={o.label} />
      ))}
    </div>
  );
}

/**
 * "Link existing finding" for a source record (incident, investigation,
 * inspection, audit): for a repeat issue that is already being managed as a
 * finding. Only open findings the viewer can see are offered, minus those
 * already linked; the server re-checks tenant, visibility, restriction and
 * state. Renders nothing when there is nothing to link.
 */
export function LinkExistingFinding({ endpoint, options, linkedIds }: {
  endpoint: string; options: { id: string; label: string }[]; linkedIds: Set<string>;
}) {
  const available = options.filter(o => !linkedIds.has(o.id));
  if (available.length === 0) return null;
  return (
    <ActionPanel label="Link existing finding" endpoint={endpoint}
      description="For a repeat issue already being managed as a finding. Corrective actions stay on the finding."
      fields={[{ kind: 'select', name: 'findingId', label: 'Finding', required: true, options: available.map(o => ({ value: o.id, label: o.label })) }]}
      submitLabel="Link finding" />
  );
}
