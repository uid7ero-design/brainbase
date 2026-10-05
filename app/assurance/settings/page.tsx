import Link from 'next/link';
import { viewerCan } from '@/lib/assurance/authorize';
import { listRiskLevelsForAdmin } from '@/lib/assurance/riskLevels';
import { summariseReferenceData } from '@/lib/referenceData/service';
import { REFERENCE_CONFIG } from '@/lib/referenceData/rules';
import { resolvePageViewer } from '../_components/pageAccess';
import { Breadcrumbs, PageHeader, assuranceStyles as styles } from '../_components/ui';

export const dynamic = 'force-dynamic';

// Assurance configuration home. Only areas that exist are listed; every
// settings page re-checks access itself and the API enforces 'administer'.
export default async function AssuranceSettingsPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const [levels, reference] = await Promise.all([listRiskLevelsForAdmin(viewer), summariseReferenceData(viewer.organisationId)]);
  const active = levels.filter(l => l.is_active);
  const serious = levels.filter(l => l.serious).map(l => l.name);
  const canAdminister = viewerCan(viewer, 'administer');

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { label: 'Settings' }]} />
      <PageHeader help="settings"
        title="Settings"
        subtitle={canAdminister
          ? 'Configuration for Assurance in your organisation. Changes are recorded in the audit history.'
          : 'Configuration for Assurance in your organisation. Only organisation admins can change it.'}
      />
      <div className={styles.settingsCards}>
        <Link href="/assurance/settings/risk-levels" className={styles.settingsCard}>
          <span className={styles.settingsCardTitle}>Risk levels</span>
          <p className={styles.settingsCardBody}>
            {levels.length === 0
              ? 'No risk levels have been configured yet.'
              : `${active.length} active${levels.length > active.length ? `, ${levels.length - active.length} inactive` : ''}. Serious: ${serious.length ? serious.join(', ') : 'none'}.`}
          </p>
          <p className={styles.settingsCardBody}>The severity scale used on incidents, investigations and findings, and by the dashboard’s serious-incident view.</p>
        </Link>
        <Link href="/assurance/settings/reference-data" className={styles.settingsCard}>
          <span className={styles.settingsCardTitle}>Reference data</span>
          <p className={styles.settingsCardBody}>
            {reference.map(r => `${REFERENCE_CONFIG[r.kind].plural}: ${r.active} active`).join(' · ')}
          </p>
          <p className={styles.settingsCardBody}>Shared BrainBase locations, assets and external organisations that Assurance records can reference.</p>
        </Link>
      </div>
    </div>
  );
}
