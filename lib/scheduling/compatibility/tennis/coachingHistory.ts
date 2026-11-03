import type { TenantContext } from '@scheduling/core';
import type { MigrationReadExecutor } from './migrationSnapshot';

export const TENNIS_HISTORY_SOURCES = ['sessions', 'session_instances', 'bookings', 'booking_recurrence_pauses', 'session_types'] as const;
export type TennisHistorySource = typeof TENNIS_HISTORY_SOURCES[number];
export interface TennisHistoryRow { sourceId: string; original: Record<string, unknown> }
export interface TennisHistoryPage { rows: TennisHistoryRow[]; next: string | null; manifest: string }

/** Staff-only history. Source ids and original fields survive without inferred prices or event times.
 * Never expose this full-row projection through a viewer/public route. */
export async function readCoachingHistory(sql: MigrationReadExecutor, tenant: TenantContext, source: TennisHistorySource,
  options: { after?: string; limit?: number } = {}): Promise<TennisHistoryPage | null> {
  if (tenant.actor.kind !== 'staff' || !tenant.organisationId || !tenant.can('scheduling.reserve')) throw Error('Coaching history permission denied');
  const limit = options.limit ?? 50;
  if (!TENNIS_HISTORY_SOURCES.includes(source) || !Number.isInteger(limit) || limit < 1 || limit > 100
    || (options.after !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(options.after))) throw Error('Invalid coaching history request');
  // A single statement distinguishes unavailable capture from an empty history page.
  // Never return an unreceipted/partially captured history as a complete ledger.
  const result = await sql.query<{ manifest: string; rows: TennisHistoryRow[] }>(`SELECT c.captured_hash AS manifest,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceId',h.source_id,'original',h.source_row) ORDER BY h.source_id COLLATE "C")
      FROM (SELECT source_id,source_row FROM scheduling_tennis_history
        WHERE organisation_id=c.organisation_id AND source_table=$2
          AND ($3::text IS NULL OR source_id COLLATE "C">$3 COLLATE "C")
        ORDER BY source_id COLLATE "C" LIMIT $4) h),'[]'::jsonb) AS rows
    FROM scheduling_tennis_cutover c WHERE c.organisation_id=$1 AND c.captured_hash IS NOT NULL`,
  [tenant.organisationId, source, options.after ?? null, limit + 1]);
  if (!result[0]) return null;
  const { manifest, rows } = result[0];
  if (!/^[a-f0-9]{64}$/.test(manifest) || !Array.isArray(rows)
    || rows.some(r => !r || typeof r.sourceId !== 'string' || !r.original || Array.isArray(r.original)
      || r.original.id !== r.sourceId || r.original.organisation_id !== tenant.organisationId)) throw Error('Invalid coaching history evidence');
  return { manifest, rows: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].sourceId : null };
}
