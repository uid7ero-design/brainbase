import 'server-only';
import sql from '@/lib/db';

// BrainBase Assurance — mutation audit trail on the existing, generic
// audit_logs table (no new schema).
//
// Unlike Commercial's best-effort post-commit audit write (ADR-0003),
// Assurance audit rows are written INSIDE the same sql.transaction() as
// the business mutation: Assurance is itself an assurance/governance
// record, so a mutation without its audit row must not commit. If the
// audit insert fails, the whole mutation rolls back.
//
// action namespace: 'assurance_<resource>.<verb>' ; resource_type is the
// literal 'assurance_<resource>' noun used to read history back.
//
// State payloads deliberately carry identifiers, statuses and references
// only — never free-text descriptions, people names, or contact details —
// so the audit log does not become a secondary PII store.

export type AssuranceAuditResource =
  | 'assurance_incident'
  | 'assurance_investigation'
  | 'assurance_inspection'
  | 'assurance_inspection_template'
  | 'assurance_finding'
  | 'assurance_action'
  | 'assurance_evidence'
  | 'assurance_verification';

export type AssuranceAuditEntry = {
  organisationId: string;
  userId: string;
  resourceType: AssuranceAuditResource;
  resourceId: string;
  verb: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

/** Returns an (unexecuted) INSERT for inclusion in a sql.transaction([...]) array. */
export function auditInsert(entry: AssuranceAuditEntry) {
  return sql`
    INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
    VALUES (
      ${crypto.randomUUID()},
      ${entry.organisationId},
      ${entry.userId},
      ${`${entry.resourceType}.${entry.verb}`},
      ${entry.resourceType},
      ${entry.resourceId},
      ${entry.before ? JSON.stringify(entry.before) : null}::jsonb,
      ${entry.after ? JSON.stringify(entry.after) : null}::jsonb
    )
  `;
}

export type AssuranceHistoryEntry = {
  id: string;
  action: string;
  created_at: string;
  user_name: string | null;
  after_state: Record<string, unknown> | null;
};

/** Tenant-scoped audit history for one Assurance record (newest first). */
export async function listAssuranceHistory(
  organisationId: string,
  resourceType: AssuranceAuditResource,
  resourceId: string,
): Promise<AssuranceHistoryEntry[]> {
  const rows = (await sql`
    SELECT l.id, l.action, l.created_at, u.name AS user_name, l.after_state
    FROM audit_logs l
    LEFT JOIN users u ON u.id = l.user_id AND u.organisation_id = l.organisation_id
    WHERE l.organisation_id = ${organisationId}
      AND l.resource_type = ${resourceType}
      AND l.resource_id = ${resourceId}
    ORDER BY l.created_at DESC
    LIMIT 100
  `) as AssuranceHistoryEntry[];
  return rows;
}
