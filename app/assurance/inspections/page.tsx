import Link from 'next/link';
import { listInspections } from '@/lib/assurance/inspections';
import { listLocationOptions } from '@/lib/assurance/lookups';
import { viewerCan } from '@/lib/assurance/authorize';
import { INSPECTION_STATUSES, INSPECTION_TYPES, assuranceLabel, isPast } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import {
  Badge, DataTable, DateCell, Dim, FilterBar, LinkButton, PageHeader, RecordLink, Row, enumOptions, td, assuranceStyles as styles, tableStyles } from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

const VIEWS = [
  { value: '', label: 'All' },
  { value: 'due', label: 'Due (7 days)' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
];

export default async function InspectionsPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = {
    q: firstParam(sp.q), status: firstParam(sp.status), inspectionType: firstParam(sp.type),
    source: firstParam(sp.source) as 'template' | 'adhoc' | undefined, locationId: firstParam(sp.location),
    view: firstParam(sp.view) as 'due' | 'planned' | 'in_progress' | 'completed' | undefined,
  };
  const [rows, locations] = await Promise.all([listInspections(viewer, f), listLocationOptions(viewer.organisationId)]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader
        title="Inspections"
        subtitle="Structured operational checks — planned from a template, or ad hoc in the field."
        actions={<>
          <LinkButton href="/assurance/inspections/templates" variant="secondary">Templates</LinkButton>
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
          { kind: 'select', name: 'location', label: 'Any location', value: f.locationId, options: locations.map(l => ({ value: l.id, label: l.name })) },
        ]}
      />
      <DataTable
        headers={['Inspection', 'Type', 'Status', 'Scheduled', 'Inspector', 'Checklist', 'Result']}
        minWidth={980}
        empty={rows.length === 0 ? (filtered ? 'No inspections match these filters.' : 'No inspections have been planned yet.') : undefined}
      >
        {rows.map((r, i) => (
          <Row key={r.id} last={i === rows.length - 1}>
            <td style={{ ...td, maxWidth: 320 }}>
              <RecordLink href={`/assurance/inspections/${r.id}`} reference={r.inspection_reference} title={r.title} />
              {r.location_name && <div className={tableStyles.meta}>{r.location_name}</div>}
            </td>
            <td style={td}>{assuranceLabel(r.inspection_type)}</td>
            <td style={td}><Badge value={r.status} /></td>
            <td style={td}><DateCell value={r.scheduled_at} overdue={r.status === 'PLANNED' && isPast(r.scheduled_at)} /></td>
            <td style={td}>{r.inspector_name ?? <Dim>Unassigned</Dim>}</td>
            <td style={td}>{r.template_name ? `${r.template_name} · v${r.template_version_number}` : <Dim>Ad hoc</Dim>}</td>
            <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>
              {r.response_count === 0 ? <Dim>—</Dim> : (
                <>
                  {r.response_count} answered
                  {r.fail_count > 0 && <span style={{ color: 'var(--status-danger)', fontWeight: 600 }}> · {r.fail_count} fail</span>}
                  {r.observation_count > 0 && <span style={{ color: 'var(--status-warning)' }}> · {r.observation_count} obs.</span>}
                  {r.finding_count > 0 && <div>{r.finding_count} finding{r.finding_count === 1 ? '' : 's'}</div>}
                </>
              )}
            </td>
          </Row>
        ))}
      </DataTable>
    </div>
  );
}
