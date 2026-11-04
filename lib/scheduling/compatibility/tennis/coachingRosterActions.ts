import type { TenantContext } from '@scheduling/core';
import type { CoachingAction } from '../../coachingContract';
import type { MigrationReadExecutor } from './migrationSnapshot';
import { CoachingBookings } from './coachingBookings';
import { CoachingCommands } from './coachingCommands';
import { CoachingWorkspace } from './coachingWorkspace';

/** Narrow application facade: existing proven commands, only for the receipted
 * Tennis schedule. Recovery only reads durable evidence, never resubmits. */
export class CoachingRosterActions {
  constructor(private readonly sql: MigrationReadExecutor) {}
  async execute(tenant: TenantContext, action: CoachingAction): Promise<unknown> {
    await new CoachingWorkspace(this.sql).requireActive(tenant);
    const scoped = await this.sql.query<{ id: string }>(action.kind==='enrol'
      ? `SELECT o.id FROM scheduling_occurrences o JOIN scheduling_offerings f ON f.organisation_id=o.organisation_id AND f.id=o.offering_id WHERE o.organisation_id=$1 AND o.id=$2 AND f.schedule_id='tennis-coaching'`
      : 'seriesId' in action ? `SELECT g.id FROM scheduling_series g JOIN scheduling_offerings f ON f.organisation_id=g.organisation_id AND f.id=g.offering_id WHERE g.organisation_id=$1 AND g.id=$2 AND f.schedule_id='tennis-coaching'`
      : `SELECT id FROM scheduling_reservations WHERE organisation_id=$1 AND id=$2 AND schedule_id='tennis-coaching'`,
    [tenant.organisationId,action.kind==='enrol' ? action.occurrenceId : 'seriesId' in action ? action.seriesId : action.bookingId]);
    if (!scoped[0]) throw Object.assign(Error('Booking not found'),{code:'STCLS'});
    const bookings = new CoachingBookings(this.sql); const commands = new CoachingCommands(this.sql);
    switch(action.kind) {
      case 'enrol': return action.weekly ? commands.enrolWeekly(tenant,action,action.until) : bookings.enrol(tenant,action);
      case 'attendance': return bookings.attendance(tenant,action.bookingId,action.value,action.expectedVersion,action.idempotencyKey);
      case 'paid-marker': return commands.markPaid(tenant,action.bookingId,action.paid,action.expectedVersion,action.idempotencyKey);
      case 'cancel': return bookings.cancel(tenant,action.bookingId);
      case 'start-weekly': return commands.startWeekly(tenant,action.bookingId,action.from,action.until,action.idempotencyKey);
      case 'stop-weekly': return commands.stopWeekly(tenant,action.seriesId,action.after,action.idempotencyKey);
      case 'pause': return commands.pause(tenant,action.seriesId,action.from,action.until,action.reason,action.idempotencyKey);
      case 'resume': return commands.resume(tenant,action.seriesId,action.pauseId,action.from,action.until,action.idempotencyKey);
    }
  }
  async saved(tenant: TenantContext, key: string, kind: string, bookingId?: string): Promise<boolean> {
    if (tenant.actor.kind!=='staff' || !tenant.can('scheduling.reserve')) throw Error('Coaching permission denied');
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(key) || !['enrol','attendance','paid-marker','cancel','start-weekly','stop-weekly','pause','resume'].includes(kind)) throw Error('Invalid recovery request');
    if (await new CoachingWorkspace(this.sql).phase(tenant)==='legacy') return false;
    // Cancellation is terminal; a current cancelled row proves the requested
    // outcome, not which browser performed it. No historical timestamp invented.
    if (kind==='cancel') return (await this.sql.query(`SELECT id FROM scheduling_reservations WHERE organisation_id=$1 AND id=$2
      AND schedule_id='tennis-coaching' AND status='cancelled'`,[tenant.organisationId,bookingId ?? null])).length===1;
    const receipt = await this.sql.query(`SELECT command_key FROM scheduling_coaching_commands WHERE organisation_id=$1 AND command_key=$2
      AND request->>'kind'=$3`,[tenant.organisationId,key,kind==='enrol' ? 'enrol-weekly' : kind==='pause' ? 'pause-series' : kind==='resume' ? 'resume-series' : kind]);
    if (receipt.length===1) return true;
    return kind==='enrol' && (await this.sql.query(`SELECT id FROM scheduling_reservations WHERE organisation_id=$1 AND idempotency_key=$2
      AND schedule_id='tennis-coaching'`,[tenant.organisationId,key])).length===1;
  }
}
