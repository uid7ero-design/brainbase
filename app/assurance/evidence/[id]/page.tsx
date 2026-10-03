import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEvidenceDetail, listEvidenceLinkTargetOptions, listSupplierOptions, type EvidenceLinkTargetOptions } from '@/lib/assurance/evidence';
import { EVIDENCE_STATE_LABEL, EVIDENCE_STATE_TONE, canCorrect } from '@/lib/assurance/evidenceRules';
import { getAssuranceTimeZone } from '@/lib/assurance/deadlines';
import { viewerCan } from '@/lib/assurance/authorize';
import { EVIDENCE_TYPES, assuranceLabel, formatAssuranceDateTime } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import { evidenceFields } from '../../_components/shared';
import EvidenceLinkPanel from './EvidenceLinkPanel';
import {
  Badge, Breadcrumbs, Card, DataTable, DateCell, Dim, HistoryList, KeyValues, Notice, PageHeader, Prose, Row, Section, enumOptions, td,
  assuranceStyles as styles, tableStyles,
} from '../../_components/ui';

export const dynamic = 'force-dynamic';

const HREF = {
  incident: '/assurance/incidents', investigation: '/assurance/investigations', inspection: '/assurance/inspections', audit: '/assurance/audits',
  finding: '/assurance/findings', action: '/assurance/actions', verification: '/assurance/actions',
} as const;

const HISTORY_LABEL: Record<string, string> = {
  'assurance_evidence.created': 'Recorded',
  'assurance_evidence.linked': 'Linked',
  'assurance_evidence.unlinked': 'Link removed',
  'assurance_evidence.corrected': 'Corrected',
  'assurance_evidence.verification_requested': 'Submitted for verification',
  'assurance_evidence.verification_withdrawn': 'Withdrawn from verification',
  'assurance_evidence.accepted': 'Accepted',
  'assurance_evidence.rejected': 'Rejected',
  'assurance_evidence.superseded': 'Superseded by replacement',
  'assurance_evidence.replacement_recorded': 'Replacement recorded',
};

