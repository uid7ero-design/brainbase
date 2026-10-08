import 'server-only';
import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';

/** A single scoped snapshot; managers receive no document counts or metadata. */
export async function loadEmployeeDocumentOverview(session: OrgSession, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const rows = await sql`
    SELECT p.id::text AS person_id, p.first_name, p.last_name,
      COUNT(d.id)::int AS documents,
      COUNT(d.id) FILTER (WHERE v.id IS NULL)::int AS missing_version,
      COUNT(v.id) FILTER (WHERE p.linked_user_id IS NOT NULL AND a.acknowledged_at IS NULL)::int AS pending_acknowledgement,
      COUNT(v.id) FILTER (WHERE p.linked_user_id IS NULL)::int AS unlinked_employee,
      COUNT(v.id) FILTER (WHERE verification.decision IS NULL)::int AS pending_verification,
      COUNT(v.id) FILTER (WHERE verification.decision = 'REJECTED')::int AS rejected,
      COUNT(v.id) FILTER (WHERE v.expires_at < ${today}::date)::int AS expired,
      COUNT(v.id) FILTER (WHERE v.expires_at >= ${today}::date AND v.expires_at <= ${soon}::date)::int AS expiring_soon
    FROM hr_people p
    JOIN hr_employee_documents d ON d.organisation_id = p.organisation_id AND d.person_id = p.id AND d.deleted_at IS NULL
    LEFT JOIN hr_employee_document_versions v ON v.organisation_id = d.organisation_id AND v.document_id = d.id AND v.is_current = TRUE
    LEFT JOIN LATERAL (
      SELECT acknowledgement.acknowledged_at
      FROM hr_employee_document_acknowledgements acknowledgement
      WHERE acknowledgement.organisation_id = p.organisation_id
        AND acknowledgement.document_version_id = v.id
        AND p.linked_user_id IS NOT NULL AND acknowledgement.acknowledged_by = p.linked_user_id
      ORDER BY acknowledgement.acknowledged_at DESC LIMIT 1
    ) a ON TRUE
    LEFT JOIN LATERAL (
      SELECT check_record.decision
      FROM hr_employee_document_verifications check_record
      WHERE check_record.organisation_id = p.organisation_id AND check_record.document_version_id = v.id
      ORDER BY check_record.verified_at DESC, check_record.created_at DESC, check_record.id DESC LIMIT 1
    ) verification ON TRUE
    WHERE p.organisation_id = ${session.organisationId}
      AND (${session.role === 'super_admin'} OR p.linked_user_id = ${session.userId}
        OR EXISTS (SELECT 1 FROM hr_administrators administrator
          WHERE administrator.organisation_id = p.organisation_id AND administrator.user_id = ${session.userId}))
    GROUP BY p.id, p.first_name, p.last_name
    ORDER BY p.last_name, p.first_name, p.id
  `;
  const counts = ['documents', 'missing_version', 'pending_acknowledgement', 'unlinked_employee', 'pending_verification', 'rejected', 'expired', 'expiring_soon'] as const;
  return { as_of_date: today, expiring_through: soon, people: rows.map(row => {
    const totals = Object.fromEntries(counts.map(key => {
      const value = row[key];
      if (typeof value !== 'number') throw new Error('Invalid document count');
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid document count');
      return [key, value];
    }));
    return { person_id: row.person_id as string, first_name: row.first_name as string, last_name: row.last_name as string, ...totals };
  }) };
}
