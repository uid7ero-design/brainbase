import Link from 'next/link';
import { listInvestigations } from '@/lib/assurance/investigations';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { viewerCan } from '@/lib/assurance/authorize';
import { INVESTIGATION_STATUSES, isPast } from '@/lib/assurance/domain';
import { INVESTIGATION_REGISTER_VIEWS, INVESTIGATION_REGISTER_VIEW_LABELS, parseInvestigationView } from '@/lib/assurance/incidentRules';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import {
  Badge, DataTable, DateCell, Dim, FilterBar, LinkButton, PageHeader, RecordLink, RefChip, RestrictedTag, Row, enumOptions, td,
  assuranceStyles as styles,
} from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

const VIEW_EMPTY: Record<string, string> = {
  active: 'No investigation is in progress.',
  planning: 'No investigation is open or in planning.',
  in_progress: 'No investigation is in progress.',
  awaiting_information: 'No investigation is waiting for information.',
  awaiting_review: 'No investigation is awaiting review.',
  findings_recorded: 'No investigation has raised findings yet.',
  finished: 'No investigations have been completed or cancelled yet.',
};

export default async function InvestigationsPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = {
    q: firstParam(sp.q), status: firstParam(sp.status), leadUserId: firstParam(sp.lead),
    restricted: firstParam(sp.restricted) as 'yes' | 'no' | undefined,
  };
  const legacyState = firstParam(sp.state);
  const view = parseInvestigationView(firstParam(sp.view) ?? (legacyState === 'completed' ? 'finished' : legacyState));
  const [rows, users] = await Promise.all([listInvestigations(viewer, { ...f, view }), listOrgUserOptions(viewer.organisationId)]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader help="investigations"
        title="Investigations"
        subtitle="The formal process used to understand what happened. One investigation can cover several incidents, and an incident can be part of several investigations."
        actions={viewerCan(viewer, 'record') ? <LinkButton href="/assurance/investigations/new">Start investigation</LinkButton> : undefined}
      />
      <nav aria-label="Investigation views" className={styles.viewTabs}>
        {INVESTIGATION_REGISTER_VIEWS.map(v => (
          <Link key={v} href={v === 'all' ? '/assurance/investigations' : `/assurance/investigations?view=${v}`} aria-current={view === v ? 'page' : undefined}
            className={styles.viewTab}>
            {INVESTIGATION_REGISTER_VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>
      <FilterBar
        resetHref={view === 'all' ? '/assurance/investigations' : `/assurance/investigations?view=${view}`}
        fields={[
          { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
          { kind: 'select', name: 'status', label: 'Any status', value: f.status, options: enumOptions(INVESTIGATION_STATUSES) },
          { kind: 'select', name: 'lead', label: 'Any lead', value: f.leadUserId, options: users.map(u => ({ value: u.id, label: u.name })) },
          { kind: 'select', name: 'restricted', label: 'Restricted & open', value: f.restricted, options: [{ value: 'yes', label: 'Restricted only' }, { value: 'no', label: 'Not restricted' }] },
          { kind: 'hidden', name: 'view', value: view === 'all' ? undefined : view },
        ]}
      />
      <DataTable
        headers={['Investigation', 'Status', 'Lead', 'Started', 'Target completion', 'Source incidents', 'Evidence', 'Findings', 'Open actions']}
        minWidth={1160}
        empty={rows.length === 0 ? (filtered ? 'No investigations match these filters.' : view !== 'all' ? VIEW_EMPTY[view] : 'No investigations have been started yet.') : undefined}
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
              <td style={td}>{r.target_completion_at ? <DateCell value={r.target_completion_at} overdue={active && isPast(r.target_completion_at)} /> : <Dim>—</Dim>}</td>
              <td style={td}>
                {r.linked_incidents.length === 0 && r.hidden_incident_count === 0 && <Dim>None</Dim>}
                {r.linked_incidents.map(l => <RefChip key={l.id} href={`/assurance/incidents/${l.id}`} reference={l.reference} kind="incident" />)}
                {r.hidden_incident_count > 0 && <Dim>+{r.hidden_incident_count} restricted</Dim>}
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.evidence_count || <Dim>0</Dim>}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.finding_count === 0 ? <Dim>0</Dim> : `${r.open_finding_count} open / ${r.finding_count}`}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.open_action_count || <Dim>—</Dim>}</td>
            </Row>
          );
        })}
      </DataTable>
    </div>
  );
}
