import Link from 'next/link';
import { listFindings } from '@/lib/assurance/findings';
import { listRiskLevels } from '@/lib/assurance/lookups';
import { FINDING_STATUSES, FINDING_TYPES, assuranceLabel, isPast } from '@/lib/assurance/domain';
import {
  FINDING_PROGRESS_LABELS, FINDING_PROGRESS_TONES, FINDING_REGISTER_VIEWS, FINDING_REGISTER_VIEW_LABELS, findingProgress,
  isFindingTerminal, parseFindingView,
} from '@/lib/assurance/findingRules';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import { Badge, DataTable, DateCell, Dim, FilterBar, PageHeader, RecordLink, RefChip, Row, enumOptions, td, assuranceStyles as styles } from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

const SOURCE_HREF = {
  incident: '/assurance/incidents', investigation: '/assurance/investigations', inspection: '/assurance/inspections',
  audit: '/assurance/audits', contractor: '/assurance/contractors',
} as const;

const VIEW_EMPTY: Record<string, string> = {
  open: 'No open findings.',
  needs_action: 'Every open finding has at least one corrective action.',
  underway: 'No open finding has corrective work underway.',
  overdue: 'No open finding is past its closure deadline.',
  ready: 'No finding is waiting for a closure decision.',
  closed: 'No findings have been closed or cancelled yet.',
};

export default async function FindingsPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const view = parseFindingView(firstParam(sp.view) ?? firstParam(sp.state));
  const f = {
    q: firstParam(sp.q), status: firstParam(sp.status), findingType: firstParam(sp.type), riskLevelId: firstParam(sp.risk),
    source: firstParam(sp.source) as 'incident' | 'investigation' | 'inspection' | 'audit' | 'contractor' | 'none' | undefined,
  };
  const [rows, risks] = await Promise.all([listFindings(viewer, { ...f, view }), listRiskLevels(viewer.organisationId)]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader help="findings"
        title="Findings"
        subtitle="Identified issues — hazards, defects, non-conformances, service failures and improvement opportunities — from incidents, investigations, inspections, audits and contractor requirements."
      />
      <nav aria-label="Finding views" className={styles.viewTabs}>
        {FINDING_REGISTER_VIEWS.map(v => (
          <Link key={v} href={v === 'all' ? '/assurance/findings' : `/assurance/findings?view=${v}`} aria-current={view === v ? 'page' : undefined}
            className={styles.viewTab}>
            {FINDING_REGISTER_VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>
      <FilterBar
        resetHref={view === 'all' ? '/assurance/findings' : `/assurance/findings?view=${view}`}
        fields={[
          { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
          { kind: 'select', name: 'status', label: 'Any status', value: f.status, options: enumOptions(FINDING_STATUSES) },
          { kind: 'select', name: 'type', label: 'Any type', value: f.findingType, options: enumOptions(FINDING_TYPES) },
          { kind: 'select', name: 'risk', label: 'Any risk', value: f.riskLevelId, options: risks.map(r => ({ value: r.id, label: r.name })) },
          { kind: 'select', name: 'source', label: 'Any source', value: f.source, options: [
            { value: 'incident', label: 'From incidents' }, { value: 'investigation', label: 'From investigations' },
            { value: 'inspection', label: 'From inspections' }, { value: 'audit', label: 'From audits' },
            { value: 'contractor', label: 'From contractor requirements' }, { value: 'none', label: 'No source' },
          ] },
          { kind: 'hidden', name: 'view', value: view === 'all' ? undefined : view },
        ]}
      />
      <DataTable
        headers={['Finding', 'Type', 'Status', 'Progress', 'Risk', 'Source', 'Due', 'Actions']}
        minWidth={1080}
        empty={rows.length === 0
          ? (filtered ? 'No findings match these filters.'
            : view !== 'all' ? VIEW_EMPTY[view]
              : 'No findings have been raised yet. Findings are raised from incidents, investigations, inspection items, audit criteria and contractor requirements.')
          : undefined}
      >
        {rows.map((r, i) => {
          const open = !isFindingTerminal(r.status);
          const progress = findingProgress({ status: r.status, open_action_count: r.open_action_count_all, closed_action_count: r.closed_action_count_all });
          return (
            <Row key={r.id} last={i === rows.length - 1}>
              <td style={{ ...td, maxWidth: 300 }}><RecordLink href={`/assurance/findings/${r.id}`} reference={r.finding_reference} title={r.title} /></td>
              <td style={td}>{assuranceLabel(r.finding_type)}</td>
              <td style={td}>
                <Badge value={r.status} />
                {r.reopen_count > 0 && <div style={{ marginTop: 4 }}><Dim>Reopened {r.reopen_count}×</Dim></div>}
              </td>
              <td style={td}>{open ? <Badge value={progress} label={FINDING_PROGRESS_LABELS[progress]} tone={FINDING_PROGRESS_TONES[progress]} /> : <Dim>—</Dim>}</td>
              <td style={td}>{r.risk_name ?? <Dim>—</Dim>}</td>
              <td style={td}>
                {r.sources.length === 0 ? <Dim>—</Dim> : r.sources.map(s => (
                  <span key={`${s.kind}-${s.id}-${s.context_key ?? ''}`} style={{ display: 'block' }}>
                    <RefChip href={`${SOURCE_HREF[s.kind]}/${s.id}`} reference={s.reference} kind={s.kind} />
                    {s.context && <Dim> {s.context}</Dim>}
                  </span>
                ))}
              </td>
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
