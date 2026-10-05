import { listAssuranceTemplates, type TemplateStatus } from '@/lib/assurance/templateLifecycle';
import { viewerCan } from '@/lib/assurance/authorize';
import { TEMPLATE_KINDS, TEMPLATE_VERSION_STATUSES, assuranceLabel, isOneOf, type TemplateKind } from '@/lib/assurance/domain';
import { firstParam } from '@/lib/assurance/input';
import { resolvePageViewer } from '../_components/pageAccess';
import {
  Badge, DataTable, DateCell, Dim, EmptyState, FilterBar, Notice, PageHeader, RecordLink, Row, Section, td, assuranceStyles as styles,
} from '../_components/ui';
import TemplateEditor from '../_components/TemplateEditor';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

const KIND_LABEL: Record<TemplateKind, string> = { inspection: 'Inspection', audit: 'Audit' };

// Assurance → Templates: Inspection checklists and Audit criteria, each with
// numbered versions (DRAFT → PUBLISHED → RETIRED). Records always keep the
// exact version they were created from.
export default async function TemplatesPage({ searchParams }: { searchParams: SP }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const sp = await searchParams;
  const rawKind = firstParam(sp.kind);
  const rawStatus = firstParam(sp.status);
  const kind: TemplateKind | null = isOneOf(TEMPLATE_KINDS, rawKind) ? rawKind : null;
  const status: TemplateStatus | null = isOneOf(TEMPLATE_VERSION_STATUSES, rawStatus) ? rawStatus : null;
  const [all, rows] = await Promise.all([
    kind || status ? listAssuranceTemplates(viewer) : null,
    listAssuranceTemplates(viewer, { kind, status }),
  ]);
  const total = (all ?? rows).length;
  const canAdminister = viewerCan(viewer, 'administer');

  return (
    <div style={{ maxWidth: 1180 }}>
      <PageHeader help="templates"
        title="Templates"
        subtitle="Inspection checklists and audit criteria. Each change is drafted, then published as a new version; inspections and audits always keep the version they were created from."
      />
      {total === 0 ? (
        <EmptyState title="No Assurance templates have been created."
          body={canAdminister ? 'Create a draft below, then publish it to make it available when planning inspections or audits.' : 'An organisation admin can create and publish templates.'} />
      ) : (
        <>
          <FilterBar
            resetHref="/assurance/templates"
            count={`${rows.length} template${rows.length === 1 ? '' : 's'}`}
            fields={[
              { kind: 'select', name: 'kind', label: 'Inspections and audits', value: kind ?? undefined, options: TEMPLATE_KINDS.map(k => ({ value: k, label: `${KIND_LABEL[k]} templates` })) },
              { kind: 'select', name: 'status', label: 'Any status', value: status ?? undefined, options: TEMPLATE_VERSION_STATUSES.map(s => ({ value: s, label: assuranceLabel(s) })) },
            ]}
          />
          <DataTable headers={['Template', 'For', 'Type', 'Status', 'Current version', 'Draft', 'Used by', 'Updated']} minWidth={900}
            empty={rows.length === 0 ? 'No templates match these filters.' : undefined}>
            {rows.map(t => (
              <Row key={`${t.kind}-${t.id}`}>
                <td style={{ ...td, maxWidth: 320 }}><RecordLink href={`/assurance/templates/${t.kind}/${t.id}`} reference={t.template_reference} title={t.name} /></td>
                <td style={td}>{KIND_LABEL[t.kind]}</td>
                <td style={td}>{assuranceLabel(t.template_type)}</td>
                <td style={td}><Badge value={t.status} /></td>
                <td style={td}>{t.published_version_number ? `v${t.published_version_number} · ${t.published_item_count ?? 0} ${t.kind === 'audit' ? 'criteria' : 'items'}` : <Dim>—</Dim>}</td>
                <td style={td}>{t.draft_version_number ? `v${t.draft_version_number}` : <Dim>—</Dim>}</td>
                <td style={td}>{t.record_count} {t.kind === 'audit' ? 'audit' : 'inspection'}{t.record_count === 1 ? '' : 's'}</td>
                <td style={td}><DateCell value={t.updated_at} /></td>
              </Row>
            ))}
          </DataTable>
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <Section title="New template">
          {!canAdminister && <Notice>Only organisation admins can create, publish or retire templates.</Notice>}
          {canAdminister && (
            <details className={styles.details}>
              <summary>Open the template builder</summary>
              <div className={styles.disclosure} style={{ maxWidth: 'none', marginTop: 0 }}>
                <TemplateEditor mode="create" initialKind={kind ?? 'inspection'} />
              </div>
            </details>
          )}
        </Section>
      </div>
    </div>
  );
}
