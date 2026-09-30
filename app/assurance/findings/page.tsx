import { listFindings } from '@/lib/assurance/findings';
import { listRiskLevels } from '@/lib/assurance/lookups';
import { FINDING_STATUSES, FINDING_TYPES, assuranceLabel, isPast } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import { Badge, DataTable, DateCell, Dim, FilterBar, PageHeader, RecordLink, RefChip, Row, enumOptions, td } from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

const SOURCE_HREF = { incident: '/assurance/incidents', investigation: '/assurance/investigations', inspection: '/assurance/inspections', audit: '/assurance/audits' } as const;

export default async function FindingsPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = {
    q: firstParam(sp.q), status: firstParam(sp.status), findingType: firstParam(sp.type), riskLevelId: firstParam(sp.risk),
    state: firstParam(sp.state) as 'open' | 'closed' | 'overdue' | 'all' | undefined,
    source: firstParam(sp.source) as 'incident' | 'investigation' | 'inspection' | 'audit' | 'none' | undefined,
  };
  const [rows, risks] = await Promise.all([listFindings(viewer, f), listRiskLevels(viewer.organisationId)]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader help="findings"
        title="Findings"
        subtitle="Identified issues — hazards, defects, non-conformances, service failures and improvement opportunities — from incidents, investigations, inspections and audits."
      />
      <FilterBar
        resetHref="/assurance/findings"
        fields={[
          { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
          { kind: 'select', name: 'state', label: 'Open & closed', value: f.state, options: [{ value: 'open', label: 'Open only' }, { value: 'overdue', label: 'Overdue' }, { value: 'closed', label: 'Closed / cancelled' }] },
          { kind: 'select', name: 'status', label: 'Any status', value: f.status, options: enumOptions(FINDING_STATUSES) },
          { kind: 'select', name: 'type', label: 'Any type', value: f.findingType, options: enumOptions(FINDING_TYPES) },
          { kind: 'select', name: 'risk', label: 'Any risk', value: f.riskLevelId, options: risks.map(r => ({ value: r.id, label: r.name })) },
          { kind: 'select', name: 'source', label: 'Any source', value: f.source, options: [
            { value: 'incident', label: 'From incidents' }, { value: 'investigation', label: 'From investigations' },
            { value: 'inspection', label: 'From inspections' }, { value: 'audit', label: 'From audits' }, { value: 'none', label: 'No source' },
          ] },
        ]}
      />
      <DataTable
        headers={['Finding', 'Type', 'Status', 'Risk', 'Source', 'Responsible', 'Due', 'Actions']}
        minWidth={1040}
        empty={rows.length === 0 ? (filtered ? 'No findings match these filters.' : 'No findings have been raised yet. Findings are raised from incidents, investigations and failed inspection items.') : undefined}
      >
        {rows.map((r, i) => {
          const open = r.status !== 'CLOSED' && r.status !== 'CANCELLED';
          return (
            <Row key={r.id} last={i === rows.length - 1}>
              <td style={{ ...td, maxWidth: 300 }}><RecordLink href={`/assurance/findings/${r.id}`} reference={r.finding_reference} title={r.title} /></td>
              <td style={td}>{assuranceLabel(r.finding_type)}</td>
              <td style={td}><Badge value={r.status} /></td>
              <td style={td}>{r.risk_name ?? <Dim>—</Dim>}</td>
              <td style={td}>
                {r.sources.length === 0 ? <Dim>—</Dim> : r.sources.map(s => <RefChip key={`${s.kind}-${s.id}`} href={`${SOURCE_HREF[s.kind]}/${s.id}`} reference={s.reference} kind={s.kind} />)}
              </td>
              <td style={td}>{r.responsible_name ?? <Dim>Unassigned</Dim>}</td>
              <td style={td}><DateCell value={r.due_at} overdue={open && isPast(r.due_at)} /></td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                {r.action_count === 0 ? <Dim>None</Dim> : `${r.open_action_count} open / ${r.action_count}`}
              </td>
            </Row>
          );
        })}
      </DataTable>
    </div>
  );
}