export default async function EvidenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getEvidenceDetail(viewer, id);
  if (!detail) notFound();
  const e = detail.evidence;
  const canRecord = viewerCan(viewer, 'record');
  const canVerify = viewerCan(viewer, 'verify');
  const generic = detail.authority === 'evidence';
  const heldAt = typeof e.metadata?.held_at === 'string' ? e.metadata.held_at : null;
  const active = detail.links.filter(l => !l.removed_at);
  const [tz, suppliers, rawTargets] = await Promise.all([
    getAssuranceTimeZone(viewer.organisationId),
    canRecord && generic ? listSupplierOptions(viewer) : Promise.resolve([]),
    canRecord && e.verification_status !== 'SUPERSEDED' ? listEvidenceLinkTargetOptions(viewer) : Promise.resolve(null),
  ]);
  // Offer every supported target type, minus records this evidence is already actively linked to.
  const linkTargets: EvidenceLinkTargetOptions | null = rawTargets;
  if (linkTargets) {
    for (const k of Object.keys(linkTargets) as (keyof EvidenceLinkTargetOptions)[]) {
      const linked = new Set(active.filter(l => l.kind === k).map(l => l.target_id));
      linkTargets[k] = linkTargets[k].filter(o => !linked.has(o.id));
    }
  }
  const current = detail.chain.find(c => c.verification_status !== 'SUPERSEDED' && c.verification_status !== 'REJECTED' && c.id !== e.id);
  const history = detail.history.map(h => ({ ...h, label: HISTORY_LABEL[h.action] }));
  const awaiting = generic && e.verification_status === 'AWAITING_VERIFICATION';

  return (
    <div style={{ maxWidth: 1000 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/evidence', label: 'Evidence' }, { label: e.evidence_reference }]} />
      <PageHeader help="evidence-record"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{e.evidence_reference}</span>
          <Badge value={detail.state} tone={EVIDENCE_STATE_TONE[detail.state]} label={EVIDENCE_STATE_LABEL[detail.state]} />
        </span>}
        title={e.title ?? assuranceLabel(e.evidence_type)}
        subtitle={`${assuranceLabel(e.evidence_type)} · recorded ${formatAssuranceDateTime(e.created_at, tz)}${e.created_by_name ? ` by ${e.created_by_name}` : ''}`}
      />

      {detail.contractor && (
        <div style={{ marginBottom: 16 }}>
          <Notice>
            This evidence was recorded for <strong>{detail.contractor.requirement_name}</strong> ({detail.contractor.requirement_code}) from{' '}
            <Link href={`/assurance/contractors/${detail.contractor.external_organisation_id}`} className={tableStyles.link}>{detail.contractor.external_organisation_name}</Link>.
            It is accepted or rejected in Contractor assurance, and the status shown here is that decision.
          </Notice>
        </div>
      )}
      {e.verification_status === 'SUPERSEDED' && e.superseded_by_evidence_id && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warning">
            This evidence was accepted and has since been replaced. It stays here unchanged as history.{' '}
            <Link href={`/assurance/evidence/${e.superseded_by_evidence_id}`} className={tableStyles.link}>Open the current evidence</Link>.
          </Notice>
        </div>
      )}

      <Section title="Provenance">
        <Card>
          <KeyValues items={[
            { label: 'Type', value: assuranceLabel(e.evidence_type) },
            { label: 'Recorded by', value: e.created_by_name },
            { label: 'Recorded', value: formatAssuranceDateTime(e.created_at, tz) },
            { label: 'Captured by', value: e.captured_by_name },
            { label: 'Captured', value: e.captured_at ? formatAssuranceDateTime(e.captured_at, tz) : null },
            { label: 'Supplied by', value: detail.contractor ? detail.contractor.external_organisation_name : e.supplier_name ?? 'Recorded internally' },
            { label: 'Original held at', value: heldAt },
            { label: 'Location', value: e.location_name },
          ]} />
          {e.description && <div style={{ marginTop: 14 }}><Prose>{e.description}</Prose></div>}
          {detail.contractor && (
            <div style={{ marginTop: 14 }}>
              <KeyValues items={[
                { label: 'Supplied on', value: <DateCell value={detail.contractor.supplied_on} /> },
                { label: 'Effective from', value: detail.contractor.effective_from ? <DateCell value={detail.contractor.effective_from} /> : null },
                { label: 'Expires', value: detail.contractor.expires_on ? <DateCell value={detail.contractor.expires_on} /> : null },
              ]} />
            </div>
          )}
          <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
            BrainBase stores what this evidence is and where the original is held. The file itself is not uploaded here.
          </p>
        </Card>
      </Section>

      <Section title="Verification" id="decision">
        <Card>
          {detail.contractor ? (
            <KeyValues items={[
              { label: 'Decision', value: <Badge value={detail.state} tone={EVIDENCE_STATE_TONE[detail.state]} label={EVIDENCE_STATE_LABEL[detail.state]} /> },
              { label: 'Recorded by', value: detail.contractor.recorded_by_name },
              { label: 'Decided by', value: detail.contractor.decided_by_name },
              { label: 'Decided', value: detail.contractor.decided_at ? formatAssuranceDateTime(detail.contractor.decided_at, tz) : null },
              { label: 'Reason', value: detail.contractor.decision_reason },
            ]} />
          ) : (
            <KeyValues items={[
              { label: 'Status', value: <Badge value={detail.state} tone={EVIDENCE_STATE_TONE[detail.state]} label={EVIDENCE_STATE_LABEL[detail.state]} /> },
              { label: 'Submitted by', value: e.requested_by_name },
              { label: 'Submitted', value: e.verification_requested_at ? formatAssuranceDateTime(e.verification_requested_at, tz) : null },
              { label: 'Decided by', value: e.decided_by_name },
              { label: 'Decided', value: e.decided_at ? formatAssuranceDateTime(e.decided_at, tz) : null },
              { label: 'Reason', value: e.decision_reason },
            ]} />
          )}

          {generic && (
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {canRecord && e.verification_status === 'UNVERIFIED' && (
                <ActionPanel label="Submit for verification" variant="primary" endpoint={`/api/assurance/evidence/${e.id}/request-verification`}
                  extraBody={{ lockVersion: e.lock_version }}
                  confirm="Someone other than the person who recorded or captured this evidence will accept or reject it. You can withdraw it while it is waiting." />
              )}
              {awaiting && canVerify && detail.decision.conflicts.length === 0 && (
                <ActionPanel label="Accept or reject" variant="primary" endpoint={`/api/assurance/evidence/${e.id}/decide`}
                  extraBody={{ lockVersion: e.lock_version }}
                  description="Accepting records that this evidence is acceptable for what it supports. It does not close or verify any action, finding, inspection or audit — those stay separate, explicit steps."
                  fields={[
                    { kind: 'select', name: 'decision', label: 'Decision', required: true, options: [{ value: 'ACCEPT', label: 'Accept' }, { value: 'REJECT', label: 'Reject' }] },
                    { kind: 'textarea', name: 'reason', label: 'Reason (required to reject)', rows: 3 },
                  ]} submitLabel="Record decision" />
              )}
              {awaiting && canRecord && (
                <ActionPanel label="Withdraw from verification" endpoint={`/api/assurance/evidence/${e.id}/withdraw-verification`}
                  extraBody={{ lockVersion: e.lock_version }}
                  description="Takes the evidence out of the verification queue, for example to correct it first."
                  fields={[{ kind: 'text', name: 'reason', label: 'Reason (optional)', maxLength: 1000 }]} submitLabel="Withdraw" />
              )}
              {canRecord && canCorrect(e.verification_status) && (
                <ActionPanel label="Correct details" endpoint={`/api/assurance/evidence/${e.id}/correct`}
                  extraBody={{ lockVersion: e.lock_version }}
                  description="Corrections are allowed until the evidence is accepted or rejected. The previous details are kept in the history."
                  fields={[
                    { kind: 'select', name: 'evidenceType', label: 'Type', required: true, options: enumOptions(EVIDENCE_TYPES), defaultValue: e.evidence_type },
                    { kind: 'text', name: 'title', label: 'Title', required: true, defaultValue: e.title ?? '' },
                    { kind: 'textarea', name: 'description', label: 'Description', rows: 3, defaultValue: e.description ?? '' },
                    { kind: 'text', name: 'heldAt', label: 'Where the original is held', maxLength: 500, defaultValue: heldAt ?? '' },
                    ...(suppliers.length > 0 ? [{ kind: 'select' as const, name: 'supplierId', label: 'Supplied by (optional)', options: suppliers,
                      emptyLabel: 'Recorded internally', defaultValue: e.supplied_by_external_organisation_id ?? '' }] : []),
                  ]} submitLabel="Save correction" />
              )}
              {canRecord && detail.canReplace && (
                <ActionPanel label="Record replacement" endpoint={`/api/assurance/evidence/${e.id}/replacement`} redirectTo="/assurance/evidence/{id}"
                  description={e.verification_status === 'ACCEPTED'
                    ? 'The replacement is linked to the same open records. This evidence stays accepted until the replacement is accepted; then it becomes superseded and stays here as history.'
                    : 'The replacement is linked to the same open records. This rejected evidence stays here, unchanged, as history.'}
                  fields={evidenceFields({ suppliers, purpose: false })} submitLabel="Record replacement" />
              )}
            </div>
          )}
          {awaiting && canVerify && detail.decision.conflicts.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Notice>You cannot accept or reject this evidence: {detail.decision.conflicts.join(' ')} Someone independent must decide it.</Notice>
            </div>
          )}
          {awaiting && !canVerify && <div style={{ marginTop: 12 }}><Dim>Accepting or rejecting evidence needs manager access.</Dim></div>}
          {generic && !detail.canReplace && (e.verification_status === 'ACCEPTED' || e.verification_status === 'REJECTED') && current && (
            <div style={{ marginTop: 12 }}><Dim>A newer item in this chain is current or in progress: {current.evidence_reference}.</Dim></div>
          )}
        </Card>
      </Section>

      {detail.chain.length > 1 && (
        <Section title="Replacement history" count={detail.chain.length}>
          <DataTable headers={['Evidence', 'Status', 'Recorded', 'Decided', 'Replaces']} minWidth={640}>
            {detail.chain.map((c, i) => (
              <Row key={c.id} last={i === detail.chain.length - 1}>
                <td style={td}>
                  {c.id === e.id
                    ? <strong>{c.evidence_reference}</strong>
                    : <Link href={`/assurance/evidence/${c.id}`} className={styles.refChip}>{c.evidence_reference}</Link>}
                  <div className={tableStyles.meta}>{c.title ?? ''}</div>
                </td>
                <td style={td}><Badge value={c.verification_status} tone={EVIDENCE_STATE_TONE[c.verification_status]} label={EVIDENCE_STATE_LABEL[c.verification_status]} /></td>
                <td style={td}><DateCell value={c.created_at} timeZone={tz} /></td>
                <td style={td}><DateCell value={c.decided_at} timeZone={tz} /></td>
                <td style={td}>{c.replaces_evidence_id ? detail.chain.find(p => p.id === c.replaces_evidence_id)?.evidence_reference ?? '—' : <Dim>Original</Dim>}</td>
              </Row>
            ))}
          </DataTable>
        </Section>
      )}

      {detail.actionVerifications.length > 0 && (
        <Section title="Considered in action verification" count={detail.actionVerifications.length}>
          <div style={{ display: 'grid', gap: 10 }}>
            <Dim>An action verification judges whether the corrective work resolved the issue. It is a separate decision from accepting or rejecting this evidence.</Dim>
            <DataTable headers={['Action', 'Attempt', 'Result', 'Verified by', 'When', 'Action status']} minWidth={720}>
              {detail.actionVerifications.map((v, i) => (
                <Row key={v.verification_id} last={i === detail.actionVerifications.length - 1}>
                  <td style={td}><Link href={`/assurance/actions/${v.action_id}#verification`} className={styles.refChip}>{v.action_reference}</Link><div className={tableStyles.meta}>{v.action_title}</div></td>
                  <td style={td}>#{v.attempt_number}</td>
                  <td style={td}><Badge value={v.result} /></td>
                  <td style={td}>{v.verified_by_name ?? <Dim>—</Dim>}</td>
                  <td style={td}><DateCell value={v.verified_at} withTime timeZone={tz} /></td>
                  <td style={td}><Badge value={v.action_status} /></td>
                </Row>
              ))}
            </DataTable>
          </div>
        </Section>
      )}

      <Section title="Supports" count={active.length}>
        <div style={{ display: 'grid', gap: 10 }}>
          {detail.links.length === 0 ? <Card><Dim>{detail.contractor ? 'This evidence supports its contractor requirement only.' : 'This evidence is not linked to anything.'}</Dim></Card> : (
            <DataTable headers={['Record', 'Kind', 'Item / criterion', 'Record status', 'Linked', 'Link']} minWidth={820}>
              {detail.links.map((l, i) => (
                <Row key={`${l.kind}-${l.link_id}`} last={i === detail.links.length - 1}>
                  <td style={td}><Link href={`${HREF[l.kind]}/${l.target_id}`} className={styles.refChip}>{l.reference}</Link>{l.purpose && <div className={tableStyles.meta}>{l.purpose}</div>}</td>
                  <td style={td}>{assuranceLabel(l.kind.toUpperCase())}</td>
                  <td style={td}>{l.item_label ?? (l.item_key ? l.item_key : <Dim>—</Dim>)}</td>
                  <td style={td}>{l.target_status ? <Badge value={l.target_status} /> : <Dim>—</Dim>}</td>
                  <td style={td}><DateCell value={l.linked_at} timeZone={tz} /><div className={tableStyles.meta}>{l.linked_by_name ?? ''}</div></td>
                  <td style={td}>
                    {l.removed_at ? (
                      <span style={{ fontSize: 12 }}>
                        <Badge value="REMOVED" tone="neutral" label="Removed" />
                        <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{formatAssuranceDateTime(l.removed_at, tz)}{l.removed_by_name ? ` · ${l.removed_by_name}` : ''}</div>
                        <div style={{ fontStyle: 'italic' }}>{l.removal_reason}</div>
                      </span>
                    ) : canRecord && l.kind !== 'verification' ? (
                      <ActionPanel label="Remove link" variant="danger" endpoint="/api/assurance/evidence/unlink" extraBody={{ target: l.kind, linkId: l.link_id }}
                        fields={[{ kind: 'text', name: 'reason', label: 'Reason for removal', required: true, maxLength: 1000 }]} submitLabel="Remove link"
                        description="The link is kept as history with your reason." />
                    ) : <Badge value="ACTIVE" tone="success" label="Active" />}
                  </td>
                </Row>
              ))}
            </DataTable>
          )}
          {linkTargets && <EvidenceLinkPanel evidenceId={e.id} options={linkTargets} />}
        </div>
      </Section>

      <Section title="History">
        <Card><HistoryList entries={history} timeZone={tz} /></Card>
      </Section>
    </div>
  );
}
