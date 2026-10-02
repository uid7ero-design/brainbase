import Link from 'next/link';
import { formatAssuranceDate } from '@/lib/assurance/domain';
import { getAssuranceTimeZone, listDeadlines, type DeadlineView } from '@/lib/assurance/deadlines';
import { deadlineUrgency } from '@/lib/assurance/deadlineRules';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import { Badge, DataTable, Dim, FilterBar, PageHeader, RecordLink, Row, td, assuranceStyles as styles } from '../_components/ui';
import { UrgencyBadge, timeframeLabel } from '../_components/deadlines';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

const VIEWS: { value: DeadlineView; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'pending', label: 'Awaiting decision' },
  { value: 'extended', label: 'Extended' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'all', label: 'All' },
];
const VIEW_VALUES = new Set(VIEWS.map(v => v.value));

// Operational register of record-specific deadlines (finding CLOSURE and
// action ACTION timeframes). There are no organisation-wide SLA rules: a
// deadline exists only where a due date was entered on a finding or action.
export default async function DeadlinesPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const rawView = firstParam(sp.view);
  const view: DeadlineView = rawView && VIEW_VALUES.has(rawView as DeadlineView) ? (rawView as DeadlineView) : 'open';
  const kind = firstParam(sp.kind);
  const f: { view: DeadlineView; q?: string; kind?: 'finding' | 'action'; timeframeType?: string } = {
    view, q: firstParam(sp.q), kind: kind === 'finding' || kind === 'action' ? kind : undefined, timeframeType: firstParam(sp.type),
  };
  const [rows, tz] = await Promise.all([listDeadlines(viewer, f), getAssuranceTimeZone(viewer.organisationId)]);
  const filtered = Boolean(f.q || f.kind || f.timeframeType) || view !== 'open';
  const qs = (v: DeadlineView) => (v === 'open' ? '/assurance/deadlines' : `/assurance/deadlines?view=${v}`);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader help="deadlines"
        title="Deadlines"
        subtitle="Due dates set on findings and actions, with their extensions and escalations. Overdue and due-soon are worked out from each record's current due date."
      />
      <nav aria-label="Deadline views" className={styles.viewTabs}>
        {VIEWS.map(v => (
          <Link key={v.value} href={qs(v.value)} aria-current={view === v.value ? 'page' : undefined} className={styles.viewTab}>{v.label}</Link>
        ))}
      </nav>
      <FilterBar
        resetHref={qs(view)}
        fields={[
          { kind: 'hidden', name: 'view', value: view === 'open' ? '' : view },
          { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
          { kind: 'select', name: 'kind', label: 'Findings and actions', value: f.kind, options: [{ value: 'finding', label: 'Findings' }, { value: 'action', label: 'Actions' }] },
          { kind: 'select', name: 'type', label: 'Any deadline type', value: f.timeframeType, options: [{ value: 'CLOSURE', label: 'Closure deadline' }, { value: 'ACTION', label: 'Action deadline' }] },
        ]}
      />
      <DataTable
        label="Deadlines"
        headers={['Record', 'Deadline', 'Due', 'State', 'Owner', 'Extension', 'Escalation']}
        minWidth={980}
        empty={rows.length === 0 ? (filtered
          ? 'No deadlines match this view.'
          : <span><strong>No active Assurance deadlines.</strong> Due dates entered on findings and actions appear here. There are no organisation-wide deadline rules.</span>) : undefined}
      >
        {rows.map((r, i) => {
          const urgency = deadlineUrgency(r.current_due_at, r.open);
          const href = `/assurance/${r.record_kind === 'finding' ? 'findings' : 'actions'}/${r.record_id}#deadline`;
          return (
            <Row key={r.id} last={i === rows.length - 1}>
              <td style={{ ...td, maxWidth: 300 }}><RecordLink href={href} reference={r.record_reference} title={r.record_title} /></td>
              <td style={td}>{timeframeLabel(r.timeframe_type)}<br /><Dim>{r.record_kind === 'finding' ? 'Finding' : 'Action'} · {r.record_status.toLowerCase().replace(/_/g, ' ')}</Dim></td>
              <td style={td}>
                <span className={styles.deadlineDue}>
                  <span>{formatAssuranceDate(r.current_due_at, tz)}</span>
                  {r.extended && <span className={styles.deadlineOriginal}>Originally {formatAssuranceDate(r.original_due_at, tz)}</span>}
                </span>
              </td>
              <td style={td}><UrgencyBadge urgency={urgency} /></td>
              <td style={td}>{r.owner_name ?? <Dim>Unassigned</Dim>}</td>
              <td style={td}>
                {r.pending_extension ? <Badge value="PENDING" tone="warning" label="Awaiting decision" />
                  : r.extended ? <Badge value="EXTENDED" tone="info" label={`Extended${r.approved_extensions > 1 ? ` ×${r.approved_extensions}` : ''}`} />
                  : <Dim>—</Dim>}
              </td>
              <td style={td}>{r.open_escalations > 0 ? <Badge value="ESCALATED" tone="accent" label={`Level ${r.top_open_escalation_level}${r.open_escalations > 1 ? ` (${r.open_escalations})` : ''}`} /> : <Dim>—</Dim>}</td>
            </Row>
          );
        })}
      </DataTable>
    </div>
  );
}
