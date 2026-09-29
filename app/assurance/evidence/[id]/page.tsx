import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEvidenceDetail, listEvidenceLinkTargetOptions, type EvidenceLinkTargetOptions } from '@/lib/assurance/evidence';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel, formatAssuranceDateTime } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ActionPanel from '../../_components/ActionPanel';
import EvidenceLinkPanel from './EvidenceLinkPanel';
import { Badge, Breadcrumbs, Card, DataTable, DateCell, Dim, HistoryList, KeyValues, PageHeader, Prose, Row, Section, td, assuranceStyles as styles, tableStyles } from '../../_components/ui';

export const dynamic = 'force-dynamic';

const HREF = {
  incident: '/assurance/incidents', investigation: '/assurance/investigations', inspection: '/assurance/inspections', audit: '/assurance/audits',
  finding: '/assurance/findings', action: '/assurance/actions', verification: '/assurance/actions',
} as const;

export default async function EvidenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getEvidenceDetail(viewer, id);
  if (!detail) notFound();
  const e = detail.evidence;
  const canRecord = viewerCan(viewer, 'record');
  const heldAt = typeof e.metadata?.held_at === 'string' ? e.metadata.held_at : null;
  const active = detail.links.filter(l => !l.removed_at);
  // Offer every supported target type, minus records this evidence is already actively linked to.
  const linkTargets: EvidenceLinkTargetOptions | null = canRecord ? await listEvidenceLinkTargetOptions(viewer) : null;
  if (linkTargets) {
    for (const k of Object.keys(linkTargets) as (keyof EvidenceLinkTargetOptions)[]) {
      const linked = new Set(active.filter(l => l.kind === k).map(l => l.target_id));
      linkTargets[k] = linkTargets[k].filter(o => !linked.has(o.id));
    }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/evidence', label: 'Evidence' }, { label: e.evidence_reference }]} />
      <PageHeader
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{e.evidence_reference}</span>
          <Badge value={e.evidence_type} tone="neutral" />
        </span>}
        title={e.title ?? assuranceLabel(e.evidence_type)}
        subtitle={e.captured_at ? `Captured ${formatAssuranceDateTime(e.captured_at)}${e.captured_by_name ? ` by ${e.captured_by_name}` : ''}` : undefined}
      />

      <Section title="Overview">
        <Card>
          <KeyValues items={[
            { label: 'Type', value: assuranceLabel(e.evidence_type) },
            { label: 'Original held at', value: heldAt },
            { label: 'Location', value: e.location_name },
            { label: 'Recorded by', value: e.created_by_name },
            { label: 'Recorded', value: formatAssuranceDateTime(e.created_at) },
          ]} />
          {e.description && <div style={{ marginTop: 14 }}><Prose>{e.description}</Prose></div>}
        </Card>
      </Section>

      <Section title="Links" count={active.length}>
        <div style={{ display: 'grid', gap: 10 }}>
          {detail.links.length === 0 ? <Card><Dim>This evidence is not linked to anything.</Dim></Card> : (
            <DataTable headers={['Record', 'Kind', 'Purpose', 'Linked', 'State']} minWidth={720}>
              {detail.links.map((l, i) => (
                <Row key={`${l.kind}-${l.link_id}`} last={i === detail.links.length - 1}>
                  <td style={td}><Link href={`${HREF[l.kind]}/${l.target_id}`} className={styles.refChip}>{l.reference}</Link></td>
                  <td style={td}>{assuranceLabel(l.kind.toUpperCase())}</td>
                  <td style={td}>{l.purpose ?? <Dim>—</Dim>}</td>
                  <td style={td}><DateCell value={l.linked_at} /><div className={tableStyles.meta}>{l.linked_by_name ?? ''}</div></td>
                  <td style={td}>
                    {l.removed_at ? (
                      <span style={{ fontSize: 12 }}>
                        <Badge value="REMOVED" tone="neutral" label="Removed" />
                        <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{formatAssuranceDateTime(l.removed_at)}{l.removed_by_name ? ` · ${l.removed_by_name}` : ''}</div>
                        <div style={{ fontStyle: 'italic' }}>{l.removal_reason}</div>
                      </span>
                    ) : canRecord && l.kind !== 'verification' ? (
                      <ActionPanel label="Remove link" variant="danger" endpoint="/api/assurance/evidence/unlink" extraBody={{ target: l.kind, linkId: l.link_id }}
                        fields={[{ kind: 'text', name: 'reason', label: 'Reason for removal', required: true, maxLength: 1000 }]} submitLabel="Remove link"
                        description="The link is kept as history with your reason." />
                    ) : <Badge value="ACTIVE" tone="success" label="Active" />}
                  </td>
                </Row>
              ))}
            </DataTable>
          )}
          {linkTargets && <EvidenceLinkPanel evidenceId={e.id} options={linkTargets} />}
        </div>
      </Section>

      <Section title="History">
        <Card><HistoryList entries={detail.history} /></Card>
      </Section>
    </div>
  );
}
