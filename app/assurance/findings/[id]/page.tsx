import { notFound } from 'next/navigation';
import { getFindingDetail, FINDING_TRANSITIONS } from '@/lib/assurance/findings';
import { listExternalOrganisationOptions } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { ACTION_PRIORITIES, ACTION_TYPES, assuranceLabel, formatAssuranceDateTime, isPast } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import { EvidenceSection, NextStepButtons } from '../../_components/shared';
import {
  Badge, Breadcrumbs, Card, ChainStrip, DataTable, DateCell, Dim, HistoryList, KeyValues, PageHeader, Prose, RecordLink,
  RefChip, Row, Section, enumOptions, td, type ChainStep, assuranceStyles as styles } from '../../_components/ui';

export const dynamic = 'force-dynamic';

const SOURCE_HREF = { incident: '/assurance/incidents', investigation: '/assurance/investigations', inspection: '/assurance/inspections', audit: '/assurance/audits' } as const;

export default async function FindingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getFindingDetail(viewer, id);
  if (!detail) notFound();
  const f = detail.finding;
  const canRecord = viewerCan(viewer, 'record');
  const canClose = viewerCan(viewer, 'close');
  const open = f.status !== 'CLOSED' && f.status !== 'CANCELLED';
  const [users, orgs] = canRecord && open
    ? await Promise.all([listOrgUserOptions(viewer.organisationId), listExternalOrganisationOptions(viewer.organisationId)])
    : [[], []];

  const next = FINDING_TRANSITIONS[f.status].filter(s => (s === 'CLOSED' || s === 'CANCELLED' ? canClose : canRecord));
  const actions = detail.actions;
  const openActions = actions.filter(a => a.status !== 'CLOSED' && a.status !== 'CANCELLED');
  const evidenceNeeded = actions.filter(a => a.evidence_required && a.status !== 'CANCELLED');
  const evidenceMet = evidenceNeeded.filter(a => a.active_evidence_count > 0);
  const verificationNeeded = actions.filter(a => a.verification_required && a.status !== 'CANCELLED');
  const verified = verificationNeeded.filter(a => a.latest_verification_result === 'ACCEPTED' || a.latest_verification_result === 'NOT_APPLICABLE');
  const due = detail.timeframes.find(t => t.status === 'ACTIVE' || t.status === 'OVERDUE');

  const chain: ChainStep[] = [
    { label: 'Source', state: detail.sources.length > 0 ? 'done' : 'na', detail: detail.sources.length > 0 ? detail.sources.map(s => s.reference).join(', ') : 'Raised directly' },
    { label: 'Finding', state: 'done', detail: assuranceLabel(f.status) },
    { label: 'Action', state: actions.length === 0 ? (open ? 'pending' : 'na') : openActions.length === 0 ? 'done' : 'current', detail: actions.length === 0 ? 'None yet' : `${actions.length - openActions.length}/${actions.length} closed` },
    { label: 'Evidence', state: evidenceNeeded.length === 0 ? 'na' : evidenceMet.length === evidenceNeeded.length ? 'done' : 'pending', detail: evidenceNeeded.length === 0 ? 'Not required' : `${evidenceMet.length}/${evidenceNeeded.length} actions evidenced` },
    { label: 'Verification', state: verificationNeeded.length === 0 ? 'na' : verified.length === verificationNeeded.length ? 'done' : 'pending', detail: verificationNeeded.length === 0 ? 'Not required' : `${verified.length}/${verificationNeeded.length} verified` },
    { label: 'Closure', state: f.status === 'CLOSED' ? 'done' : open && actions.length > 0 && openActions.length === 0 ? 'current' : 'pending', detail: f.status === 'CLOSED' ? `Closed ${formatAssuranceDateTime(f.closed_at)}` : 'Explicit step' },
  ];

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/findings', label: 'Findings' }, { label: f.finding_reference }]} />
      <PageHeader
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{f.finding_reference}</span>
          <Badge value={f.status} />
          <Badge value={f.finding_type} tone="neutral" />
        </span>}
        title={f.title}
        subtitle={`Identified ${formatAssuranceDateTime(f.identified_at)}${f.created_by_name ? ` by ${f.created_by_name}` : ''}`}
      />

      <Section title="Assurance chain">
        <Card><ChainStrip steps={chain} /></Card>
      </Section>

      {next.length > 0 && (
        <Section title="Next step">
          <NextStepButtons
            endpoint={`/api/assurance/findings/${f.id}/status`}
            options={next.map(s => ({
              status: s,
              label: s === 'CLOSED' ? 'Close finding' : s === 'CANCELLED' ? 'Cancel finding' : `Move to ${assuranceLabel(s).toLowerCase()}`,
              variant: s === 'CANCELLED' ? 'danger' : s === 'CLOSED' ? 'primary' : 'secondary',
            }))}
          />
          {next.includes('CLOSED') && openActions.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>Closing will be refused while {openActions.length} linked action{openActions.length === 1 ? ' is' : 's are'} still open.</p>
          )}
        </Section>
      )}

      <Section title="Overview" id="overview">
        <Card>
          <KeyValues items={[
            { label: 'Source', value: detail.sources.length === 0 ? <Dim>Raised directly</Dim> : detail.sources.map(s => <RefChip key={`${s.kind}-${s.id}`} href={`${SOURCE_HREF[s.kind]}/${s.id}`} reference={s.reference} kind={s.kind} />) },
            { label: 'Risk', value: f.risk_name },
            { label: 'Responsible', value: f.responsible_name ?? <Dim>Unassigned</Dim> },
            { label: 'Responsible organisation', value: f.responsible_external_organisation_name },
            { label: 'Resolve by', value: due ? <DateCell value={due.current_due_at} overdue={open && isPast(due.current_due_at)} /> : null },
            { label: 'Location', value: f.location_name },
            { label: 'Asset', value: f.asset_name },
          ]} />
          <div style={{ marginTop: 16 }}><div style={subhead}>Description</div><Prose>{f.description}</Prose></div>
        </Card>
      </Section>

      <Section title="Corrective actions" count={actions.length} id="actions"
        actions={canRecord && open ? (
          <ActionPanel label="Add corrective action" variant="primary" endpoint="/api/assurance/actions" extraBody={{ findingIds: [f.id] }}
            redirectTo="/assurance/actions/{id}" submitLabel="Create action"
            description="The action is linked to this finding. Completing its work, verifying it and closing it are separate steps."
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
          <DataTable headers={['Action', 'Priority', 'Status', 'Owner', 'Due', 'Evidence', 'Verification']} minWidth={820}>
            {actions.map((a, i) => (
              <Row key={a.id} last={i === actions.length - 1}>
                <td style={td}><RecordLink href={`/assurance/actions/${a.id}`} reference={a.action_reference} title={a.title} /></td>
                <td style={td}><Badge value={a.priority} /></td>
                <td style={td}><Badge value={a.status} /></td>
                <td style={td}>{a.owner_name ?? <Dim>Unassigned</Dim>}</td>
                <td style={td}><DateCell value={a.due_at} overdue={a.status !== 'CLOSED' && a.status !== 'CANCELLED' && isPast(a.due_at)} /></td>
                <td style={td}>{a.evidence_required ? (a.active_evidence_count > 0 ? `${a.active_evidence_count} linked` : <span style={{ color: 'var(--status-warning)' }}>Required</span>) : <Dim>Optional</Dim>}</td>
                <td style={td}>{a.latest_verification_result ? <Badge value={a.latest_verification_result} /> : a.verification_required ? <Dim>Pending</Dim> : <Dim>Not required</Dim>}</td>
              </Row>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Evidence" count={detail.evidence.filter(e => !e.removed_at).length} id="evidence">
        <EvidenceSection rows={detail.evidence} target="finding" targetId={f.id} canRecord={canRecord && open} />
      </Section>

      <Section title="History" id="history">
        <Card>
          {f.status === 'CLOSED' && (
            <p style={{ fontSize: 13, margin: '0 0 12px' }}>Closed {formatAssuranceDateTime(f.closed_at)}{f.closed_by_name ? ` by ${f.closed_by_name}` : ''}. Closing this finding did not change its source records.</p>
          )}
          <HistoryList entries={detail.history} />
        </Card>
      </Section>
    </div>
  );
}

const subhead = { fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 } as const;
