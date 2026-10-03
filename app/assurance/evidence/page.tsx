import Link from 'next/link';
import { EVIDENCE_RELATED_FILTERS, listEvidence, listSupplierOptions, type EvidenceRelatedFilter } from '@/lib/assurance/evidence';
import { EVIDENCE_STATE_LABEL, EVIDENCE_STATE_TONE, type EvidenceState } from '@/lib/assurance/evidenceRules';
import { viewerCan } from '@/lib/assurance/authorize';
import { EVIDENCE_TYPES, assuranceLabel } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import ActionPanel from '../_components/ActionPanel';
import { evidenceFields } from '../_components/shared';
import {
  Badge, DataTable, DateCell, Dim, EmptyState, FilterBar, PageHeader, RecordLink, RefChip, Row, assuranceStyles as styles, enumOptions, tableStyles, td,
} from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

const HREF = {
  incident: '/assurance/incidents', investigation: '/assurance/investigations', inspection: '/assurance/inspections', audit: '/assurance/audits',
  finding: '/assurance/findings', action: '/assurance/actions', verification: '/assurance/actions',
} as const;

const VIEWS: { value: '' | EvidenceState; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'AWAITING_VERIFICATION', label: EVIDENCE_STATE_LABEL.AWAITING_VERIFICATION },
  { value: 'ACCEPTED', label: EVIDENCE_STATE_LABEL.ACCEPTED },
  { value: 'REJECTED', label: EVIDENCE_STATE_LABEL.REJECTED },
  { value: 'SUPERSEDED', label: EVIDENCE_STATE_LABEL.SUPERSEDED },
  { value: 'UNVERIFIED', label: EVIDENCE_STATE_LABEL.UNVERIFIED },
];

const RELATED_LABEL: Record<EvidenceRelatedFilter, string> = {
  action: 'Supports an action', finding: 'Supports a finding', inspection: 'Supports an inspection', audit: 'Supports an audit',
  incident: 'Supports an incident', investigation: 'Supports an investigation', contractor: 'Contractor assurance', none: 'Not linked to anything',
};

