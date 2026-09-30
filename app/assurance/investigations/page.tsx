import { listInvestigations } from '@/lib/assurance/investigations';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { INVESTIGATION_STATUSES, isPast } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import {
  Badge, DataTable, DateCell, Dim, FilterBar, LinkButton, PageHeader, RecordLink, RefChip, RestrictedTag, Row, enumOptions, td,
} from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function InvestigationsPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = {
    q: firstParam(sp.q), status: firstParam(sp.status), leadUserId: firstParam(sp.lead),
    state: firstParam(sp.state) as 'active' | 'completed' | 'all' | undefined,
    restricted: firstParam(sp.restricted) as 'yes' | 'no' | undefined,
  };
  const [rows, users] = await Promise.all([listInvestigations(viewer, f), listOrgUserOptions(viewer.organisationId)]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader help="investigations"
        title="Investigations"
        subtitle="The formal process used to understand what happened. One investigation can cover several incidents, and an incident can be part of several investigations."
        actions={viewerCan(viewer, 'record') ? <LinkButton href="/assurance/investigations/new">Start investigation</LinkButton> : undefined}
      />
      <FilterBar
        resetHref="/assurance/investigations"
        fields={[
          { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
          { kind: 'select', name: 'state', label: 'Active & completed', value: f.state, options: [{ value: 'active', label: 'Active only' }, { value: 'completed', label: 'Completed / cancelled' }] },
          { kind: 'select', name: 'status', label: 'Any status', value: f.status, options: enumOptions(INVESTIGATION_STATUSES) },
          { kind: 'select', name: 'lead', label: 'Any lead', value: f.leadUserId, options: users.map(u => ({ value: u.id, label: u.name })) },
          { kind: 'select', name: 'restricted', label: 'Restricted & open', value: f.restricted, options: [{ value: 'yes', label: 'Restricted only' }, { value: 'no', label: 'Not restricted' }] },
        ]}
      />
      <DataTable
        headers={['Investigation', 'Status', 'Lead', 'Started', 'Target completion', 'Linked incidents', 'Findings']}
        minWidth={980}
        empty={rows.length === 0 ? (filtered ? 'No investigations match these filters.' : 'No investigations have been started yet.') : undefined}
      >
        {rows.map((r, i) => {
          const active = r.status !== 'COMPLETED' && r.status !== 'CANCELLED';
          return (
            <Row key={r.id} last={i === rows.length - 1}>
              <td style={{ ...td, maxWidth: 320 }}>
                <RecordLink href={`/assurance/investigations/${r.id}`} reference={r.investigation_reference} title={r.title} />
                {r.restricted && <div style={{ marginTop: 4 }}><RestrictedTag /></div>}
              </td>
              <td style={td}><Badge value={r.status} /></td>
              <td style={td}>{r.lead_name ?? <Dim>Unassigned</Dim>}</td>
              <td style={td}><DateCell value={r.started_at} /></td>
              <td style={td}><DateCell value={r.target_completion_at} overdue={active && isPast(r.target_completion_at)} /></td>
              <td style={td}>
                {r.linked_incidents.length === 0 && r.hidden_incident_count === 0 && <Dim>None</Dim>}
                {r.linked_incidents.map(l => <RefChip key={l.id} href={`/assurance/incidents/${l.id}`} reference={l.reference} kind="incident" />)}
                {r.hidden_incident_count > 0 && <Dim>+{r.hidden_incident_count} restricted</Dim>}
              </td>
              <td style={td}>{r.finding_count || <Dim>0</Dim>}</td>
            </Row>
          );
        })}
      </DataTable>
    </div>
  );
}
