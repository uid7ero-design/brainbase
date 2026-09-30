import { notFound } from 'next/navigation';
import { getAuditTemplateDetail } from '@/lib/assurance/auditTemplates';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel, formatAssuranceDate, formatAssuranceDateTime } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../../_components/pageAccess';
import ActionPanel from '../../../_components/ActionPanel';
import ChecklistBuilder from '../../../_components/ChecklistBuilder';
import { Badge, Breadcrumbs, Card, Dim, HistoryList, KeyValues, Notice, PageHeader, Section, assuranceStyles as styles } from '../../../_components/ui';

export const dynamic = 'force-dynamic';

export default async function AuditTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getAuditTemplateDetail(viewer, id);
  if (!detail) notFound();
  const t = detail.template;
  const latest = detail.versions[0];
  const canAdminister = viewerCan(viewer, 'administer');

  return (
    <div style={{ maxWidth: 1000 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/audits', label: 'Audits' }, { href: '/assurance/audits/templates', label: 'Templates' }, { label: t.template_reference }]} />
      <PageHeader help="audit-templates"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{t.template_reference}</span>
          <Badge value={t.is_active ? 'ACTIVE' : 'INACTIVE'} tone={t.is_active ? 'success' : 'neutral'} label={t.is_active ? 'Active' : 'Inactive'} />
        </span>}
        title={t.name}
        subtitle={`${assuranceLabel(t.audit_type)} audit template · ${detail.versions.length} version${detail.versions.length === 1 ? '' : 's'}${t.description ? ` · ${t.description}` : ''}`}
        actions={canAdminister ? (
          <ActionPanel label={t.is_active ? 'Deactivate' : 'Reactivate'} endpoint={`/api/assurance/audit-templates/${t.id}/active`}
            extraBody={{ active: !t.is_active }} variant={t.is_active ? 'danger' : 'secondary'}
            submitLabel={t.is_active ? 'Deactivate template' : 'Reactivate template'}
            confirm={t.is_active
              ? 'Deactivated templates are no longer offered when planning new audits. Existing audits and every published version are unchanged. You can reactivate it later.'
              : 'The template’s current version will be offered again when planning new audits. Published versions are unchanged.'} />
        ) : undefined}
      />

      <div style={{ marginBottom: 18 }}>
        <Notice>Published versions are immutable. Audits always keep the version they were planned with; a new version only affects audits planned afterwards.</Notice>
      </div>

      {detail.versions.map(v => (
        <Section key={v.id} title={`Version ${v.version_number}${v === latest ? ' (current)' : ''}`} id={`v${v.version_number}`}>
          <Card>
            <KeyValues items={[
              { label: 'Title', value: v.title },
              { label: 'Standard / reference', value: v.standard_reference },
              { label: 'Effective from', value: v.effective_from ? formatAssuranceDate(v.effective_from) : null },
              { label: 'Published', value: `${formatAssuranceDateTime(v.created_at)}${v.created_by_name ? ` by ${v.created_by_name}` : ''}` },
              { label: 'Used by', value: `${v.audit_count} audit${v.audit_count === 1 ? '' : 's'}` },
            ]} />
            {v.instructions && <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '12px 0 0' }}>{v.instructions}</p>}
            {v.invalid_criteria_count > 0 && <p style={{ fontSize: 12, color: 'var(--status-warning)' }}>{v.invalid_criteria_count} unreadable criteria not shown.</p>}
            <div style={{ marginTop: 12 }}>
              {v.criteria.length === 0 ? <Dim>No criteria.</Dim> : (
                <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
                  {v.criteria.map(c => (
                    <li key={c.key} style={{ fontSize: 13 }}>
                      <span style={{ color: 'var(--text-primary)' }}>{c.label}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {assuranceLabel(c.responseType)}{c.required ? '' : ' · optional'}{c.options.length ? ` · ${c.options.join(' / ')}` : ''}</span>
                      {c.guidance && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.guidance}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </Section>
      ))}

      {canAdminister && latest && (
        <Section title="Edit (publishes a new version)">
          <details className={styles.details}>
            <summary>Start version {latest.version_number + 1} from version {latest.version_number}</summary>
            <div className={styles.disclosure} style={{ maxWidth: 'none', marginTop: 0 }}>
              <ChecklistBuilder
                variant="audit"
                mode="version"
                templateId={t.id}
                defaultTitle={latest.title}
                defaultStandard={latest.standard_reference ?? ''}
                initialItems={latest.criteria.map(c => ({ label: c.label, responseType: c.responseType, guidance: c.guidance ?? '', required: c.required, options: c.options.join(', ') }))}
              />
            </div>
          </details>
        </Section>
      )}

      <Section title="History">
        <Card><HistoryList entries={detail.history} /></Card>
      </Section>
    </div>
  );
}