export default async function EvidencePage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = { q: firstParam(sp.q), evidenceType: firstParam(sp.type), state: firstParam(sp.state), related: firstParam(sp.related) };
  const canRecord = viewerCan(viewer, 'record');
  const filtered = Object.values(f).some(Boolean);
  const [rows, suppliers, anyRows] = await Promise.all([
    listEvidence(viewer, f),
    canRecord ? listSupplierOptions(viewer) : Promise.resolve([]),
    filtered ? listEvidence(viewer, {}).then(r => r.length > 0) : Promise.resolve(null),
  ]);
  const hasEvidence = anyRows ?? rows.length > 0;
  const view = VIEWS.some(v => v.value === f.state) ? f.state ?? '' : '';
  const qs = (state: string) => {
    const p = new URLSearchParams();
    if (state) p.set('state', state);
    if (f.related) p.set('related', f.related);
    if (f.evidenceType) p.set('type', f.evidenceType);
    if (f.q) p.set('q', f.q);
    const s = p.toString();
    return s ? `/assurance/evidence?${s}` : '/assurance/evidence';
  };

  const recordPanel = canRecord ? (
    <ActionPanel label="Record evidence" variant="primary" endpoint="/api/assurance/evidence" redirectTo="/assurance/evidence/{id}"
      description="Record what the proof is and where the original is held, then link it to the records it supports from its page. (File upload is not available yet.)"
      fields={evidenceFields({ suppliers, purpose: false })} submitLabel="Record evidence" />
  ) : undefined;

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader help="evidence"
        title="Evidence"
        subtitle="What we have and what it supports. Evidence is recorded once and reused; links, decisions and replacements are kept as history — nothing is deleted."
        actions={hasEvidence ? recordPanel : undefined}
      />

      {!hasEvidence ? (
        <EmptyState title="No Assurance evidence has been recorded."
          body="Evidence records what the proof is, who recorded it and where the original is held. Link it to the actions, findings, inspections and audits it supports, and submit it for an independent verification decision."
          action={recordPanel} />
      ) : (
        <>
          <nav aria-label="Evidence verification states" className={styles.viewTabs}>
            {VIEWS.map(v => (
              <Link key={v.value || 'all'} href={qs(v.value)} aria-current={view === v.value ? 'page' : undefined} className={styles.viewTab}>{v.label}</Link>
            ))}
          </nav>
          <FilterBar
            resetHref={qs(view)}
            count={`${rows.length} item${rows.length === 1 ? '' : 's'}`}
            fields={[
              { kind: 'hidden', name: 'state', value: view || undefined },
              { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
              { kind: 'select', name: 'type', label: 'Any type', value: f.evidenceType, options: enumOptions(EVIDENCE_TYPES) },
              { kind: 'select', name: 'related', label: 'Supports anything', value: f.related,
                options: EVIDENCE_RELATED_FILTERS.map(r => ({ value: r, label: RELATED_LABEL[r] })) },
            ]}
          />
          <DataTable headers={['Evidence', 'Supports', 'Recorded', 'Supplied by', 'Verification', 'Dates']} minWidth={980}
            empty={rows.length === 0 ? 'No evidence matches these filters.' : undefined}>
            {rows.map((r, i) => (
              <Row key={r.id} last={i === rows.length - 1}>
                <td style={{ ...td, maxWidth: 280 }}>
                  <RecordLink href={`/assurance/evidence/${r.id}`} reference={r.evidence_reference} title={r.title} />
                  <div className={tableStyles.meta}>{assuranceLabel(r.evidence_type)}</div>
                </td>
                <td style={{ ...td, maxWidth: 300 }}>
                  {r.contractor && (
                    <div>
                      <Link href={`/assurance/contractors/${r.contractor.external_organisation_id}`} className={tableStyles.link}>{r.contractor.external_organisation_name}</Link>
                      <div className={tableStyles.meta}>{r.contractor.requirement_name}</div>
                    </div>
                  )}
                  {r.links.map(l => (
                    <RefChip key={`${l.kind}-${l.id}-${l.reference}`} href={`${HREF[l.kind]}/${l.id}`}
                      reference={l.item ? `${l.reference} · ${l.item}` : l.reference} kind={l.kind} />
                  ))}
                  {!r.contractor && r.links.length === 0 && <Dim>Not linked</Dim>}
                </td>
                <td style={td}><DateCell value={r.created_at} /><div className={tableStyles.meta}>{r.created_by_name ?? ''}</div></td>
                <td style={td}>{r.contractor ? r.contractor.external_organisation_name : r.supplier_name ?? <Dim>Recorded internally</Dim>}</td>
                <td style={td}>
                  <Badge value={r.state} tone={EVIDENCE_STATE_TONE[r.state]} label={EVIDENCE_STATE_LABEL[r.state]} />
                  {r.authority === 'contractor' && <div className={tableStyles.meta}>Decided in Contractor assurance</div>}
                  {r.state === 'SUPERSEDED' && r.superseded_by_evidence_id && (
                    <div className={tableStyles.meta}><Link href={`/assurance/evidence/${r.superseded_by_evidence_id}`} className={tableStyles.link}>See current evidence</Link></div>
                  )}
                  {r.replaces_evidence_id && (
                    <div className={tableStyles.meta}><Link href={`/assurance/evidence/${r.replaces_evidence_id}`} className={tableStyles.link}>Replaces earlier evidence</Link></div>
                  )}
                </td>
                <td style={{ ...td, fontSize: 12 }}>
                  {r.contractor?.effective_from || r.contractor?.expires_on ? (
                    <>
                      {r.contractor.effective_from && <div>From <DateCell value={r.contractor.effective_from} /></div>}
                      {r.contractor.expires_on && <div>Expires <DateCell value={r.contractor.expires_on} /></div>}
                    </>
                  ) : <Dim>—</Dim>}
                </td>
              </Row>
            ))}
          </DataTable>
        </>
      )}
    </div>
  );
}
