import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getIncidentDetail, INCIDENT_TRANSITIONS } from '@/lib/assurance/incidents';
import { listRiskLevels } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel, formatAssuranceDateTime, type IncidentStatus } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import { EvidenceSection, FindingsTable, NextStepButtons, raiseFindingFields } from '../../_components/shared';
import {
  Badge, Breadcrumbs, Card, DataTable, Dim, HistoryList, KeyValues, LinkButton, Notice, PageHeader, Prose, RecordLink,
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
  const [risks, users] = canRecord ? await Promise.all([listRiskLevels(viewer.organisationId), listOrgUserOptions(viewer.organisationId)]) : [[], []];

  const next = INCIDENT_TRANSITIONS[inc.status].filter(s => (s === 'CLOSED' || s === 'CANCELLED' ? canClose : canRecord));
  const openFindings = detail.findings.filter(f => f.status !== 'CLOSED' && f.status !== 'CANCELLED').length;
  const activeInvestigations = detail.investigations.filter(i => i.visible && i.status !== 'COMPLETED' && i.status !== 'CANCELLED').length;

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/incidents', label: 'Incidents' }, { label: inc.incident_reference }]} />
      <PageHeader
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{inc.incident_reference}</span>
          <Badge value={inc.status} />
          {inc.restricted && <RestrictedTag />}
        </span>}
        title={inc.title}
        subtitle={`${assuranceLabel(inc.category)} · occurred ${formatAssuranceDateTime(inc.occurred_at)}`}
      />

      {canRecord && next.length > 0 && (
        <Section title="Next step">
          <NextStepButtons
            endpoint={`/api/assurance/incidents/${inc.id}/status`}
            options={next.map(s => ({
              status: s,
              label: STEP_LABEL[s] ?? assuranceLabel(s),
              variant: s === 'CANCELLED' ? 'danger' : s === 'CLOSED' ? 'primary' : 'secondary',
              fields: s === 'CLOSED' ? [{ kind: 'textarea', name: 'closureSummary', label: 'Closure summary', required: true, rows: 4 }] : undefined,
              description: s === 'CLOSED'
                ? 'Closing records your summary and who closed it. It will be refused while linked findings or investigations are still open — nothing is closed on the incident’s behalf.'
                : undefined,
            }))}
          />
          {inc.status === 'AWAITING_VERIFICATION' && (openFindings > 0 || activeInvestigations > 0) && (
            <div style={{ marginTop: 10 }}>
              <Notice tone="warning">Closure is blocked: {openFindings > 0 ? `${openFindings} open finding(s)` : ''}{openFindings > 0 && activeInvestigations > 0 ? ' and ' : ''}{activeInvestigations > 0 ? `${activeInvestigations} active investigation(s)` : ''}.</Notice>
            </div>
          )}
        </Section>
      )}

      <Section title="Overview" id="overview">
        <Card>
          <KeyValues items={[
            { label: 'Risk', value: inc.risk_name },
            { label: 'Owner', value: inc.owner_name ?? <Dim>Unassigned</Dim> },
            { label: 'Reported by', value: inc.reporter_name },
            { label: 'Reported', value: formatAssuranceDateTime(inc.reported_at) },
            { label: 'Location', value: inc.location_name },
            { label: 'Asset', value: inc.asset_name },
            { label: 'External organisation', value: inc.external_organisation_name },
          ]} />
          <div style={{ marginTop: 18 }}>
            <div style={subhead}>What happened</div>
            <Prose>{inc.description}</Prose>
          </div>
          {inc.immediate_response && (
            <div style={{ marginTop: 14 }}>
              <div style={subhead}>Immediate response</div>
              <Prose>{inc.immediate_response}</Prose>
            </div>
          )}
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

      <Section title="Investigations" count={detail.investigations.length} id="investigations"
        actions={canRecord ? <LinkButton href={`/assurance/investigations/new?incident=${inc.id}`} variant="secondary">Start investigation</LinkButton> : undefined}>
        {detail.investigations.length === 0 ? <Card><Dim>This incident is not part of any investigation.</Dim></Card> : (
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
      </Section>

      <Section title="Findings" count={detail.findings.length} id="findings"
        actions={canRecord && inc.status !== 'CLOSED' && inc.status !== 'CANCELLED' ? (
          <ActionPanel label="Raise finding" endpoint="/api/assurance/findings" extraBody={{ incidentId: inc.id }} variant="primary"
            fields={raiseFindingFields({ risks, users })} submitLabel="Raise finding" redirectTo="/assurance/findings/{id}" />
        ) : undefined}>
        <FindingsTable rows={detail.findings} hiddenCount={detail.hiddenFindingCount} emptyText="No findings have been raised from this incident." />
      </Section>

      <Section title="Evidence" count={detail.evidence.filter(e => !e.removed_at).length} id="evidence">
        <EvidenceSection rows={detail.evidence} target="incident" targetId={inc.id} canRecord={canRecord} />
      </Section>

      <Section title="Closure & history" id="history">
        <Card>
          {inc.status === 'CLOSED' ? (
            <div style={{ marginBottom: 16 }}>
              <KeyValues items={[{ label: 'Closed', value: formatAssuranceDateTime(inc.closed_at) }, { label: 'Closed by', value: inc.closed_by_name }]} />
              {inc.closure_summary && <div style={{ marginTop: 12 }}><div style={subhead}>Closure summary</div><Prose>{inc.closure_summary}</Prose></div>}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              Not closed. An incident is only closed explicitly, after its findings and investigations are resolved.
            </p>
          )}
          <HistoryList entries={detail.history} />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0' }}>
            <Link href="/assurance/incidents" style={{ color: 'inherit' }}>← Back to incidents</Link>
          </p>
        </Card>
      </Section>
    </div>
  );
}

const subhead = { fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 } as const;
