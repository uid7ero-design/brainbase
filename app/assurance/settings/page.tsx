import Link from 'next/link';
import { viewerCan } from '@/lib/assurance/authorize';
import { listRiskLevelsForAdmin } from '@/lib/assurance/riskLevels';
import { resolvePageViewer } from '../_components/pageAccess';
import { Breadcrumbs, PageHeader, assuranceStyles as styles } from '../_components/ui';

export const dynamic = 'force-dynamic';

// Assurance configuration home. Only areas that exist are listed; every
// settings page re-checks access itself and the API enforces 'administer'.
export default async function AssuranceSettingsPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const levels = await listRiskLevelsForAdmin(viewer);
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
      </div>
    </div>
  );
}
