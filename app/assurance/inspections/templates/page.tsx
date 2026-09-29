import { listTemplates } from '@/lib/assurance/templates';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import { Badge, Breadcrumbs, DataTable, DateCell, Dim, Notice, PageHeader, RecordLink, Row, Section, td } from '../../_components/ui';
import ChecklistBuilder from '../../_components/ChecklistBuilder';

export const dynamic = 'force-dynamic';

export default async function InspectionTemplatesPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const templates = await listTemplates(viewer);
  const canAdminister = viewerCan(viewer, 'administer');

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/inspections', label: 'Inspections' }, { label: 'Templates' }]} />
      <PageHeader
        title="Inspection templates"
        subtitle="Every change to a checklist is published as a new version. Existing versions — and every inspection run against them — never change."
      />
      <DataTable headers={['Template', 'Type', 'Current version', 'Versions', 'Inspections', 'Status', 'Updated']} minWidth={860}
        empty={templates.length === 0 ? 'No inspection templates yet.' : undefined}>
        {templates.map((t, i) => (
          <Row key={t.id} last={i === templates.length - 1}>
            <td style={{ ...td, maxWidth: 320 }}><RecordLink href={`/assurance/inspections/templates/${t.id}`} reference={t.template_reference} title={t.name} /></td>
            <td style={td}>{assuranceLabel(t.inspection_type)}</td>
            <td style={td}>{t.latest_version_number ? `v${t.latest_version_number} · ${t.latest_item_count ?? 0} items` : <Dim>—</Dim>}</td>
            <td style={td}>{t.version_count}</td>
            <td style={td}>{t.inspection_count}</td>
            <td style={td}><Badge value={t.is_active ? 'ACTIVE' : 'INACTIVE'} tone={t.is_active ? 'success' : 'neutral'} label={t.is_active ? 'Active' : 'Inactive'} /></td>
            <td style={td}><DateCell value={t.updated_at} /></td>
          </Row>
        ))}
      </DataTable>

      <div style={{ marginTop: 24 }}>
        <Section title="New template">
          {!canAdminister && <Notice>Only organisation admins can create or version inspection templates.</Notice>}
          {canAdminister && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>Open the checklist builder</summary>
              <div style={{ marginTop: 12, padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-surface)' }}>
                <ChecklistBuilder mode="template" />
              </div>
            </details>
          )}
        </Section>
      </div>
    </div>
  );
}
