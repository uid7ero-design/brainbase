import { getSession } from '@/lib/session';
import { redirect, notFound } from 'next/navigation';
import sql from '@/lib/db';
import ReportView from './ReportView';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const rows = await sql`
    SELECT
      r.*,
      u.name  AS created_by_name,
      o.name  AS organisation_name,
      uf.file_name AS source_file_name
    FROM reports r
    JOIN users         u  ON u.id  = r.created_by
    JOIN organisations o  ON o.id  = r.organisation_id
    LEFT JOIN uploaded_files uf ON uf.id = r.source_file_id
    WHERE r.id = ${id}
      AND r.organisation_id = ${session.organisationId}
    LIMIT 1
  `;

  if (rows.length === 0) notFound();

  const r = rows[0];
  const canDelete = ['admin', 'super_admin'].includes(session.role);

  return (
    <ReportView
      id={String(r.id)}
      title={String(r.report_title)}
      reportType={String(r.report_type)}
      content={String(r.report_content)}
      createdByName={String(r.created_by_name)}
      organisationName={String(r.organisation_name)}
      sourceFileName={r.source_file_name ? String(r.source_file_name) : null}
      createdAt={String(r.created_at)}
      canDelete={canDelete}
    />
  );
}
