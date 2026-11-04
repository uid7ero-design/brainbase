import { isLocalDate, type TenantContext } from '@scheduling/core';
import type { MigrationReadExecutor } from './migrationSnapshot';
import { readCoachingRoster } from './coachingHistory';

export interface CoachingClassDate {
  id: string; offeringId: string; name: string; date: string; startTime: string;
  status: string; archived: boolean; capacity: number; enrolled: number;
}
export interface CoachingWorkspacePage {
  phase: 'legacy' | 'frozen' | 'scheduling'; dates: CoachingClassDate[]; next: string | null;
}
export const coachingId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const denied = () => Object.assign(Error('Coaching integration unavailable'), { code: 'STOFF' });

/** Tenant-bound roster reads. View-only Scheduling access does not expose the
 * coach's customer roster. An absent installation is not an empty calendar. */
export class CoachingWorkspace {
  constructor(private readonly sql: MigrationReadExecutor) {}
  private staff(tenant: TenantContext) {
    if (!tenant.organisationId || tenant.actor.kind !== 'staff' || !tenant.can('scheduling.reserve')) throw Error('Coaching roster permission denied');
  }
  async phase(tenant: TenantContext): Promise<CoachingWorkspacePage['phase']> {
    this.staff(tenant);
    const installed = await this.sql.query<{ ready: boolean }>(`SELECT to_regclass('public.scheduling_tennis_cutover') IS NOT NULL
      AND to_regclass('public.scheduling_tennis_import_receipts') IS NOT NULL ready`, []);
    if (!installed[0]?.ready) return 'legacy';
    const rows = await this.sql.query<{ phase: CoachingWorkspacePage['phase']; receipted: boolean }>(`SELECT c.phase,
      EXISTS(SELECT 1 FROM scheduling_tennis_import_receipts r WHERE r.organisation_id=c.organisation_id AND r.source_hash=c.captured_hash) receipted
      FROM scheduling_tennis_cutover c WHERE c.organisation_id=$1`, [tenant.organisationId]);
    if (!rows[0]) return 'legacy';
    if (!['legacy','frozen','scheduling'].includes(rows[0].phase) || (rows[0].phase === 'scheduling' && !rows[0].receipted)) throw denied();
    return rows[0].phase;
  }
  async requireActive(tenant: TenantContext) { if (await this.phase(tenant) !== 'scheduling') throw denied(); }
  async dates(tenant: TenantContext, from: string, until: string, after?: string): Promise<CoachingWorkspacePage> {
    this.staff(tenant);
    if (!isLocalDate(from) || !isLocalDate(until) || until < from || Date.parse(until)-Date.parse(from)>70*86400000
      || (after !== undefined && !coachingId(after))) throw Object.assign(Error('Invalid date range'), { code: 'STVAL' });
    const phase = await this.phase(tenant);
    if (phase === 'legacy') return { phase, dates: [], next: null };
    const dates = await this.sql.query<CoachingClassDate>(`SELECT o.id,o.offering_id "offeringId",f.name,
      to_char(o.local_date,'YYYY-MM-DD') date,to_char(o.local_start_time,'HH24:MI') "startTime",
      o.status,f.archived_at IS NOT NULL archived,o.capacity,
      (SELECT count(*)::int FROM scheduling_reservations r WHERE r.organisation_id=o.organisation_id AND r.occurrence_id=o.id AND r.status<>'cancelled') enrolled
      FROM scheduling_occurrences o JOIN scheduling_offerings f ON f.organisation_id=o.organisation_id AND f.id=o.offering_id
      JOIN scheduling_tennis_import_receipts i ON i.organisation_id=o.organisation_id
      JOIN scheduling_tennis_cutover c ON c.organisation_id=i.organisation_id AND c.captured_hash=i.source_hash
      WHERE o.organisation_id=$1 AND f.schedule_id='tennis-coaching' AND o.local_date BETWEEN $2::date AND $3::date
        AND ($4::text IS NULL OR (o.local_date,o.local_start_time,o.id COLLATE "C")>(SELECT c.local_date,c.local_start_time,c.id COLLATE "C"
          FROM scheduling_occurrences c JOIN scheduling_offerings cf ON cf.organisation_id=c.organisation_id AND cf.id=c.offering_id
          WHERE c.organisation_id=$1 AND c.id=$4 AND cf.schedule_id='tennis-coaching'))
      ORDER BY o.local_date,o.local_start_time,o.id COLLATE "C" LIMIT 101`,
    [tenant.organisationId,from,until,after ?? null]);
    return { phase, dates: dates.slice(0,100), next: dates.length>100 ? dates[99].id : null };
  }
  async roster(tenant: TenantContext, occurrenceId: string, after?: string) {
    this.staff(tenant);
    if (await this.phase(tenant) === 'legacy') throw denied();
    return readCoachingRoster(this.sql,tenant,occurrenceId,{after});
  }
}
