import { notFound } from 'next/navigation';
import { getInvestigationDetail, INVESTIGATION_TRANSITIONS } from '@/lib/assurance/investigations';
import { listIncidentOptions } from '@/lib/assurance/incidents';
import { listRiskLevels } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import {
  INVESTIGATION_INCIDENT_RELATIONSHIPS, assuranceLabel, formatAssuranceDate, formatAssuranceDateTime, isPast,
} from '@/lib/assurance/domain';
import { investigationCompletionReadiness, isInvestigationFinished } from '@/lib/assurance/incidentRules';
import { getAssuranceTimeZone } from '@/lib/assurance/deadlines';
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
  const finished = isInvestigationFinished(inv.status);
  const [risks, users, incidentOptions, openFindings, tz] = await Promise.all([
    canRecord && !finished ? listRiskLevels(viewer.organisationId) : Promise.resolve([]),
    canRecord && !finished ? listOrgUserOptions(viewer.organisationId) : Promise.resolve([]),
    canRecord && !finished ? listIncidentOptions(viewer, { openOnly: false }) : Promise.resolve([]),
    canRecord && !finished ? listOpenFindingOptions(viewer) : Promise.resolve([]),
    getAssuranceTimeZone(viewer.organisationId),
  ]);
  const linkedIds = new Set(detail.incidents.map(l => l.id).filter(Boolean));
  const next = INVESTIGATION_TRANSITIONS[inv.status].filter(s => (s === 'COMPLETED' || s === 'CANCELLED' ? canClose : canRecord));
  const targetPassed = !finished && isPast(inv.target_completion_at);
  const openFindingCount = detail.findings.filter(f => f.status !== 'CLOSED' && f.status !== 'CANCELLED').length;
  const readiness = investigationCompletionReadiness({ status: inv.status, openFindingCount, targetPassed, viewerCanClose: canClose });

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
        subtitle={`Started ${formatAssuranceDate(inv.started_at, tz)}${inv.lead_name ? ` · led by ${inv.lead_name}` : ''}`}
      />

      {!finished && (
        <Section title="What remains" id="readiness">
          <Card>
            <div style={subhead}>What still prevents this investigation from being completed?</div>
            {readiness.blockers.length === 0
              ? <p style={{ fontSize: 13, margin: 0 }}>Nothing except recording the conclusion. Completion is still an explicit decision.</p>
              : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{readiness.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)' }}>{readiness.notes.map(n => <li key={n}>{n}</li>)}</ul>
          </Card>
        </Section>
      )}

      {!finished && (next.length > 0 || canRecord) && (
        <Section title="Next step">
          <div style={{ display: 'grid', gap: 10 }}>
            {next.length > 0 && (
              <NextStepButtons
                endpoint={`/api/assurance/investigations/${inv.id}/status`}
                options={next.map(s => ({
                  status: s,
                  label: s === 'COMPLETED' ? 'Complete with conclusion' : s === 'CANCELLED' ? 'Cancel investigation' : `Move to ${assuranceLabel(s).toLowerCase()}`,
                  variant: s === 'CANCELLED' ? 'danger' : s === 'COMPLETED' ? 'primary' : 'secondary',
                  fields: s === 'COMPLETED' ? [{ kind: 'textarea', name: 'conclusion', label: 'Conclusion', required: true, rows: 5 }] : undefined,
                  description: s === 'COMPLETED'
                    ? 'Record the factual conclusion: what the investigation established. Completing does NOT close the linked incidents or any findings — those are resolved and closed separately.'
                    : undefined,
                }))}
              />
            )}
            {canRecord && (
              <div className={styles.row}>
                <ActionPanel label={inv.lead_name ? 'Change lead investigator' : 'Assign lead investigator'} endpoint={`/api/assurance/investigations/${inv.id}/lead`}
                  extraBody={{ expectedLeadUserId: inv.lead_user_id ?? null }}
                  description={inv.restricted ? 'The lead of a restricted investigation can see it and everything linked beneath it.' : 'Changing the lead changes nothing else.'}
                  fields={[{ kind: 'select', name: 'leadUserId', label: 'Lead investigator', options: users.map(u => ({ value: u.id, label: u.name })), defaultValue: inv.lead_user_id ?? undefined, emptyLabel: 'Unassigned' }]}
                  submitLabel="Save lead" />
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title="What we are establishing" id="overview">
        <Card>
          <KeyValues items={[
            { label: 'Lead investigator', value: inv.lead_name ?? <Dim>Unassigned</Dim> },
            { label: 'Risk', value: inv.risk_name ?? <Dim>Not set</Dim> },
            { label: 'Started', value: formatAssuranceDateTime(inv.started_at, tz) },
            { label: 'Target completion', value: inv.target_completion_at ? <DateCell value={inv.target_completion_at} timeZone={tz} overdue={targetPassed} /> : <Dim>None set</Dim> },
          ]} />
          <div style={{ marginTop: 16 }}>
            <div style={subhead}>Scope</div>
            <Prose>{inv.scope}</Prose>
          </div>
        </Card>
      </Section>

      <Section title="Source incidents" count={detail.incidents.length} id="incidents">
        <div style={{ display: 'grid', gap: 10 }}>
          <Notice>An investigation can cover several incidents, and one incident can be examined by several investigations. Links are permanent history.{inv.restricted ? '' : ' A restricted incident can only be linked to a restricted investigation.'}</Notice>
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
                  <td style={td}><DateCell value={l.linked_at} timeZone={tz} /></td>
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

      <Section title="Evidence gathered" count={detail.evidence.filter(e => !e.removed_at).length} id="evidence">
        <EvidenceSection rows={detail.evidence} target="investigation" targetId={inv.id} canRecord={canRecord} />
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>Evidence is proof that was gathered. Accepting evidence never completes the investigation.</p>
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
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>A finding is an issue the investigation identified. Nothing is raised automatically.</p>
      </Section>

      <Section title="Corrective actions" count={detail.actions.length} id="actions">
        {detail.actions.length === 0 ? <Card><Dim>No corrective actions yet. Actions are created on a finding.</Dim></Card> : (
          <DataTable headers={['Action', 'Status', 'Owner', 'For finding']} minWidth={560}>
            {detail.actions.map((a, i) => (
              <Row key={a.id} last={i === detail.actions.length - 1}>
                <td style={td}><RecordLink href={`/assurance/actions/${a.id}`} reference={a.action_reference} title={a.title} /></td>
                <td style={td}><Badge value={a.status} /></td>
                <td style={td}>{a.owner_name ?? <Dim>Unassigned</Dim>}</td>
                <td style={td}>{a.finding_references.join(', ')}</td>
              </Row>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Conclusion & history" id="history">
        <Card>
          {inv.status === 'COMPLETED' && inv.conclusion ? (
            <div style={{ marginBottom: 16 }}>
              <KeyValues items={[{ label: 'Completed', value: formatAssuranceDateTime(inv.completed_at, tz) }, { label: 'Completed by', value: inv.completed_by_name }]} />
              <div style={{ marginTop: 12 }}><div style={subhead}>Conclusion (recorded by the investigator)</div><Prose>{inv.conclusion}</Prose></div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>Completed investigations cannot be reopened. Start a new investigation if more work is needed.</p>
            </div>
          ) : inv.status === 'CANCELLED' ? (
            <div style={{ marginBottom: 12 }}><Notice tone="info">This investigation was cancelled. It cannot be reopened.</Notice></div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>No conclusion recorded yet.</p>
          )}
          <HistoryList entries={detail.history} timeZone={tz} />
        </Card>
      </Section>
    </div>
  );
}

const subhead = { fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 } as const;
