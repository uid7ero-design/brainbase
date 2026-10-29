import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getIncidentDetail, INCIDENT_TRANSITIONS } from '@/lib/assurance/incidents';
import { listRiskLevels } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel, formatAssuranceDateTime, type IncidentStatus } from '@/lib/assurance/domain';
import { incidentClosureReadiness, incidentTriageFacts, isIncidentFinished, isInvestigationFinished } from '@/lib/assurance/incidentRules';
import { getAssuranceTimeZone } from '@/lib/assurance/deadlines';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import { EvidenceSection, FindingsTable, LinkExistingFinding, NextStepButtons, raiseFindingFields } from '../../_components/shared';
import { listOpenFindingOptions } from '@/lib/assurance/findings';
import {
  Badge, Breadcrumbs, Card, DataTable, Dim, HistoryList, KeyValues, Notice, PageHeader, Prose, RecordLink,
  RestrictedTag, Row, Section, td, assuranceStyles as styles, tableStyles } from '../../_components/ui';

export const dynamic = 'force-dynamic';

const STEP_LABEL: Partial<Record<IncidentStatus, string>> = {
  UNDER_REVIEW: 'Start triage',
  INVESTIGATION_REQUIRED: 'Needs investigation',
  UNDER_INVESTIGATION: 'Investigation underway',
  ACTION_REQUIRED: 'Action required',
  AWAITING_VERIFICATION: 'Awaiting verification',
  CLOSED: 'Close incident',
  CANCELLED: 'Cancel incident',
};

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getIncidentDetail(viewer, id);
  if (!detail) notFound();
  const { incident: inc } = detail;
  const canRecord = viewerCan(viewer, 'record');
  const canClose = viewerCan(viewer, 'close');
  const incidentOpen = !isIncidentFinished(inc.status);
  const [risks, users, linkableFindings, tz] = await Promise.all([
    canRecord ? listRiskLevels(viewer.organisationId) : Promise.resolve([]),
    canRecord ? listOrgUserOptions(viewer.organisationId) : Promise.resolve([]),
    canRecord && incidentOpen ? listOpenFindingOptions(viewer) : Promise.resolve([]),
    getAssuranceTimeZone(viewer.organisationId),
  ]);
  const userOptions = users.map(u => ({ value: u.id, label: u.name }));

  const next = INCIDENT_TRANSITIONS[inc.status].filter(s => (s === 'CLOSED' || s === 'CANCELLED' ? canClose : canRecord));
  const openFindings = detail.findings.filter(f => f.status !== 'CLOSED' && f.status !== 'CANCELLED');
  const visibleInvestigations = detail.investigations.filter(i => i.visible && i.id);
  const activeInvestigations = visibleInvestigations.filter(i => !isInvestigationFinished(i.status));
  const openActions = detail.actions.filter(a => a.status !== 'CLOSED' && a.status !== 'CANCELLED');
  const readiness = incidentClosureReadiness({
    status: inc.status,
    openVisibleFindings: openFindings.map(f => ({ reference: f.finding_reference })),
    openHiddenFindings: detail.hiddenOpenFindingCount,
    activeVisibleInvestigations: activeInvestigations.map(i => ({ reference: i.investigation_reference ?? '' })),
    activeHiddenInvestigations: detail.hiddenActiveInvestigationCount,
    openActionCount: openActions.length,
    viewerCanClose: canClose,
  });
  const triage = incidentTriageFacts({
    status: inc.status, risk_name: inc.risk_name, owner_name: inc.owner_name, immediate_response: inc.immediate_response,
    investigation_count: detail.investigations.length, finding_count: detail.findings.length + detail.hiddenFindingCount,
  });
  const primaryActive = activeInvestigations.length > 0 || detail.hiddenActiveInvestigationCount > 0;
  const riskDefault = risks.find(r => r.name === inc.risk_name)?.id;

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/incidents', label: 'Incidents' }, { label: inc.incident_reference }]} />
      <PageHeader help="incident"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{inc.incident_reference}</span>
          <Badge value={inc.status} />
          {inc.restricted && <RestrictedTag />}
        </span>}
        title={inc.title}
        subtitle={`${assuranceLabel(inc.category)} · occurred ${formatAssuranceDateTime(inc.occurred_at, tz)}`}
      />

      {incidentOpen && (
        <Section title="What still needs attention" id="readiness">
          <div style={{ display: 'grid', gap: 12 }}>
            <Card>
              <div style={subhead}>What still prevents this incident from being closed?</div>
              {readiness.blockers.length === 0
                ? <p style={{ fontSize: 13, margin: 0 }}>Nothing. No linked finding is open and no linked investigation is still running. Closure is still an explicit decision.</p>
                : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{readiness.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
              <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)' }}>{readiness.notes.map(n => <li key={n}>{n}</li>)}</ul>
            </Card>
            <Card>
              <div style={subhead}>Triage facts</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, fontSize: 13 }}>
                {triage.map(t => (
                  <li key={t.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Badge value={t.done ? 'YES' : 'NO'} label={t.done ? 'Yes' : 'Not yet'} tone={t.done ? 'success' : 'neutral'} />
                    <span>{t.label}</span>
                    <Dim>{t.detail}</Dim>
                  </li>
                ))}
              </ul>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>Facts only. Whether to investigate, and the risk level, are decided by people — nothing here is set automatically.</p>
            </Card>
          </div>
        </Section>
      )}

      {(canRecord || canClose) && incidentOpen && (
        <Section title="Next step">
          <div style={{ display: 'grid', gap: 10 }}>
            {next.length > 0 && (
              <NextStepButtons
                endpoint={`/api/assurance/incidents/${inc.id}/status`}
                options={next.map(s => ({
                  status: s,
                  label: STEP_LABEL[s] ?? assuranceLabel(s),
                  variant: s === 'CANCELLED' ? 'danger' : s === 'CLOSED' ? 'primary' : 'secondary',
                  fields: s === 'CLOSED' ? [{ kind: 'textarea', name: 'closureSummary', label: 'Closure summary', required: true, rows: 4 }] : undefined,
                  description: s === 'CLOSED'
                    ? 'Closing records your summary and who closed it. It is refused while linked findings or investigations are still open — nothing is closed on the incident’s behalf.'
                    : undefined,
                }))}
              />
            )}
            {canRecord && (
              <div className={styles.row}>
                <ActionPanel label={inc.owner_name ? 'Change owner' : 'Assign owner'} endpoint={`/api/assurance/incidents/${inc.id}/owner`}
                  extraBody={{ expectedOwnerUserId: inc.owner_user_id ?? null }}
                  description="The owner is responsible for the incident response. Changing the owner changes nothing else."
                  fields={[{ kind: 'select', name: 'ownerUserId', label: 'Owner', options: userOptions, defaultValue: inc.owner_user_id ?? undefined, emptyLabel: 'Unassigned' }]}
                  submitLabel="Save owner" />
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title="What happened" id="overview">
        <Card>
          <KeyValues items={[
            { label: 'Occurred', value: formatAssuranceDateTime(inc.occurred_at, tz) },
            { label: 'Reported', value: `${formatAssuranceDateTime(inc.reported_at, tz)}${inc.reporter_name ? ` by ${inc.reporter_name}` : ''}` },
            { label: 'Category', value: assuranceLabel(inc.category) },
            { label: 'Risk', value: inc.risk_name ?? <Dim>Not set</Dim> },
            { label: 'Owner', value: inc.owner_name ?? <Dim>Unassigned</Dim> },
            { label: 'Location', value: inc.location_name },
            { label: 'Asset', value: inc.asset_name },
            { label: 'External organisation', value: inc.external_organisation_name },
          ]} />
          <div style={{ marginTop: 18 }}>
            <div style={subhead}>Description (as reported)</div>
            <Prose>{inc.description}</Prose>
          </div>
          {inc.immediate_response && (
            <div style={{ marginTop: 14 }}>
              <div style={subhead}>Immediate response</div>
              <Prose>{inc.immediate_response}</Prose>
            </div>
          )}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0' }}>These are the facts as reported. Conclusions belong in an investigation; issues found belong in findings.</p>
        </Card>
      </Section>

      <Section title="People" count={detail.people.length} id="people">
        {detail.people.length === 0 ? <Card><Dim>No people are recorded against this incident.</Dim></Card> : (
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

      <Section title="Investigation" count={detail.investigations.length} id="investigations"
        actions={canRecord && incidentOpen ? (
          <ActionPanel label="Start investigation" variant={primaryActive ? 'secondary' : 'primary'} endpoint={`/api/assurance/incidents/${inc.id}/investigations`}
            redirectTo="/assurance/investigations/{id}" submitLabel="Start investigation"
            description={`${inc.incident_reference} becomes the investigation's primary incident. The incident's own status does not change — move it to "Investigation underway" yourself when appropriate.${inc.restricted ? ' This incident is restricted, so the investigation will be restricted too.' : ''}`}
            fields={[
              { kind: 'text', name: 'title', label: 'Title', required: true },
              { kind: 'textarea', name: 'scope', label: 'What will the investigation establish?', required: true, rows: 4 },
              { kind: 'select', name: 'leadUserId', label: 'Lead investigator', options: userOptions, emptyLabel: 'Unassigned' },
              { kind: 'select', name: 'riskLevelId', label: 'Risk level', options: risks.map(r => ({ value: r.id, label: r.name })), defaultValue: riskDefault },
              { kind: 'date', name: 'targetCompletionAt', label: 'Target completion' },
              ...(inc.restricted ? [] : [{ kind: 'checkbox' as const, name: 'restricted', label: 'Restricted investigation', help: 'Only you, the lead and organisation admins will see it and the findings raised from it.' }]),
            ]} />
        ) : undefined}>
        {detail.investigations.length === 0 ? <Card><Dim>No investigation has been started for this incident.</Dim></Card> : (
          <DataTable headers={['Investigation', 'Relationship', 'Status']} minWidth={520}>
            {detail.investigations.map((l, i) => (
              <Row key={l.link_id} last={i === detail.investigations.length - 1}>
                <td style={td}>{l.visible && l.id
                  ? <RecordLink href={`/assurance/investigations/${l.id}`} reference={l.investigation_reference ?? ''} title={l.title} />
                  : <span className={styles.eyebrowRow}><RestrictedTag /><Dim>Restricted investigation</Dim></span>}
                </td>
                <td style={td}>{assuranceLabel(l.relationship)}</td>
                <td style={td}>{l.visible ? <Badge value={l.status} /> : <Dim>—</Dim>}</td>
              </Row>
            ))}
          </DataTable>
        )}
        {canRecord && incidentOpen && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
            Investigating several incidents together? <Link href={`/assurance/investigations/new?incident=${inc.id}`} style={{ color: 'inherit' }}>Start one that covers several incidents</Link>.
          </p>
        )}
      </Section>

      <Section title="Findings" count={detail.findings.length} id="findings"
        actions={canRecord && incidentOpen ? (
          <>
            <LinkExistingFinding endpoint={`/api/assurance/incidents/${inc.id}/findings`} options={linkableFindings} linkedIds={new Set(detail.findings.map(f => f.id))} />
            <ActionPanel label="Raise finding" endpoint="/api/assurance/findings" extraBody={{ incidentId: inc.id }} variant="primary"
              fields={raiseFindingFields({ risks, users })} submitLabel="Raise finding" redirectTo="/assurance/findings/{id}" />
          </>
        ) : undefined}>
        <FindingsTable rows={detail.findings} hiddenCount={detail.hiddenFindingCount} emptyText="No findings have been raised from this incident." />
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
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>Actions address findings, not the incident directly. Closing an action never closes this incident.</p>
      </Section>

      <Section title="Evidence" count={detail.evidence.filter(e => !e.removed_at).length} id="evidence">
        <EvidenceSection rows={detail.evidence} target="incident" targetId={inc.id} canRecord={canRecord} />
      </Section>

      <Section title="Closure & history" id="history">
        <Card>
          {inc.status === 'CLOSED' ? (
            <div style={{ marginBottom: 16 }}>
              <KeyValues items={[{ label: 'Closed', value: formatAssuranceDateTime(inc.closed_at, tz) }, { label: 'Closed by', value: inc.closed_by_name }]} />
              {inc.closure_summary && <div style={{ marginTop: 12 }}><div style={subhead}>Closure summary</div><Prose>{inc.closure_summary}</Prose></div>}
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>Closed incidents cannot be reopened. If the issue recurs, report a new incident.</p>
            </div>
          ) : inc.status === 'CANCELLED' ? (
            <div style={{ marginBottom: 12 }}><Notice tone="info">This incident was cancelled. It cannot be reopened.</Notice></div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              Not closed. An incident is only closed explicitly, after its findings and investigations are resolved.
            </p>
          )}
          <HistoryList entries={detail.history} timeZone={tz} />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0' }}>
            <Link href="/assurance/incidents" style={{ color: 'inherit' }}>← Back to incidents</Link>
          </p>
        </Card>
      </Section>
    </div>
  );
}

const subhead = { fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 } as const;
