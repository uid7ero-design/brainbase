import Link from 'next/link';
import { listContractorRegister, listScopeCandidates, type RegisterView } from '@/lib/assurance/contractorAssurance';
import { HEADLINE_LABEL, HEADLINE_TONE } from '@/lib/assurance/contractorAssuranceRules';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { listOrgUserOptions } from '@/lib/assurance/users';
import { resolvePageViewer } from '../_components/pageAccess';
import ActionPanel from '../_components/ActionPanel';
import {
  Badge, DataTable, DateCell, Dim, EmptyState, FilterBar, LinkButton, Notice, PageHeader, RecordLink, Row, Section, td, assuranceStyles as styles, tableStyles,
} from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

const VIEWS: { value: RegisterView; label: string }[] = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'expired', label: 'Expired' },
  { value: 'expiring', label: 'Expiring soon' },
  { value: 'review', label: 'Awaiting review' },
  { value: 'missing', label: 'Missing evidence' },
  { value: 'current', label: 'Current' },
  { value: 'all', label: 'All in scope' },
  { value: 'out_of_scope', label: 'Out of scope' },
];
const VIEW_VALUES = new Set(VIEWS.map(v => v.value));

// Contractor assurance: which shared external organisations are in Assurance
// scope, what is required of them, and what evidence is current, expiring,
// expired, missing or awaiting review. Status is derived from facts by a
// documented rule — it is not a risk or compliance score.
export default async function ContractorAssurancePage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const rawView = firstParam(sp.view);
  const view: RegisterView = rawView && VIEW_VALUES.has(rawView as RegisterView) ? (rawView as RegisterView) : 'attention';
  const q = firstParam(sp.q) ?? null;
  const canRecord = viewerCan(viewer, 'record');
  const [register, candidates, users] = await Promise.all([
    listContractorRegister(viewer, { view, q }),
    canRecord ? listScopeCandidates(viewer) : Promise.resolve([]),
    canRecord ? listOrgUserOptions(viewer.organisationId) : Promise.resolve([]),
  ]);
  const { rows, totals } = register;
  const qs = (v: RegisterView) => (v === 'attention' ? '/assurance/contractors' : `/assurance/contractors?view=${v}`);

  const addPanel = canRecord && candidates.length > 0 ? (
    <ActionPanel label="Add organisation to Assurance scope" variant="primary" endpoint="/api/assurance/contractors/scope"
      description="Assurance scope is separate from the organisation's relationship roles: a contractor is not automatically in scope, and any external organisation can be brought into scope."
      fields={[
        { kind: 'select', name: 'externalOrganisationId', label: 'External organisation', required: true,
          options: candidates.map(c => ({ value: c.id, label: `${c.name} (${c.reference})${c.roles.length ? ` — ${c.roles.map(r => assuranceLabel(r)).join(', ')}` : ''}` })) },
        { kind: 'select', name: 'responsibleUserId', label: 'Responsible person (optional)', options: users.map(u => ({ value: u.id, label: u.name })), emptyLabel: 'No one' },
        { kind: 'textarea', name: 'notes', label: 'Notes (optional)', rows: 2 },
      ]}
      submitLabel="Add to scope" />
  ) : null;

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader help="contractors"
        title="Contractor assurance"
        subtitle="Requirements, evidence and expiry for the shared external organisations your organisation has brought into Assurance scope."
        actions={<LinkButton href="/assurance/contractors/requirements" variant="secondary">Requirement library</LinkButton>}
      />

      {totals.externalOrganisations === 0 ? (
        <EmptyState title="No external organisations yet"
          body={<>Contractor assurance works on your organisation&apos;s shared external organisations — contractors, suppliers, service providers and others. Add them under <Link href="/assurance/settings/reference-data/external-organisations" className={tableStyles.link}>Settings → Reference data</Link> first, then bring the ones that need assurance into scope here.</>} />
      ) : totals.inScope + totals.outOfScope === 0 ? (
        <EmptyState title="No organisations are in Assurance scope yet"
          body="Bring an external organisation into scope to assign requirements and record its evidence."
          action={addPanel ?? undefined} />
      ) : (
        <>
          <nav aria-label="Contractor assurance views" className={styles.viewTabs}>
            {VIEWS.map(v => (
              <Link key={v.value} href={qs(v.value)} aria-current={view === v.value ? 'page' : undefined} className={styles.viewTab}>{v.label}</Link>
            ))}
          </nav>
          <FilterBar resetHref={qs(view)} count={`${rows.length} organisation${rows.length === 1 ? '' : 's'}`}
            fields={[
              { kind: 'hidden', name: 'view', value: view === 'attention' ? '' : view },
              { kind: 'search', name: 'q', placeholder: 'Search name or reference', value: q ?? undefined },
            ]} />
          <DataTable headers={['Organisation', 'Status', 'Requirements', 'Expired', 'Expiring soon', 'Missing', 'Awaiting review', 'Responsible', 'Last reviewed']}
            minWidth={1000} empty={rows.length === 0 ? 'No organisations match this view.' : undefined}>
            {rows.map(r => (
              <Row key={r.external_organisation_id}>
                <td style={{ ...td, maxWidth: 280 }}>
                  <RecordLink href={`/assurance/contractors/${r.external_organisation_id}`} reference={r.reference} title={r.name} />
                  {r.roles.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.roles.map(x => assuranceLabel(x)).join(', ')}</div>}
                </td>
                <td style={td}>
                  {r.scope_status === 'OUT_OF_SCOPE'
                    ? <Badge value="OUT_OF_SCOPE" tone="neutral" label="Out of scope" />
                    : <Badge value={r.headline} tone={HEADLINE_TONE[r.headline]} label={HEADLINE_LABEL[r.headline]} />}
                </td>
                <td style={td}>{r.assignment_count}</td>
                <td style={td}>{r.counts.EXPIRED || <Dim>0</Dim>}</td>
                <td style={td}>{r.counts.EXPIRING_SOON || <Dim>0</Dim>}</td>
                <td style={td}>{r.counts.MISSING || <Dim>0</Dim>}</td>
                <td style={td}>{r.awaiting_review || <Dim>0</Dim>}</td>
                <td style={td}>{r.responsible_name ?? <Dim>—</Dim>}</td>
                <td style={td}><DateCell value={r.last_reviewed_at} /></td>
              </Row>
            ))}
          </DataTable>
          <div style={{ marginTop: 16 }}>
            <Notice>
              Status is worked out from each requirement&apos;s current accepted evidence, as of today ({register.today}, {register.timeZone}):
              expired evidence first, then missing evidence, then evidence awaiting review, then evidence inside a requirement&apos;s renewal notice period.
              The counts show every fact behind it. It is not a risk or compliance score.
            </Notice>
          </div>
          {addPanel && (
            <div style={{ marginTop: 24 }}>
              <Section title="Add an organisation">{addPanel}</Section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
