import { notFound } from 'next/navigation';
import { getInvestigationDetail, INVESTIGATION_TRANSITIONS } from '@/lib/assurance/investigations';
import { listIncidentOptions } from '@/lib/assurance/incidents';
import { listRiskLevels } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import {
  INVESTIGATION_INCIDENT_RELATIONSHIPS, assuranceLabel, formatAssuranceDate, formatAssuranceDateTime, isPast,
} from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import { EvidenceSection, FindingsTable, LinkExistingFinding, NextStepButtons, raiseFindingFields } from '../../_components/shared';
import { listOpenFindingOptions } from '@/lib/assurance/findings';
import {
  Badge, Breadcrumbs, Card, DataTable, DateCell, Dim, HistoryList, KeyValues, Notice, PageHeader, Prose, RecordLink,
  RestrictedTag, Row, Section, enumOptions, td, assuranceStyles as styles, tableStyles } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export default async function InvestigationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getInvestigationDetail(viewer, id);
  if (!detail) notFound();
  const inv = detail.investigation;
  const canRecord = viewerCan(viewer, 'record');
  const canClose = viewerCan(viewer, 'close');
  const finished = inv.status === 'COMPLETED' || inv.status === 'CANCELLED';
  const [risks, users, incidentOptions, openFindings] = canRecord && !finished
    ? await Promise.all([listRiskLevels(viewer.organisationId), listOrgUserOptions(viewer.organisationId), listIncidentOptions(viewer, { openOnly: false }), listOpenFindingOptions(viewer)])
    : [[], [], [], []];
  const linkedIds = new Set(detail.incidents.map(l => l.id).filter(Boolean));
  const next = INVESTIGATION_TRANSITIONS[inv.status].filter(s => (s === 'COMPLETED' || s === 'CANCELLED' ? canClose : canRecord));

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/investigations', label: 'Investigations' }, { label: inv.investigation_reference }]} />
      <PageHeader help="investigation"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{inv.investigation_reference}</span>
          <Badge value={inv.status} />
          {inv.restricted && <RestrictedTag />}
        </span>}
        title={inv.title}
        subtitle={`Started ${formatAssuranceDate(inv.started_at)}${inv.lead_name ? ` · led by ${inv.lead_name}` : ''}`}
      />

      {next.length > 0 && (
        <Section title="Next step">
          <NextStepButtons
            endpoint={`/api/assurance/investigations/${inv.id}/status`}
            options={next.map(s => ({
              status: s,
              label: s === 'COMPLETED' ? 'Complete with conclusion' : s === 'CANCELLED' ? 'Cancel investigation' : `Move to ${assuranceLabel(s).toLowerCase()}`,
              variant: s === 'CANCELLED' ? 'danger' : s === 'COMPLETED' ? 'primary' : 'secondary',
              fields: s === 'COMPLETED' ? [{ kind: 'textarea', name: 'conclusion', label: 'Conclusion', required: true, rows: 5 }] : undefined,
              description: s === 'COMPLETED'
                ? 'Completing records the conclusion. It does NOT close the linked incidents or any findings — those are resolved and closed separately.'
                : undefined,
            }))}
          />
        </Section>
      )}

      <Section title="Overview" id="overview">
        <Card>
          <KeyValues items={[
            { label: 'Lead investigator', value: inv.lead_name ?? <Dim>Unassigned</Dim> },
            { label: 'Risk', value: inv.risk_name },
            { label: 'Started', value: formatAssuranceDateTime(inv.started_at) },
            { label: 'Target completion', value: <DateCell value={inv.target_completion_at} overdue={!finished && isPast(inv.target_completion_at)} /> },
          ]} />
          <div style={{ marginTop: 16 }}>
            <div style={subhead}>Scope</div>
            <Prose>{inv.scope}</Prose>
          </div>
        </Card>
      </Section>

      <Section title="Linked incidents" count={detail.incidents.length} id="incidents">
        <div style={{ display: 'grid', gap: 10 }}>
          <Notice>An investigation can cover several incidents, and one incident can be examined by several investigations. Links are permanent history.</Notice>
          {detail.incidents.length === 0 ? <Card><Dim>No incidents are linked yet.</Dim></Card> : (
            <DataTable headers={['Incident', 'Relationship', 'Status', 'Also in', 'Linked']} minWidth={620}>
              {detail.incidents.map((l, i) => (
                <Row key={l.link_id} last={i === detail.incidents.length - 1}>
                  <td style={td}>{l.visible && l.id
                    ? <RecordLink href={`/assurance/incidents/${l.id}`} reference={l.incident_reference ?? ''} title={l.title} />
                    : <span className={styles.eyebrowRow}><RestrictedTag /><Dim>Restricted incident</Dim></span>}
                  </td>
                  <td style={td}><Badge value={l.relationship} tone={l.relationship === 'PRIMARY' ? 'accent' : 'neutral'} /></td>
                  <td style={td}>{l.visible ? <Badge value={l.status} /> : <Dim>—</Dim>}</td>
                  <td style={td}>{l.other_investigation_count > 0 ? `${l.other_investigation_count} other investigation${l.other_investigation_count === 1 ? '' : 's'}` : <Dim>Only this one</Dim>}</td>
                  <td style={td}><DateCell value={l.linked_at} /></td>
                </Row>
              ))}
            </DataTable>
          )}
          {canRecord && !finished && (
            <ActionPanel label="Link another incident" endpoint={`/api/assurance/investigations/${inv.id}/incidents`}
              fields={[
                { kind: 'select', name: 'incidentId', label: 'Incident', required: true, options: incidentOptions.filter(o => !linkedIds.has(o.id)).map(o => ({ value: o.id, label: o.label })) },
                { kind: 'select', name: 'relationship', label: 'Relationship', required: true, options: enumOptions(INVESTIGATION_INCIDENT_RELATIONSHIPS), defaultValue: 'RELATED' },
              ]} submitLabel="Link incident" />
          )}
        </div>
      </Section>

      <Section title="People" count={detail.people.length} id="people">
        {detail.people.length === 0 ? <Card><Dim>No people are recorded against this investigation.</Dim></Card> : (
          <DataTable headers={['Person', 'Role', 'Notes']} minWidth={520}>
            {detail.people.map((p, i) => (
              <Row key={p.id} last={i === detail.people.length - 1}>
                <td style={td}><span style={{ color: 'var(--text-primary)' }}>{p.display_name}</span>{p.job_title && <div className={tableStyles.meta}>{p.job_title}</div>}</td>
                <td style={td}>{assuranceLabel(p.role)}</td>
                <td style={td}>{p.notes ?? <Dim>—</Dim>}</td>
              </Row>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Findings" count={detail.findings.length} id="findings"
        actions={canRecord && !finished ? (
          <>
            <LinkExistingFinding endpoint={`/api/assurance/investigations/${inv.id}/findings`} options={openFindings} linkedIds={new Set(detail.findings.map(f => f.id))} />
            <ActionPanel label="Raise finding" endpoint="/api/assurance/findings" extraBody={{ investigationId: inv.id }} variant="primary"
              fields={raiseFindingFields({ risks, users })} submitLabel="Raise finding" redirectTo="/assurance/findings/{id}" />
          </>
        ) : undefined}>
        <FindingsTable rows={detail.findings} hiddenCount={detail.hiddenFindingCount} emptyText="No findings have been raised by this investigation." />
      </Section>

      <Section title="Evidence" count={detail.evidence.filter(e => !e.removed_at).length} id="evidence">
        <EvidenceSection rows={detail.evidence} target="investigation" targetId={inv.id} canRecord={canRecord} />
      </Section>

      <Section title="Conclusion & history" id="history">
        <Card>
          {inv.status === 'COMPLETED' && inv.conclusion ? (
            <div style={{ marginBottom: 16 }}>
              <KeyValues items={[{ label: 'Completed', value: formatAssuranceDateTime(inv.completed_at) }, { label: 'Completed by', value: inv.completed_by_name }]} />
              <div style={{ marginTop: 12 }}><div style={subhead}>Conclusion</div><Prose>{inv.conclusion}</Prose></div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>No conclusion recorded yet.</p>
          )}
          <HistoryList entries={detail.history} />
        </Card>
      </Section>
    </div>
  );
}

const subhead = { fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 } as const;
