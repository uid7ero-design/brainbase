import type { TenantContext } from '@scheduling/core';
import type { MigrationReadExecutor } from './migrationSnapshot';

export const TENNIS_HISTORY_SOURCES = ['sessions', 'session_instances', 'bookings', 'booking_recurrence_pauses', 'session_types'] as const;
export type TennisHistorySource = typeof TENNIS_HISTORY_SOURCES[number];
export interface TennisHistoryRow { sourceId: string; original: Record<string, unknown> }
export interface TennisHistoryPage { rows: TennisHistoryRow[]; next: string | null; manifest: string }

export interface CoachingRosterRow {
  id: string; name: string; email: string | null; phone: string | null; notes: string | null;
  status: string; attendance: string | null; attendanceVersion: number | null;
  paidMarker: boolean; markerVersion: number | null; priceCents: number | null; currency: string;
  seriesId: string | null; cancelledAt: string | null; originalCreatedAt: string | null;
  historyOnly: boolean;
}
export interface CoachingRosterPage {
  occurrence: { id: string; date: string; startTime: string; status: string; capacity: number; name: string };
  rows: CoachingRosterRow[]; next: string | null;
}

/** One receipted roster, including cancelled source history that has no invented
 * cancellation timestamp. Live canonical rows win by explicit source id, never
 * by a person's name or email. Full archive rows are not sent to this screen. */
export async function readCoachingRoster(sql: MigrationReadExecutor, tenant: TenantContext, occurrenceId: string,
  options: { after?: string; limit?: number } = {}): Promise<CoachingRosterPage | null> {
  if (tenant.actor.kind !== 'staff' || !tenant.organisationId || !tenant.can('scheduling.reserve')) throw Error('Coaching roster permission denied');
  const limit = options.limit ?? 50;
  const validId = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
  if (!validId(occurrenceId) || !Number.isInteger(limit) || limit < 1 || limit > 100 || (options.after !== undefined && !validId(options.after))) throw Error('Invalid coaching roster request');
  const result = await sql.query<{ occurrence: CoachingRosterPage['occurrence']; rows: CoachingRosterRow[] }>(`
    WITH scope AS MATERIALIZED (
      SELECT o.*,f.name FROM scheduling_occurrences o
      JOIN scheduling_offerings f ON f.organisation_id=o.organisation_id AND f.id=o.offering_id
      JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
      JOIN scheduling_tennis_import_receipts i ON i.organisation_id=s.organisation_id
      JOIN scheduling_tennis_cutover c ON c.organisation_id=i.organisation_id AND c.captured_hash=i.source_hash
      WHERE o.organisation_id=$1 AND o.id=$2 AND s.id='tennis-coaching' AND s.preset_key='classes_coaching'
    ), ledger AS (
      SELECT r.id,jsonb_build_object('id',r.id,'name',r.customer_name,'email',r.customer_email,'phone',r.customer_phone,'notes',r.notes,
        'status',r.status,'attendance',r.attendance,'attendanceVersion',r.coaching_attendance_version,
        'paidMarker',COALESCE(m.paid_marker,false),'markerVersion',COALESCE(m.version,0),'priceCents',r.price_cents,'currency',r.currency,
        'seriesId',COALESCE(r.series_id,l.series_id),'cancelledAt',r.cancelled_at,'originalCreatedAt',h.source_row->>'created_at','historyOnly',false) AS data
      FROM scheduling_reservations r JOIN scope o ON o.organisation_id=r.organisation_id AND o.id=r.occurrence_id
      LEFT JOIN scheduling_coaching_markers m ON m.organisation_id=r.organisation_id AND m.reservation_id=r.id
      LEFT JOIN scheduling_coaching_series_links l ON l.organisation_id=r.organisation_id AND l.reservation_id=r.id
      LEFT JOIN scheduling_tennis_booking_origins p ON p.organisation_id=r.organisation_id AND p.reservation_id=r.id
      LEFT JOIN scheduling_tennis_history h ON h.organisation_id=p.organisation_id AND h.source_table='bookings' AND h.source_id=p.source_id
      UNION ALL
      SELECT h.source_id,jsonb_build_object('id',h.source_id,'name',h.source_row->>'client_name','email',h.source_row->>'client_email',
        'phone',h.source_row->>'client_phone','notes',h.source_row->>'notes','status','cancelled',
        'attendance',CASE h.source_row->>'attendance_status' WHEN 'attending' THEN 'attended' WHEN 'absent' THEN 'absent' END,
        'attendanceVersion',NULL,'paidMarker',(h.source_row->>'paid')::boolean,'markerVersion',NULL,'priceCents',NULL,'currency',c.captured_currency,
        'seriesId',h.source_row->>'recurring_group_id','cancelledAt',NULL,'originalCreatedAt',h.source_row->>'created_at','historyOnly',true)
      FROM scheduling_tennis_history h JOIN scope o ON o.organisation_id=h.organisation_id AND o.id=h.source_row->>'session_instance_id'
      JOIN scheduling_tennis_cutover c ON c.organisation_id=h.organisation_id
      WHERE h.source_table='bookings' AND h.source_row->>'status'='cancelled'
        AND NOT EXISTS(SELECT 1 FROM scheduling_tennis_booking_origins p WHERE p.organisation_id=h.organisation_id AND p.source_id=h.source_id)
    ) SELECT jsonb_build_object('id',o.id,'date',to_char(o.local_date,'YYYY-MM-DD'),'startTime',o.local_start_time::text,
        'status',o.status,'capacity',o.capacity,'name',o.name) AS occurrence,
      COALESCE((SELECT jsonb_agg(data ORDER BY id COLLATE "C") FROM
        (SELECT id,data FROM ledger WHERE ($3::text IS NULL OR id COLLATE "C">$3 COLLATE "C") ORDER BY id COLLATE "C" LIMIT $4) page),'[]'::jsonb) AS rows
    FROM scope o`, [tenant.organisationId, occurrenceId, options.after ?? null, limit + 1]);
  if (!result[0]) return null;
  const { occurrence, rows } = result[0];
  if (occurrence?.id !== occurrenceId || !Array.isArray(rows) || rows.some(r => !validId(r.id) || typeof r.name !== 'string'
    || typeof r.historyOnly !== 'boolean' || typeof r.paidMarker !== 'boolean'
    || (r.priceCents !== null && (!Number.isSafeInteger(r.priceCents) || r.priceCents < 0)))) throw Error('Invalid coaching roster evidence');
  return { occurrence, rows: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].id : null };
}

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
