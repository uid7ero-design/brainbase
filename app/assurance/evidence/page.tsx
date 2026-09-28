import { listEvidence } from '@/lib/assurance/evidence';
import { viewerCan } from '@/lib/assurance/authorize';
import { EVIDENCE_TYPES, assuranceLabel } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import ActionPanel from '../_components/ActionPanel';
import { evidenceFields } from '../_components/shared';
import { DataTable, DateCell, Dim, FilterBar, PageHeader, RecordLink, RefChip, Row, enumOptions, td } from '../_components/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

const HREF = {
  incident: '/assurance/incidents', investigation: '/assurance/investigations', inspection: '/assurance/inspections',
  finding: '/assurance/findings', action: '/assurance/actions', verification: '/assurance/actions',
} as const;

export default async function EvidencePage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const f = { q: firstParam(sp.q), evidenceType: firstParam(sp.type), linked: firstParam(sp.linked) as 'linked' | 'unlinked' | undefined };
  const rows = await listEvidence(viewer, f);
  const filtered = Object.values(f).some(Boolean);

  return (
    <div style={{ maxWidth: 1240 }}>
      <PageHeader
        title="Evidence"
        subtitle="Proof, recorded once and reused. Links to incidents, findings, actions and verifications are kept as history — removing a link never deletes the evidence."
        actions={viewerCan(viewer, 'record') ? (
          <ActionPanel label="Record evidence" variant="primary" endpoint="/api/assurance/evidence" redirectTo="/assurance/evidence/{id}"
            description="Record evidence now and link it to records from its detail page." fields={evidenceFields().filter(x => x.kind !== 'text' || x.name !== 'purpose')} submitLabel="Record evidence" />
        ) : undefined}
      />
      <FilterBar
        resetHref="/assurance/evidence"
        fields={[
          { kind: 'search', name: 'q', placeholder: 'Search reference or title', value: f.q },
          { kind: 'select', name: 'type', label: 'Any type', value: f.evidenceType, options: enumOptions(EVIDENCE_TYPES) },
          { kind: 'select', name: 'linked', label: 'Linked & unlinked', value: f.linked, options: [{ value: 'linked', label: 'Currently linked' }, { value: 'unlinked', label: 'Not linked' }] },
        ]}
      />
      <DataTable headers={['Evidence', 'Type', 'Captured', 'Captured by', 'Linked to', 'Link history']} minWidth={920}
        empty={rows.length === 0 ? (filtered ? 'No evidence matches these filters.' : 'No evidence has been recorded yet.') : undefined}>
        {rows.map((r, i) => (
          <Row key={r.id} last={i === rows.length - 1}>
            <td style={{ ...td, maxWidth: 300 }}><RecordLink href={`/assurance/evidence/${r.id}`} reference={r.evidence_reference} title={r.title} /></td>
            <td style={td}>{assuranceLabel(r.evidence_type)}</td>
            <td style={td}><DateCell value={r.captured_at} /></td>
            <td style={td}>{r.captured_by_name ?? <Dim>—</Dim>}</td>
            <td style={td}>{r.links.length === 0 ? <Dim>Not linked</Dim> : r.links.map(l => <RefChip key={`${l.kind}-${l.id}-${l.reference}`} href={`${HREF[l.kind]}/${l.id}`} reference={l.reference} kind={l.kind} />)}</td>
            <td style={{ ...td, fontSize: 12 }}>{r.active_link_count} active{r.removed_link_count > 0 ? ` · ${r.removed_link_count} removed` : ''}</td>
          </Row>
        ))}
      </DataTable>
    </div>
  );
}
