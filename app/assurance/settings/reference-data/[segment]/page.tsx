import { notFound } from 'next/navigation';
import { viewerCan } from '@/lib/assurance/authorize';
import { referenceActor } from '@/lib/assurance/referenceData';
import { assuranceLabel, formatAssuranceDateTime } from '@/lib/assurance/domain';
import { listReferenceHistory, listReferenceRecords } from '@/lib/referenceData/service';
import { referenceConfigForSegment } from '@/lib/referenceData/rules';
import { resolvePageViewer } from '../../../_components/pageAccess';
import { Breadcrumbs, Dim, Notice, PageHeader, Section, assuranceStyles as styles } from '../../../_components/ui';
import ReferenceDataManager from '../../../_components/ReferenceDataManager';

export const dynamic = 'force-dynamic';

export default async function ReferenceDataKindPage({ params }: { params: Promise<{ segment: string }> }) {
  const { segment } = await params;
  const cfg = referenceConfigForSegment(segment);
  if (!cfg) notFound();
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const canAdminister = viewerCan(viewer, 'administer');
  const actor = referenceActor(viewer);
  const [rows, history] = await Promise.all([listReferenceRecords(actor, cfg.kind), listReferenceHistory(actor, cfg.kind)]);

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[
        { href: '/assurance', label: 'Assurance' }, { href: '/assurance/settings', label: 'Settings' },
        { href: '/assurance/settings/reference-data', label: 'Reference data' }, { label: cfg.plural },
      ]} />
      <PageHeader help="reference-data"
        title={cfg.plural}
        subtitle={`${cfg.purpose} Used on ${cfg.usedOn}. Shared with the rest of BrainBase; nothing is deleted.`}
      />
      {!canAdminister && <div style={{ marginBottom: 16 }}><Notice>Only organisation admins can change {cfg.plural.toLowerCase()}.</Notice></div>}
      <ReferenceDataManager kind={cfg.kind} canAdminister={canAdminister} rows={rows.map(r => ({
        id: r.id, reference: r.reference, name: r.name, type: r.type, status: r.status, fields: r.fields, revision: r.revision, usage_count: r.usage_count,
      }))} />
      <div style={{ marginTop: 24 }}>
        <Section title="Change history" count={history.length}>
          {history.length === 0 ? <Dim>No changes have been recorded yet.</Dim> : (
            <ol className={styles.history}>
              {history.map(h => (
                <li key={h.id}>
                  <span className={styles.historyWhen}>{formatAssuranceDateTime(h.created_at)}</span>
                  <span className={styles.historyWhat}>
                    {assuranceLabel((h.action.split('.')[1] ?? h.action).toUpperCase())}{h.reference ? ` · ${h.reference}` : ''}{h.name ? ` · ${h.name}` : ''}
                  </span>
                  <span className={styles.historyWho}>{h.user_name ?? 'System'}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  );
}
