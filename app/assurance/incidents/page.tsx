import { listIncidents, INCIDENT_LIST_LIMIT } from '@/lib/assurance/incidents';
import { listLocationOptions, listRiskLevels } from '@/lib/assurance/lookups';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { INCIDENT_CATEGORIES, INCIDENT_STATUSES, assuranceLabel } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import {
  Badge, DataTable, DateCell, Dim, FilterBar, LinkButton, PageHeader, RecordLink, RestrictedTag, Row, enumOptions, td,
} from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function IncidentsPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = {
    q: firstParam(sp.q), status: firstParam(sp.status), category: firstParam(sp.category),
    riskLevelId: firstParam(sp.risk), ownerUserId: firstParam(sp.owner), locationId: firstParam(sp.location),
    restricted: firstParam(sp.restricted) as 'yes' | 'no' | undefined, state: firstParam(sp.state) as 'open' | 'closed' | 'all' | undefined,
    occurredFrom: firstParam(sp.from), occurredTo: firstParam(sp.to),
  };

  const [rows, risks, users, locations] = await Promise.all([
    listIncidents(viewer, f),
    listRiskLevels(viewer.organisationId),
    listOrgUserOptions(viewer.organisationId),
    listLocationOptions(viewer.organisationId),
  ]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader
        title="Incidents"
        subtitle="What happened — reported events, near misses and service failures."
        actions={viewerCan(viewer, 'record') ? <LinkButton href="/assurance/incidents/new">Report incident</LinkButton> : undefined}
      />
      <FilterBar
        resetHref="/assurance/incidents"
        fields={[
          { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
          { kind: 'select', name: 'state', label: 'Open & closed', value: f.state, options: [{ value: 'open', label: 'Open only' }, { value: 'closed', label: 'Closed / cancelled' }] },
          { kind: 'select', name: 'status', label: 'Any status', value: f.status, options: enumOptions(INCIDENT_STATUSES) },
          { kind: 'select', name: 'category', label: 'Any category', value: f.category, options: enumOptions(INCIDENT_CATEGORIES) },
          { kind: 'select', name: 'risk', label: 'Any risk', value: f.riskLevelId, options: risks.map(r => ({ value: r.id, label: r.name })) },
          { kind: 'select', name: 'owner', label: 'Any owner', value: f.ownerUserId, options: users.map(u => ({ value: u.id, label: u.name })) },
          { kind: 'select', name: 'location', label: 'Any location', value: f.locationId, options: locations.map(l => ({ value: l.id, label: l.name })) },
          { kind: 'select', name: 'restricted', label: 'Restricted & open', value: f.restricted, options: [{ value: 'yes', label: 'Restricted only' }, { value: 'no', label: 'Not restricted' }] },
          { kind: 'date', name: 'from', label: 'From', value: f.occurredFrom },
          { kind: 'date', name: 'to', label: 'To', value: f.occurredTo },
        ]}
      />
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>
        {rows.length} incident{rows.length === 1 ? '' : 's'}{rows.length >= INCIDENT_LIST_LIMIT ? ` (showing the most recent ${INCIDENT_LIST_LIMIT} — refine the filters)` : ''}
      </p>
      <DataTable
        headers={['Incident', 'Category', 'Status', 'Risk', 'Occurred', 'Owner', 'Location', 'Links']}
        minWidth={980}
        empty={rows.length === 0 ? (filtered ? 'No incidents match these filters.' : 'No incidents have been reported yet.') : undefined}
      >
        {rows.map((r, i) => (
          <Row key={r.id} last={i === rows.length - 1}>
            <td style={{ ...td, maxWidth: 320 }}>
              <RecordLink href={`/assurance/incidents/${r.id}`} reference={r.incident_reference} title={r.title} />
              {r.restricted && <div style={{ marginTop: 4 }}><RestrictedTag /></div>}
            </td>
            <td style={td}>{assuranceLabel(r.category)}</td>
            <td style={td}><Badge value={r.status} /></td>
            <td style={td}>{r.risk_name ?? <Dim>—</Dim>}</td>
            <td style={td}><DateCell value={r.occurred_at} withTime /></td>
            <td style={td}>{r.owner_name ?? <Dim>Unassigned</Dim>}</td>
            <td style={td}>{r.location_name ?? <Dim>—</Dim>}</td>
            <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12 }}>
              {r.investigation_count > 0 ? `${r.investigation_count} inv.` : <Dim>—</Dim>}
              {r.finding_count > 0 && <span> · {r.finding_count} finding{r.finding_count === 1 ? '' : 's'}</span>}
            </td>
          </Row>
        ))}
      </DataTable>
    </div>
  );
}
