import Link from 'next/link';
import { listInspections } from '@/lib/assurance/inspections';
import { listLocationOptions } from '@/lib/assurance/lookups';
import { viewerCan } from '@/lib/assurance/authorize';
import { INSPECTION_STATUSES, INSPECTION_TYPES, assuranceLabel, isPast } from '@/lib/assurance/domain';
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
  { value: 'due', label: 'Due (7 days)' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'findings', label: 'Findings raised' },
  { value: 'ready', label: 'Ready to complete' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default async function InspectionsPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = {
    q: firstParam(sp.q), status: firstParam(sp.status), inspectionType: firstParam(sp.type),
    source: firstParam(sp.source) as 'template' | 'adhoc' | undefined, locationId: firstParam(sp.location),
    view: firstParam(sp.view),
  };
  const [rows, locations] = await Promise.all([listInspections(viewer, f), listLocationOptions(viewer.organisationId, { includeInactive: true })]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader help="inspections"
        title="Inspections"
        subtitle="Structured operational checks — planned from a template, or ad hoc in the field."
        actions={<>
          <LinkButton href="/assurance/templates?kind=inspection" variant="secondary">Templates</LinkButton>
          {viewerCan(viewer, 'record') && <LinkButton href="/assurance/inspections/new">Plan inspection</LinkButton>}
        </>}
      />
      <nav aria-label="Inspection views" className={styles.viewTabs}>
        {VIEWS.map(v => {
          const active = (f.view ?? '') === v.value;
          return (
            <Link key={v.value} href={v.value ? `/assurance/inspections?view=${v.value}` : '/assurance/inspections'}
              aria-current={active ? 'page' : undefined}
              className={styles.viewTab}>
              {v.label}
            </Link>
          );
        })}
      </nav>
      <FilterBar
        resetHref="/assurance/inspections"
        fields={[
          { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
          { kind: 'select', name: 'status', label: 'Any status', value: f.status, options: enumOptions(INSPECTION_STATUSES) },
          { kind: 'select', name: 'type', label: 'Any type', value: f.inspectionType, options: enumOptions(INSPECTION_TYPES) },
          { kind: 'select', name: 'source', label: 'Template & ad hoc', value: f.source, options: [{ value: 'template', label: 'Template-based' }, { value: 'adhoc', label: 'Ad hoc' }] },
          { kind: 'select', name: 'location', label: 'Any location', value: f.locationId, options: locations.map(l => ({ value: l.id, label: l.inactive ? `${l.name} (inactive)` : l.name })) },
        ]}
      />
      <DataTable
        headers={['Inspection', 'Status', 'Planned', 'Inspector', 'Applies to', 'Progress', 'Result', 'Linked work']}
        minWidth={1120}
        empty={rows.length === 0 ? (filtered ? 'No inspections match these filters.' : 'No inspections have been planned yet.') : undefined}
      >
        {rows.map((r, i) => (
          <Row key={r.id} last={i === rows.length - 1}>
            <td style={{ ...td, maxWidth: 320 }}>
              <RecordLink href={`/assurance/inspections/${r.id}`} reference={r.inspection_reference} title={r.title} />
              <div className={tableStyles.meta}>
                {assuranceLabel(r.inspection_type)} · {r.template_name ? `${r.template_name} · v${r.template_version_number}` : 'Ad hoc'}
              </div>
            </td>
            <td style={td}><Badge value={r.status} /></td>
            <td style={td}><DateCell value={r.scheduled_at} overdue={r.status === 'PLANNED' && isPast(r.scheduled_at)} /></td>
            <td style={td}>{r.inspector_name ?? <Dim>Unassigned</Dim>}</td>
            <td style={{ ...td, maxWidth: 220 }}>
              {r.location_name || r.asset_name || r.external_organisation_name ? (
                <>
                  {r.location_name && <div>{r.location_name}</div>}
                  {r.asset_name && <div className={tableStyles.meta}>{r.asset_name}</div>}
                  {r.external_organisation_name && <div className={tableStyles.meta}>{r.external_organisation_name}</div>}
                </>
              ) : <Dim>—</Dim>}
            </td>
            <td style={td}><ExecutionProgressCell readiness={r.readiness} status={r.status} noun="inspection" /></td>
            <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>
              {r.response_count === 0 ? <Dim>—</Dim> : (
                <>
                  {r.fail_count > 0 ? <span style={{ color: 'var(--status-danger)', fontWeight: 600 }}>{r.fail_count} fail</span> : <span>No fails</span>}
                  {r.observation_count > 0 && <div style={{ color: 'var(--status-warning)' }}>{r.observation_count} observation{r.observation_count === 1 ? '' : 's'}</div>}
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
