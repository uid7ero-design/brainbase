import Link from 'next/link';
import type { EvidenceLinkRow } from '@/lib/assurance/incidents';
import { EVIDENCE_TYPES, FINDING_TYPES, assuranceLabel, type EvidenceLinkTarget } from '@/lib/assurance/domain';
import type { RiskLevelOption, NamedOption } from '@/lib/assurance/lookups';
import type { OrgUserOption } from '@/lib/assurance/users';
import ActionPanel from './ActionPanel';
import type { FormField } from './AssuranceForm';
import { Badge, Card, DataTable, DateCell, Dim, RecordLink, Row, assuranceStyles as styles, enumOptions, tableStyles, td } from './ui';

// Detail-page building blocks shared by Incident / Investigation /
// Inspection / Finding / Action pages.

export function EvidenceSection({ rows, target, targetId, canRecord, locked }: {
  rows: EvidenceLinkRow[]; target: EvidenceLinkTarget; targetId: string; canRecord: boolean; locked?: string;
}) {
  const active = rows.filter(r => !r.removed_at);
  const removed = rows.filter(r => r.removed_at);
  return (
    <div className={styles.stackTight}>
      {active.length === 0 ? (
        <Card><Dim>No evidence is linked.</Dim></Card>
      ) : (
        <DataTable headers={['Evidence', 'Type', 'Purpose', 'Linked', '']} minWidth={640}>
          {active.map((r, i) => (
            <Row key={r.link_id} last={i === active.length - 1}>
              <td style={td}><RecordLink href={`/assurance/evidence/${r.evidence_id}`} reference={r.evidence_reference} title={r.title} /></td>
              <td style={td}>{assuranceLabel(r.evidence_type)}</td>
              <td style={td}>{r.purpose ?? <Dim>—</Dim>}</td>
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
          fields={evidenceFields()} submitLabel="Add evidence" />
      )}
    </div>
  );
}

export function evidenceFields(): FormField[] {
  return [
    { kind: 'select', name: 'evidenceType', label: 'Type', required: true, options: enumOptions(EVIDENCE_TYPES) },
    { kind: 'text', name: 'title', label: 'Title', required: true, placeholder: 'e.g. Photo of repaired handrail, north stairwell' },
    { kind: 'textarea', name: 'description', label: 'Description', rows: 3 },
    { kind: 'text', name: 'heldAt', label: 'Where the original is held', placeholder: 'e.g. Records system ref, shared drive path', maxLength: 500 },
    { kind: 'datetime', name: 'capturedAt', label: 'Captured', defaultNow: true },
    { kind: 'text', name: 'purpose', label: 'Why it is linked here', maxLength: 500 },
  ];
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
