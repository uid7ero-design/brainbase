import { listAuditTemplates } from '@/lib/assurance/auditTemplates';
import { viewerCan } from '@/lib/assurance/authorize';
import { assuranceLabel } from '@/lib/assurance/domain';
import { resolvePageViewer } from '../../_components/pageAccess';
import ChecklistBuilder from '../../_components/ChecklistBuilder';
import { Badge, Breadcrumbs, DataTable, DateCell, Dim, Notice, PageHeader, RecordLink, Row, Section, td } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export default async function AuditTemplatesPage() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const templates = await listAuditTemplates(viewer);
  const canAdminister = viewerCan(viewer, 'administer');

  return (
    <div style={{ maxWidth: 1100 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/audits', label: 'Audits' }, { label: 'Templates' }]} />
      <PageHeader
        title="Audit templates"
        subtitle="A template is a stable identity; its criteria live in numbered versions. Editing always publishes a new version — audits keep the version they used."
      />
      <DataTable headers={['Template', 'Type', 'Current version', 'Standard', 'Versions', 'Audits', 'Status', 'Updated']} minWidth={960}
        empty={templates.length === 0 ? 'No audit templates yet.' : undefined}>
        {templates.map((t, i) => (
          <Row key={t.id} last={i === templates.length - 1}>
            <td style={{ ...td, maxWidth: 300 }}><RecordLink href={`/assurance/audits/templates/${t.id}`} reference={t.template_reference} title={t.name} /></td>
            <td style={td}>{assuranceLabel(t.audit_type)}</td>
            <td style={td}>{t.latest_version_number ? `v${t.latest_version_number} · ${t.latest_criteria_count ?? 0} criteria` : <Dim>—</Dim>}</td>
            <td style={td}>{t.latest_standard_reference ?? <Dim>—</Dim>}</td>
            <td style={td}>{t.version_count}</td>
            <td style={td}>{t.audit_count}</td>
            <td style={td}><Badge value={t.is_active ? 'ACTIVE' : 'INACTIVE'} tone={t.is_active ? 'success' : 'neutral'} label={t.is_active ? 'Active' : 'Inactive'} /></td>
            <td style={td}><DateCell value={t.updated_at} /></td>
          </Row>
        ))}
      </DataTable>

      <div style={{ marginTop: 24 }}>
        <Section title="New template">
          {!canAdminister && <Notice>Only organisation admins can create or version audit templates.</Notice>}
          {canAdminister && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>Open the criteria builder</summary>
              <div style={{ marginTop: 12, padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-surface)' }}>
                <ChecklistBuilder variant="audit" mode="template" />
              </div>
            </details>
          )}
        </Section>
      </div>
    </div>
  );
}
