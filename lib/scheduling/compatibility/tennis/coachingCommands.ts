import { isLocalDate, type TenantContext } from '@scheduling/core';
import type { MigrationReadExecutor } from './migrationSnapshot';

export interface FillResult { created: { id: string; date: string }[]; fullDates: string[]; pausedDates: string[]; alreadyPresent: number }
export interface PauseResult { pauseId: string; cancelled: string[]; protected: string[] }
export interface MarkerResult { paidMarker: boolean; version: number }
export interface ResumeResult { removedPause: Record<string, unknown>; refill: FillResult }
export interface WeeklyResult { seriesId: string; refill: FillResult }
export interface StopResult { seriesId: string; cancelled: string[]; protected: string[] }
const id = (value: string) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
function actor(tenant: TenantContext): string {
  if (tenant.actor.kind !== 'staff' || !tenant.organisationId || !tenant.can('scheduling.reserve')) throw Error('Coaching permission denied');
  return tenant.actor.userId;
}
function range(seriesId: string, from: string, until: string, maxDays: number) {
  if (!id(seriesId) || !isLocalDate(from) || !isLocalDate(until) || until < from
    || Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > maxDays * 86400000) throw Error('Invalid coaching range');
}

/** Commands are atomic server-side functions. An ambiguous outcome is recovered
 * from its exact request receipt, never by repeating the write. */
export class CoachingCommands {
  constructor(private readonly sql: MigrationReadExecutor) {}
  private async run<T>(tenant: TenantContext, key: string, body: Record<string, unknown>, statement: string, parameters: unknown[]): Promise<T> {
    actor(tenant);
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) throw Error('Invalid coaching command key');
    try {
      const rows = await this.sql.query<{ result: T }>(statement, parameters);
      if (rows.length !== 1 || !rows[0].result) throw Error('Coaching command result unavailable');
      return rows[0].result;
    } catch (error) {
      const rows = await this.sql.query<{ result: T }>(`SELECT result FROM scheduling_coaching_commands
        WHERE organisation_id=$1 AND command_key=$2 AND request=$3::jsonb`, [tenant.organisationId, key, JSON.stringify(body)]);
      if (rows.length === 1) return rows[0].result;
      throw error;
    }
  }
  async fill(tenant: TenantContext, seriesId: string, from: string, until: string, key: string): Promise<FillResult> {
    const user = actor(tenant); range(seriesId, from, until, 70);
    return this.run(tenant, key, { kind: 'fill-series', seriesId, from, until },
      'SELECT scheduling_coaching_fill_series($1,$2,$3::date,$4::date,$5,$6) AS result', [tenant.organisationId, seriesId, from, until, key, user]);
  }
  async pause(tenant: TenantContext, seriesId: string, from: string, until: string, reason: string | null, key: string): Promise<PauseResult> {
    const user = actor(tenant); range(seriesId, from, until, 366);
    if (reason !== null && (typeof reason !== 'string' || reason.length > 1000)) throw Error('Invalid coaching pause reason');
    return this.run(tenant, key, { kind: 'pause-series', seriesId, from, until, reason },
      'SELECT scheduling_coaching_pause_series($1,$2,$3::date,$4::date,$5,$6,$7) AS result', [tenant.organisationId, seriesId, from, until, reason, key, user]);
  }
  async markPaid(tenant: TenantContext, bookingId: string, paid: boolean, expectedVersion: number, key: string): Promise<MarkerResult> {
    const user = actor(tenant);
    if (!id(bookingId) || typeof paid !== 'boolean' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw Error('Invalid coaching marker');
    return this.run(tenant, key, { kind: 'paid-marker', bookingId, paid, expectedVersion },
      'SELECT scheduling_coaching_set_paid_marker($1,$2,$3,$4,$5,$6) AS result', [tenant.organisationId, bookingId, paid, expectedVersion, key, user]);
  }
  async resume(tenant: TenantContext, seriesId: string, pauseId: string, from: string, until: string, key: string): Promise<ResumeResult> {
    const user = actor(tenant); range(seriesId, from, until, 70);
    if (!id(pauseId)) throw Error('Invalid coaching pause');
    return this.run(tenant, key, { kind: 'resume-series', seriesId, pauseId, from, until },
      'SELECT scheduling_coaching_resume_series($1,$2,$3,$4::date,$5::date,$6,$7) AS result', [tenant.organisationId, seriesId, pauseId, from, until, key, user]);
  }
  async startWeekly(tenant: TenantContext, bookingId: string, from: string, until: string, key: string): Promise<WeeklyResult> {
    const user = actor(tenant); range(bookingId, from, until, 70);
    return this.run(tenant, key, { kind: 'start-weekly', bookingId, from, until },
      'SELECT scheduling_coaching_start_weekly($1,$2,$3::date,$4::date,$5,$6) AS result', [tenant.organisationId, bookingId, from, until, key, user]);
  }
  async stopWeekly(tenant: TenantContext, seriesId: string, after: string, key: string): Promise<StopResult> {
    const user = actor(tenant);
    if (!id(seriesId) || !isLocalDate(after)) throw Error('Invalid weekly stop');
    return this.run(tenant, key, { kind: 'stop-weekly', seriesId, after },
      'SELECT scheduling_coaching_stop_weekly($1,$2,$3::date,$4,$5) AS result', [tenant.organisationId, seriesId, after, key, user]);
  }
}
