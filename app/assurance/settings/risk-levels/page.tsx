import { viewerCan } from '@/lib/assurance/authorize';
import { listRiskLevelHistory, listRiskLevelsForAdmin } from '@/lib/assurance/riskLevels';
import { assuranceLabel, formatAssuranceDateTime } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import { Breadcrumbs, Dim, Notice, PageHeader, Section, assuranceStyles as styles } from '../../_components/ui';
import RiskLevelsManager from '../../_components/RiskLevelsManager';

export const dynamic = 'force-dynamic';

export default async function RiskLevelsSettingsPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const canAdminister = viewerCan(viewer, 'administer');
  const [levels, history] = await Promise.all([listRiskLevelsForAdmin(viewer), listRiskLevelHistory(viewer)]);

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/settings', label: 'Settings' }, { label: 'Risk levels' }]} />
      <PageHeader help="risk-levels"
        title="Risk levels"
        subtitle="Your organisation’s severity scale for incidents, investigations and findings. Levels are never deleted: deactivate a level to stop offering it for new records."
      />
      {!canAdminister && <div style={{ marginBottom: 16 }}><Notice>Only organisation admins can change risk levels.</Notice></div>}
      <RiskLevelsManager canAdminister={canAdminister} levels={levels.map(l => ({
        id: l.id, code: l.code, name: l.name, description: l.description, rank: l.rank, is_active: l.is_active,
        requires_verification: l.requires_verification, serious: l.serious, revision: l.revision, usage_count: l.usage_count,
      }))} />
      <div style={{ marginTop: 24 }}>
        <Section title="Change history" count={history.length}>
          {history.length === 0 ? <Dim>No risk-level changes have been recorded yet.</Dim> : (
            <ol className={styles.history}>
              {history.map(h => (
                <li key={h.id}>
                  <span className={styles.historyWhen}>{formatAssuranceDateTime(h.created_at)}</span>
                  <span className={styles.historyWhat}>{assuranceLabel((h.action.split('.')[1] ?? h.action).toUpperCase())}{h.code ? ` · ${h.code}` : ''}</span>
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
