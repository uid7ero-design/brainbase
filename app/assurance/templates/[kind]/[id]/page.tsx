import { notFound } from 'next/navigation';
import { getAssuranceTemplate, type TemplateVersionView } from '@/lib/assurance/templateLifecycle';
import { viewerCan } from '@/lib/assurance/authorize';
import { getAssuranceTimeZone } from '@/lib/assurance/deadlines';
import { TEMPLATE_KINDS, assuranceLabel, formatAssuranceDateTime, groupTemplateSections, isOneOf, type TemplateKind } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../../_components/pageAccess';
import ActionPanel from '../../../_components/ActionPanel';
import { Badge, Breadcrumbs, Card, Dim, HistoryList, Notice, PageHeader, Section, assuranceStyles as styles } from '../../../_components/ui';
import TemplateEditor from '../../../_components/TemplateEditor';

export const dynamic = 'force-dynamic';

const NOUN: Record<TemplateKind, { record: string; records: string; item: string; items: string }> = {
  inspection: { record: 'inspection', records: 'inspections', item: 'item', items: 'items' },
  audit: { record: 'audit', records: 'audits', item: 'criterion', items: 'criteria' },
};

/** Read-only rendering of one version's exact stored wording, in section order. */
function VersionContent({ version, kind }: { version: TemplateVersionView; kind: TemplateKind }) {
  const groups = groupTemplateSections(version.items);
  let n = 0;
  return (
    <>
      {version.standard_reference && <p style={{ fontSize: 13, margin: '0 0 8px' }}>Standard / reference: {version.standard_reference}</p>}
      {version.instructions && <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px' }}>{version.instructions}</p>}
      {version.invalid_item_count > 0 && <p style={{ fontSize: 12, color: 'var(--status-warning)' }}>{version.invalid_item_count} unreadable {NOUN[kind].item}(s) not shown.</p>}
      {version.items.length === 0 ? <Dim>No {NOUN[kind].items} yet.</Dim> : groups.map((g, gi) => (
        <div key={gi} style={{ marginTop: gi === 0 ? 0 : 12 }}>
          {g.title && <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px' }}>{g.title}</h3>}
          <ol start={n + 1} style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 6 }}>
            {g.items.map(it => {
              n += 1;
              return (
                <li key={it.key} style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
                  <span style={{ color: 'var(--text-primary)' }}>{it.label}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {assuranceLabel(it.responseType)}{it.required ? '' : ' · optional'}{it.options.length ? ` · ${it.options.join(' / ')}` : ''}</span>
                  {it.guidance && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.guidance}</div>}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </>
  );
}

function VersionMeta({ v, kind, tz }: { v: TemplateVersionView; kind: TemplateKind; tz: string }) {
  const parts = [v.title];
  if (v.published_at) parts.push(`published ${formatAssuranceDateTime(v.published_at, tz)}${v.published_by_name ? ` by ${v.published_by_name}` : ''}`);
  if (v.retired_at) parts.push(`retired ${formatAssuranceDateTime(v.retired_at, tz)}${v.retired_by_name ? ` by ${v.retired_by_name}` : ''}`);
  if (v.status === 'DRAFT') parts.push(`last saved ${formatAssuranceDateTime(v.updated_at, tz)}${v.updated_by_name ? ` by ${v.updated_by_name}` : ''}`);
  parts.push(`used by ${v.record_count} ${v.record_count === 1 ? NOUN[kind].record : NOUN[kind].records}`);
  return <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, overflowWrap: 'anywhere' }}>{parts.join(' · ')}</div>;
}

export default async function TemplateDetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { kind: rawKind, id } = await params;
  if (!isOneOf(TEMPLATE_KINDS, rawKind)) notFound();
  const kind: TemplateKind = rawKind;
  const [detail, tz] = await Promise.all([getAssuranceTemplate(viewer, kind, id), getAssuranceTimeZone(viewer.organisationId)]);
  if (!detail) notFound();
  const t = detail.template;
  const { draft, published } = detail;
  const released = detail.versions.filter(v => v.status !== 'DRAFT');
  const canAdminister = viewerCan(viewer, 'administer');
  const noun = NOUN[kind];

  const actions = canAdminister ? (
    <span className={styles.row} style={{ gap: 8 }}>
      {!draft && released.length > 0 && (
        <ActionPanel label="Create new version" endpoint={`/api/assurance/templates/${t.id}/versions`} extraBody={{ kind }} variant="primary" />
      )}
      {t.status === 'PUBLISHED' && published && (
        <ActionPanel label="Retire" endpoint={`/api/assurance/templates/${t.id}/retire`} extraBody={{ kind }} variant="danger"
          submitLabel="Retire template"
          confirm={`Version ${published.version_number} will no longer be offered when planning new ${noun.records}. ${noun.records.charAt(0).toUpperCase() + noun.records.slice(1)} already using it keep it exactly as it is. Retiring cannot be undone, but you can publish a new version later.`} />
      )}
    </span>
  ) : undefined;

  return (
    <div style={{ maxWidth: 1000 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/templates', label: 'Templates' }, { label: t.template_reference }]} />
      <PageHeader help="template"
        eyebrow={<span className={styles.eyebrowRow}>
          <span className={styles.refEyebrow}>{t.template_reference}</span>
          <Badge value={t.status} />
        </span>}
        title={t.name}
        subtitle={`${kind === 'audit' ? 'Audit' : 'Inspection'} template · ${assuranceLabel(t.template_type)} · ${released.length} published version${released.length === 1 ? '' : 's'}${t.description ? ` · ${t.description}` : ''}`}
        actions={actions}
      />

      <div style={{ marginBottom: 18 }}>
        <Notice>
          Published versions never change. Each {noun.record} keeps the exact version it was created from; publishing a new version only affects {noun.records} planned afterwards.
          {t.status === 'DRAFT' ? ` This template is not available for new ${noun.records} until version 1 is published.` : ''}
          {t.status === 'RETIRED' ? ` This template is retired and is not offered for new ${noun.records}.` : ''}
        </Notice>
      </div>

      {draft && (
        <Section title={`Draft — version ${draft.version_number}`} id={`v${draft.version_number}`}>
          <Card>
            <VersionMeta v={draft} kind={kind} tz={tz} />
            {canAdminister ? (
              <TemplateEditor
                key={`${draft.id}-${draft.lock_version}`}
                mode="draft"
                kind={kind}
                templateId={t.id}
                versionId={draft.id}
                versionNumber={draft.version_number}
                lockVersion={draft.lock_version}
                identity={detail.identityEditable ? { name: t.name, templateType: t.template_type, description: t.description ?? '' } : null}
                title={draft.title}
                instructions={draft.instructions}
                standardReference={draft.standard_reference}
                items={draft.items}
                replacesVersionNumber={published?.version_number ?? null}
              />
            ) : <VersionContent version={draft} kind={kind} />}
          </Card>
        </Section>
      )}

      {published && (
        <Section title={`Current version — version ${published.version_number}`} id={`v${published.version_number}`}>
          <Card>
            <VersionMeta v={published} kind={kind} tz={tz} />
            <VersionContent version={published} kind={kind} />
          </Card>
        </Section>
      )}

      {released.filter(v => v.status === 'RETIRED').length > 0 && (
        <Section title="Earlier versions" count={released.filter(v => v.status === 'RETIRED').length}>
          {released.filter(v => v.status === 'RETIRED').map(v => (
            <details key={v.id} className={styles.details} id={`v${v.version_number}`} style={{ marginBottom: 8 }}>
              <summary>Version {v.version_number} · <Badge value={v.status} /></summary>
              <Card>
                <VersionMeta v={v} kind={kind} tz={tz} />
                <VersionContent version={v} kind={kind} />
              </Card>
            </details>
          ))}
        </Section>
      )}

      <Section title="History">
        <Card><HistoryList entries={detail.history} /></Card>
      </Section>
    </div>
  );
}
