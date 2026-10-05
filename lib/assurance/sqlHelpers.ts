import 'server-only';
import sql from '@/lib/db';
import type { AssuranceAuditResource } from './audit';

// Small, allow-listed SQL building blocks shared by the Assurance services.

export type AssuranceTimestamp = string | Date;

const CTE_NAMES = new Set(['upd', 'ins', 'act', 'ver', 'src']);

/**
 * `INSERT INTO audit_logs ... SELECT ... FROM <cte>` — used inside a
 * single WITH-statement so the audit row exists if and only if the
 * guarded mutation CTE actually changed a row (atomic; zero rows changed
 * means zero audit rows). The CTE must expose an `id` column.
 */
export function auditFromCte(
  cte: string,
  entry: {
    organisationId: string;
    userId: string;
    resourceType: AssuranceAuditResource;
    verb: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
) {
  if (!CTE_NAMES.has(cte)) throw new Error(`assurance sql: CTE "${cte}" is not allow-listed`);
  const from = sql.unsafe(cte);
  return sql`
    INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
    SELECT gen_random_uuid()::text, ${entry.organisationId}, ${entry.userId},
           ${`${entry.resourceType}.${entry.verb}`}, ${entry.resourceType}, ${from}.id::text,
           ${entry.before ? JSON.stringify(entry.before) : null}::jsonb,
           ${entry.after ? JSON.stringify(entry.after) : null}::jsonb
    FROM ${from}
  `;
}
