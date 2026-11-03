import { addLocalDays, isLocalDate, planOccurrences, type TenantContext, type OccurrenceOffering, type ExistingOccurrenceSlot } from '@scheduling/core';
import type { MigrationReadExecutor } from './migrationSnapshot';

interface GenerationBasis { token: string; timezone: string; offering: OccurrenceOffering; existing: ExistingOccurrenceSlot[] }
export interface GenerationResult { created: { id: string; date: string }[]; existing: number; skipped: { date: string; startTime: string; reason: string }[] }

/** A read plans the dates, then ONE database command checks the exact class
 * configuration under lock before inserting the whole plan and its receipt. */
export class CoachingClasses {
  constructor(private readonly sql: MigrationReadExecutor) {}
  async savedGeneration(tenant: TenantContext, offeringId: string, key: string): Promise<GenerationResult | null> {
    if (!tenant.organisationId || tenant.actor.kind !== 'staff' || !tenant.can('scheduling.manage')) throw Error('Coaching class permission denied');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(offeringId) || !/^[A-Za-z0-9_-]{16,80}$/.test(key)) throw Object.assign(Error('Invalid generation key'),{code:'STVAL'});
    const installed=await this.sql.query<{ready:boolean}>("SELECT to_regclass('public.scheduling_coaching_commands') IS NOT NULL ready",[]);
    if (!installed[0]?.ready) return null;
    const rows=await this.sql.query<{result:GenerationResult}>(`SELECT result FROM scheduling_coaching_commands WHERE organisation_id=$1
      AND command_key=$2 AND request->>'kind'='generate-classes' AND request->>'offeringId'=$3`,[tenant.organisationId,key,offeringId]);
    return rows[0]?.result ?? null;
  }
  /** HTTP entry point: no writes until the explicitly receipted Tennis cutover is
   * active. The database target guard rechecks the phase at each insert. */
  async generateLive(tenant: TenantContext, offeringId: string, today: string, key: string): Promise<GenerationResult> {
    if (tenant.actor.kind !== 'staff' || !tenant.can('scheduling.manage')) throw Error('Coaching class permission denied');
    const installed = await this.sql.query<{ ready: boolean }>(`SELECT to_regclass('public.scheduling_tennis_cutover') IS NOT NULL
      AND to_regclass('public.scheduling_tennis_import_receipts') IS NOT NULL AS ready`, []);
    if (!installed[0]?.ready) throw Object.assign(Error('Coaching integration unavailable'), { code: 'STOFF' });
    const enabled = await this.sql.query<{ ready: boolean }>(`SELECT true ready FROM scheduling_tennis_cutover c
      JOIN scheduling_tennis_import_receipts r ON r.organisation_id=c.organisation_id AND r.source_hash=c.captured_hash
      JOIN scheduling_offerings f ON f.organisation_id=c.organisation_id AND f.schedule_id='tennis-coaching'
      WHERE c.organisation_id=$1 AND c.phase='scheduling' AND f.id=$2`, [tenant.organisationId, offeringId]);
    if (!enabled[0]?.ready) throw Object.assign(Error('Coaching integration unavailable'), { code: 'STOFF' });
    return this.generate(tenant, offeringId, today, key);
  }
  async generate(tenant: TenantContext, offeringId: string, today: string, key: string): Promise<GenerationResult> {
    if (!tenant.organisationId || tenant.actor.kind !== 'staff' || !tenant.can('scheduling.manage')) throw Error('Coaching class permission denied');
    if (typeof offeringId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(offeringId) || !isLocalDate(today)
      || typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(key)) throw Error('Invalid class generation request');
    const request = { kind: 'generate-classes', offeringId, from: today };
    const recover = async () => (await this.sql.query<{ result: GenerationResult }>(`SELECT result FROM scheduling_coaching_commands
      WHERE organisation_id=$1 AND command_key=$2 AND request=$3::jsonb`, [tenant.organisationId, key, JSON.stringify(request)]))[0]?.result;
    const saved = await recover(); if (saved) return saved;
    const rows = await this.sql.query<GenerationBasis>(`SELECT
      encode(sha256(convert_to(jsonb_build_array(to_jsonb(f),s.timezone,s.archived_at)::text,'UTF8')),'hex') token,s.timezone,
      jsonb_build_object('id',f.id,'archivedAt',f.archived_at,'durationMinutes',f.duration_minutes,'capacity',f.capacity,
        'startTime',to_char(f.start_time,'HH24:MI'),'recurrence',CASE WHEN f.recurrence_kind='none' THEN jsonb_build_object('kind','none') ELSE
        jsonb_build_object('kind','weekly','dayOfWeek',f.recurrence_day_of_week,'startDate',to_char(f.recurrence_start_date,'YYYY-MM-DD'),
          'end',CASE f.recurrence_end_mode WHEN 'ongoing' THEN jsonb_build_object('mode','ongoing')
            WHEN 'on_date' THEN jsonb_build_object('mode','on_date','date',to_char(f.recurrence_end_date,'YYYY-MM-DD'))
            ELSE jsonb_build_object('mode','after_occurrences','count',f.recurrence_end_count) END) END) offering,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('date',to_char(o.local_date,'YYYY-MM-DD'),'startTime',to_char(o.local_start_time,'HH24:MI'),'status',o.status))
        FROM scheduling_occurrences o WHERE o.organisation_id=f.organisation_id AND o.offering_id=f.id AND o.local_date BETWEEN $3::date AND $3::date+70),'[]') existing
      FROM scheduling_offerings f JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
      WHERE f.organisation_id=$1 AND f.id=$2 AND s.preset_key='classes_coaching' AND s.archived_at IS NULL`, [tenant.organisationId, offeringId, today]);
    if (rows.length !== 1) throw Object.assign(Error('Coaching class unavailable'), { code: 'STCLS' });
    const basis = rows[0];
    // Tennis's existing horizon includes day 70. The shared planner's 10 weeks
    // ends at day 69; plan 11 weeks and explicitly clip to preserve that contract.
    const plan = planOccurrences({ offering: basis.offering, timezone: basis.timezone, today, horizonWeeks: 11, maxOccurrences: 100, existing: basis.existing });
    if (!plan.ok) throw Object.assign(Error('Class cannot be generated'), { code: 'STVAL' });
    const until = addLocalDays(today, 70);
    const create = plan.create.filter(x => x.date <= until);
    const skipped = plan.skipped.filter(x => x.date <= until);
    try {
      const result = await this.sql.query<{ result: GenerationResult }>('SELECT scheduling_coaching_generate_classes($1,$2,$3::date,$4,$5::jsonb,$6::jsonb,$7,$8) result',
        [tenant.organisationId, offeringId, today, basis.token, JSON.stringify(create), JSON.stringify(skipped), key, tenant.actor.userId]);
      if (result.length !== 1) throw Error('Class generation outcome unavailable');
      return result[0].result;
    } catch (error) {
      const receipt = await recover(); if (receipt) return receipt;
      throw error;
    }
  }
}
