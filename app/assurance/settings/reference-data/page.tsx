import Link from 'next/link';
import { viewerCan } from '@/lib/assurance/authorize';
import { summariseReferenceData } from '@/lib/referenceData/service';
import { REFERENCE_CONFIG } from '@/lib/referenceData/rules';
import { resolvePageViewer } from '../../_components/pageAccess';
import { Breadcrumbs, Notice, PageHeader, assuranceStyles as styles } from '../../_components/ui';

export const dynamic = 'force-dynamic';

// Shared BrainBase reference data used by Assurance. Assurance does not own
// copies of these records; this is where an organisation manages them.
export default async function ReferenceDataSettingsPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const canAdminister = viewerCan(viewer, 'administer');
  const summary = await summariseReferenceData(viewer.organisationId);

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/settings', label: 'Settings' }, { label: 'Reference data' }]} />
      <PageHeader help="reference-data"
        title="Reference data"
        subtitle="Shared BrainBase records that Assurance records can reference. They belong to your organisation, not to Assurance, and are never deleted: deactivate a record to stop offering it for new records."
      />
      {!canAdminister && <div style={{ marginBottom: 16 }}><Notice>Only organisation admins can change reference data.</Notice></div>}
      <div className={styles.settingsCards}>
        {summary.map(s => {
          const cfg = REFERENCE_CONFIG[s.kind];
          return (
            <Link key={s.kind} href={`/assurance/settings/reference-data/${cfg.segment}`} className={styles.settingsCard}>
              <span className={styles.settingsCardTitle}>{cfg.plural}</span>
              <p className={styles.settingsCardBody}>
                {s.total === 0 ? cfg.emptyMessage : `${s.active} active${s.total > s.active ? `, ${s.total - s.active} inactive` : ''}.`}
              </p>
              <p className={styles.settingsCardBody}>{cfg.purpose}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
