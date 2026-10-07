import Link from 'next/link';
import { listIncidents, INCIDENT_LIST_LIMIT } from '@/lib/assurance/incidents';
import { listExternalOrganisationOptions, listLocationOptions, listRiskLevels } from '@/lib/assurance/lookups';
import { INCIDENT_REGISTER_VIEWS, INCIDENT_REGISTER_VIEW_LABELS, parseIncidentView } from '@/lib/assurance/incidentRules';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { INCIDENT_CATEGORIES, INCIDENT_STATUSES, assuranceLabel } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import {
  Badge, DataTable, DateCell, Dim, FilterBar, LinkButton, PageHeader, RecordLink, RestrictedTag, Row, enumOptions, td,
  assuranceStyles as styles,
} from '../_components/ui';

const VIEW_EMPTY: Record<string, string> = {
  open: 'No open incidents.',
  needs_triage: 'No incident is waiting for triage.',
  investigation_required: 'No incident is marked as needing investigation.',
  under_investigation: 'No incident is under investigation.',
  findings_open: 'No open incident has open findings.',
  ready: 'No incident is awaiting verification with everything linked resolved.',
  closed: 'No incidents have been closed or cancelled yet.',
};

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function IncidentsPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = {
    q: firstParam(sp.q), status: firstParam(sp.status), category: firstParam(sp.category),
    riskLevelId: firstParam(sp.risk), ownerUserId: firstParam(sp.owner), locationId: firstParam(sp.location),
    externalOrganisationId: firstParam(sp.org),
    restricted: firstParam(sp.restricted) as 'yes' | 'no' | undefined,
    occurredFrom: firstParam(sp.from), occurredTo: firstParam(sp.to),
  };
  const view = parseIncidentView(firstParam(sp.view) ?? firstParam(sp.state));

  const [rows, risks, users, locations, orgs] = await Promise.all([
    listIncidents(viewer, { ...f, view }),
    listRiskLevels(viewer.organisationId),
    listOrgUserOptions(viewer.organisationId),
    listLocationOptions(viewer.organisationId, { includeInactive: true }),
    listExternalOrganisationOptions(viewer.organisationId, { includeInactive: true }),
  ]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader help="incidents"
        title="Incidents"
        subtitle="What happened — reported events, near misses and service failures."
        actions={viewerCan(viewer, 'record') ? <LinkButton href="/assurance/incidents/new">Report incident</LinkButton> : undefined}
      />
      <nav aria-label="Incident views" className={styles.viewTabs}>
        {INCIDENT_REGISTER_VIEWS.map(v => (
          <Link key={v} href={v === 'all' ? '/assurance/incidents' : `/assurance/incidents?view=${v}`} aria-current={view === v ? 'page' : undefined}
            className={styles.viewTab}>
            {INCIDENT_REGISTER_VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>
      <FilterBar
        resetHref={view === 'all' ? '/assurance/incidents' : `/assurance/incidents?view=${view}`}
        fields={[
          { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
          { kind: 'select', name: 'status', label: 'Any status', value: f.status, options: enumOptions(INCIDENT_STATUSES) },
          { kind: 'select', name: 'category', label: 'Any category', value: f.category, options: enumOptions(INCIDENT_CATEGORIES) },
          { kind: 'select', name: 'risk', label: 'Any risk', value: f.riskLevelId, options: risks.map(r => ({ value: r.id, label: r.name })) },
          { kind: 'select', name: 'owner', label: 'Any owner', value: f.ownerUserId, options: users.map(u => ({ value: u.id, label: u.name })) },
          { kind: 'select', name: 'location', label: 'Any location', value: f.locationId, options: locations.map(l => ({ value: l.id, label: l.inactive ? `${l.name} (inactive)` : l.name })) },
          { kind: 'select', name: 'org', label: 'Any external organisation', value: f.externalOrganisationId, options: orgs.map(o => ({ value: o.id, label: o.inactive ? `${o.name} (inactive)` : o.name })) },
          { kind: 'select', name: 'restricted', label: 'Restricted & open', value: f.restricted, options: [{ value: 'yes', label: 'Restricted only' }, { value: 'no', label: 'Not restricted' }] },
          { kind: 'date', name: 'from', label: 'From', value: f.occurredFrom },
          { kind: 'date', name: 'to', label: 'To', value: f.occurredTo },
          { kind: 'hidden', name: 'view', value: view === 'all' ? undefined : view },
        ]}
      />
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>
        {rows.length} incident{rows.length === 1 ? '' : 's'}{rows.length >= INCIDENT_LIST_LIMIT ? ` (showing the most recent ${INCIDENT_LIST_LIMIT} — refine the filters)` : ''}
      </p>
      <DataTable
        headers={['Incident', 'Status', 'Risk', 'Occurred', 'Owner', 'Where', 'Investigation', 'Findings', 'Open actions']}
        minWidth={1120}
        empty={rows.length === 0 ? (filtered ? 'No incidents match these filters.' : view !== 'all' ? VIEW_EMPTY[view] : 'No incidents have been reported yet.') : undefined}
      >
        {rows.map((r, i) => (
          <Row key={r.id} last={i === rows.length - 1}>
            <td style={{ ...td, maxWidth: 320 }}>
              <RecordLink href={`/assurance/incidents/${r.id}`} reference={r.incident_reference} title={r.title} />
              {r.restricted && <div style={{ marginTop: 4 }}><RestrictedTag /></div>}
            </td>
            <td style={td}><Badge value={r.status} /><div style={{ marginTop: 4 }}><Dim>{assuranceLabel(r.category)}</Dim></div></td>
            <td style={td}>{r.risk_name ?? <Dim>Not set</Dim>}</td>
            <td style={td}><DateCell value={r.occurred_at} withTime /></td>
            <td style={td}>{r.owner_name ?? <Dim>Unassigned</Dim>}</td>
            <td style={{ ...td, fontSize: 12 }}>
              {[r.location_name, r.asset_name, r.external_organisation_name].filter(Boolean).join(' · ') || <Dim>—</Dim>}
            </td>
            <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12 }}>
              {r.investigation_count === 0 ? <Dim>None</Dim> : r.active_investigation_count > 0 ? `${r.active_investigation_count} active` : `${r.investigation_count} finished`}
            </td>
            <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12 }}>
              {r.finding_count === 0 ? <Dim>None</Dim> : `${r.open_finding_count} open / ${r.finding_count}`}
            </td>
            <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12 }}>{r.open_action_count === 0 ? <Dim>—</Dim> : r.open_action_count}</td>
          </Row>
        ))}
      </DataTable>
    </div>
  );
}
