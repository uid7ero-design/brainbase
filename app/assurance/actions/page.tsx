import Link from 'next/link';
import { listActions } from '@/lib/assurance/actions';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { ACTION_PRIORITIES, ACTION_STATUSES, ACTION_TYPES, isPast } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import { Badge, DataTable, DateCell, Dim, FilterBar, PageHeader, RecordLink, RefChip, Row, enumOptions, td, assuranceStyles as styles } from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
type View = 'open' | 'overdue' | 'awaiting_verification' | 'mine' | 'closed';

const VIEWS: { value: '' | View; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'mine', label: 'Mine' },
  { value: 'awaiting_verification', label: 'Awaiting verification' },
  { value: 'closed', label: 'Closed' },
];

export default async function ActionsPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = {
    q: firstParam(sp.q), status: firstParam(sp.status), priority: firstParam(sp.priority), actionType: firstParam(sp.type),
    ownerUserId: firstParam(sp.owner), view: firstParam(sp.view) as View | undefined,
  };
  const [rows, users] = await Promise.all([listActions(viewer, f), listOrgUserOptions(viewer.organisationId)]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader
        title="Corrective actions"
        subtitle="Controlled responses to findings. Work completion, evidence, independent verification and closure are each explicit steps."
      />
      <nav aria-label="Action views" className={styles.viewTabs}>
        {VIEWS.map(v => {
          const active = (f.view ?? '') === v.value;
          return (
            <Link key={v.value} href={v.value ? `/assurance/actions?view=${v.value}` : '/assurance/actions'} aria-current={active ? 'page' : undefined}
              className={styles.viewTab}>
              {v.label}
            </Link>
          );
        })}
      </nav>
      <FilterBar
        resetHref="/assurance/actions"
        fields={[
          { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
          { kind: 'select', name: 'status', label: 'Any status', value: f.status, options: enumOptions(ACTION_STATUSES) },
          { kind: 'select', name: 'priority', label: 'Any priority', value: f.priority, options: enumOptions(ACTION_PRIORITIES) },
          { kind: 'select', name: 'type', label: 'Any type', value: f.actionType, options: enumOptions(ACTION_TYPES) },
          { kind: 'select', name: 'owner', label: 'Any owner', value: f.ownerUserId, options: users.map(u => ({ value: u.id, label: u.name })) },
        ]}
      />
      <DataTable
        headers={['Action', 'Priority', 'Status', 'Owner', 'Due', 'Findings', 'Evidence', 'Verification']}
        minWidth={1060}
        empty={rows.length === 0 ? (filtered ? 'No actions match these filters.' : 'No corrective actions yet. Actions are created from findings.') : undefined}
      >
        {rows.map((r, i) => {
          const open = r.status !== 'CLOSED' && r.status !== 'CANCELLED';
          return (
            <Row key={r.id} last={i === rows.length - 1}>
              <td style={{ ...td, maxWidth: 300 }}><RecordLink href={`/assurance/actions/${r.id}`} reference={r.action_reference} title={r.title} /></td>
              <td style={td}><Badge value={r.priority} /></td>
              <td style={td}><Badge value={r.status} /></td>
              <td style={td}>{r.owner_name ?? <Dim>Unassigned</Dim>}</td>
              <td style={td}><DateCell value={r.due_at} overdue={open && isPast(r.due_at)} /></td>
              <td style={td}>{r.findings.map(x => <RefChip key={x.id} href={`/assurance/findings/${x.id}`} reference={x.reference} kind="finding" />)}</td>
              <td style={td}>{r.evidence_required ? (r.active_evidence_count > 0 ? `${r.active_evidence_count} linked` : <span style={{ color: 'var(--status-warning)' }}>Required</span>) : (r.active_evidence_count > 0 ? `${r.active_evidence_count} linked` : <Dim>—</Dim>)}</td>
              <td style={td}>{r.latest_verification_result ? <Badge value={r.latest_verification_result} /> : r.verification_required ? <Dim>Pending</Dim> : <Dim>Not required</Dim>}</td>
            </Row>
          );
        })}
      </DataTable>
    </div>
  );
}
