import { notFound } from 'next/navigation';
import { getTemplateDetail } from '@/lib/assurance/templates';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel, formatAssuranceDateTime } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../../_components/pageAccess';
import ActionPanel from '../../../_components/ActionPanel';
import { Badge, Breadcrumbs, Card, Dim, HistoryList, Notice, PageHeader, Section, assuranceStyles as styles } from '../../../_components/ui';
import ChecklistBuilder from '../../../_components/ChecklistBuilder';

export const dynamic = 'force-dynamic';

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  const detail = await getTemplateDetail(viewer, id);
  if (!detail) notFound();
  const t = detail.template;
  const latest = detail.versions[0];
  const canAdminister = viewerCan(viewer, 'administer');

  return (
    <div style={{ maxWidth: 1000 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/inspections', label: 'Inspections' }, { href: '/assurance/inspections/templates', label: 'Templates' }, { label: t.template_reference }]} />
      <PageHeader help="inspection-templates"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{t.template_reference}</span>
          <Badge value={t.is_active ? 'ACTIVE' : 'INACTIVE'} tone={t.is_active ? 'success' : 'neutral'} label={t.is_active ? 'Active' : 'Inactive'} />
        </span>}
        title={t.name}
        subtitle={`${assuranceLabel(t.inspection_type)} · ${detail.versions.length} version${detail.versions.length === 1 ? '' : 's'}${t.description ? ` · ${t.description}` : ''}`}
        actions={canAdminister ? (
          <ActionPanel label={t.is_active ? 'Deactivate' : 'Reactivate'} endpoint={`/api/assurance/templates/${t.id}/active`}
            extraBody={{ active: !t.is_active }} variant={t.is_active ? 'danger' : 'secondary'}
            submitLabel={t.is_active ? 'Deactivate template' : 'Reactivate template'}
            confirm={t.is_active
              ? 'Deactivated templates are no longer offered when planning new inspections. Existing inspections and every published version are unchanged. You can reactivate it later.'
              : 'The template’s current version will be offered again when planning new inspections. Published versions are unchanged.'} />
        ) : undefined}
      />

      <div style={{ marginBottom: 18 }}>
        <Notice>Versions are immutable. Inspections always keep the version they were created with; publishing a new version only affects inspections planned afterwards.</Notice>
      </div>

      {detail.versions.map(v => (
        <Section key={v.id} title={`Version ${v.version_number}${v === latest ? ' (current)' : ''}`} id={`v${v.version_number}`}>
          <Card>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              {v.title} · published {formatAssuranceDateTime(v.created_at)}{v.created_by_name ? ` by ${v.created_by_name}` : ''} · used by {v.inspection_count} inspection{v.inspection_count === 1 ? '' : 's'}
            </div>
            {v.instructions && <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px' }}>{v.instructions}</p>}
            {v.invalid_item_count > 0 && <p style={{ fontSize: 12, color: 'var(--status-warning)' }}>{v.invalid_item_count} unreadable item(s) not shown.</p>}
            {v.items.length === 0 ? <Dim>No checklist items.</Dim> : (
              <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
                {v.items.map(it => (
                  <li key={it.key} style={{ fontSize: 13 }}>
                    <span style={{ color: 'var(--text-primary)' }}>{it.label}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {assuranceLabel(it.responseType)}{it.required ? '' : ' · optional'}{it.options.length ? ` · ${it.options.join(' / ')}` : ''}</span>
                    {it.guidance && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.guidance}</div>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </Section>
      ))}

      {canAdminister && latest && (
        <Section title="Publish a new version">
          <details className={styles.details}>
            <summary>Start from version {latest.version_number}</summary>
            <div className={styles.disclosure} style={{ maxWidth: 'none', marginTop: 0 }}>
              <ChecklistBuilder
                mode="version"
                templateId={t.id}
                defaultTitle={latest.title}
                initialItems={latest.items.map(it => ({ label: it.label, responseType: it.responseType, guidance: it.guidance ?? '', required: it.required, options: it.options.join(', ') }))}
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
