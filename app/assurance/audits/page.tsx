import Link from 'next/link';
import { listAudits } from '@/lib/assurance/audits';
import { listExternalOrganisationOptions, listLocationOptions } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { AUDIT_STATUSES, AUDIT_TYPES, assuranceLabel, isPast } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import { ExecutionProgressCell, LinkedWorkCell } from '../_components/shared';
import {
  Badge, DataTable, DateCell, Dim, FilterBar, LinkButton, PageHeader, RecordLink, Row, enumOptions, td, assuranceStyles as styles, tableStyles } from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
// Views are derived from real statuses and the completion rule only.
const VIEWS = [
  { value: '', label: 'All' },
  { value: 'due', label: 'Due (14 days)' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'findings', label: 'Findings raised' },
  { value: 'ready', label: 'Ready to complete' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default async function AuditsPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = {
    q: firstParam(sp.q), status: firstParam(sp.status), auditType: firstParam(sp.type),
    source: firstParam(sp.source) as 'template' | 'adhoc' | undefined, auditorUserId: firstParam(sp.auditor),
    locationId: firstParam(sp.location), externalOrganisationId: firstParam(sp.org), view: firstParam(sp.view),
  };
  const [rows, users, locations, orgs] = await Promise.all([
    listAudits(viewer, f),
    listOrgUserOptions(viewer.organisationId),
    listLocationOptions(viewer.organisationId, { includeInactive: true }),
    listExternalOrganisationOptions(viewer.organisationId, { includeInactive: true }),
  ]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1280 }}>
      <PageHeader help="audits"
        title="Audits"
        subtitle="Structured reviews against a standard or requirement. Gaps become Findings only when the auditor raises them."
        actions={<>
          <LinkButton href="/assurance/templates?kind=audit" variant="secondary">Templates</LinkButton>
          {viewerCan(viewer, 'record') && <LinkButton href="/assurance/audits/new">Plan audit</LinkButton>}
        </>}
      />
      <nav aria-label="Audit views" className={styles.viewTabs}>
        {VIEWS.map(v => {
          const active = (f.view ?? '') === v.value;
          return (
            <Link key={v.value} href={v.value ? `/assurance/audits?view=${v.value}` : '/assurance/audits'} aria-current={active ? 'page' : undefined}
              className={styles.viewTab}>
              {v.label}
            </Link>
          );
        })}
      </nav>
      <FilterBar
        resetHref="/assurance/audits"
        fields={[
          { kind: 'search', name: 'q', placeholder: 'Search reference, title or standard', value: f.q },
          { kind: 'select', name: 'status', label: 'Any status', value: f.status, options: enumOptions(AUDIT_STATUSES) },
          { kind: 'select', name: 'type', label: 'Any type', value: f.auditType, options: enumOptions(AUDIT_TYPES) },
          { kind: 'select', name: 'source', label: 'Template & ad hoc', value: f.source, options: [{ value: 'template', label: 'Template-based' }, { value: 'adhoc', label: 'Ad hoc' }] },
          { kind: 'select', name: 'auditor', label: 'Any auditor', value: f.auditorUserId, options: users.map(u => ({ value: u.id, label: u.name })) },
          { kind: 'select', name: 'location', label: 'Any location', value: f.locationId, options: locations.map(l => ({ value: l.id, label: l.inactive ? `${l.name} (inactive)` : l.name })) },
          { kind: 'select', name: 'org', label: 'Any contractor / organisation', value: f.externalOrganisationId, options: orgs.map(o => ({ value: o.id, label: o.inactive ? `${o.name} (inactive)` : o.name })) },
        ]}
      />
      <DataTable
        headers={['Audit', 'Status', 'Standard', 'Auditor', 'Planned', 'Location / contractor', 'Criteria', 'Result', 'Linked work']}
        minWidth={1240}
        empty={rows.length === 0 ? (filtered ? 'No audits match these filters.' : 'No audits have been planned yet.') : undefined}
      >
        {rows.map((r, i) => (
          <Row key={r.id} last={i === rows.length - 1}>
            <td style={{ ...td, maxWidth: 300 }}>
              <RecordLink href={`/assurance/audits/${r.id}`} reference={r.audit_reference} title={r.title} />
              <div className={tableStyles.meta}>{assuranceLabel(r.audit_type)} · {r.template_name ? `${r.template_name} · v${r.template_version_number}` : 'Ad hoc'}</div>
            </td>
            <td style={td}><Badge value={r.status} /></td>
            <td style={{ ...td, maxWidth: 200 }}>{r.standard_reference ?? <Dim>—</Dim>}</td>
            <td style={td}>{r.auditor_name ?? <Dim>Unassigned</Dim>}</td>
            <td style={td}><DateCell value={r.scheduled_at} overdue={r.status === 'PLANNED' && isPast(r.scheduled_at)} /></td>
            <td style={td}>
              {r.location_name ?? <Dim>—</Dim>}
              {r.external_organisation_name && <div className={tableStyles.meta}>{r.external_organisation_name}</div>}
            </td>
            <td style={td}><ExecutionProgressCell readiness={r.readiness} status={r.status} noun="audit" /></td>
            <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>
              {r.response_count === 0 ? <Dim>—</Dim> : (
                <>
                  {r.non_compliant_count > 0 ? <span style={{ color: 'var(--status-danger)', fontWeight: 600 }}>{r.non_compliant_count} non-compliant</span> : <span>No non-compliance</span>}
                  {r.partial_count > 0 && <div style={{ color: 'var(--status-warning)' }}>{r.partial_count} partial</div>}
                </>
              )}
            </td>
            <td style={td}><LinkedWorkCell findings={r.finding_count} openActions={r.open_action_count} evidence={r.evidence_count} /></td>
          </Row>
        ))}
      </DataTable>
    </div>
  );
}
