import 'server-only';
import sql from '@/lib/db';
import { isIanaTimezone, type Clock, type SchedulingPersistence, type SchedulingSettings, type TenantContext } from '@scheduling/core';
import { createPostgresScheduling, fromNeonHttpLike, type SqlExecutor } from '@scheduling/postgres';
import { BRAINBASE_FALLBACK_TIMEZONE, staffTenantContext } from './adapters/brainbase';

// Phase 2B.1 — the BrainBase runtime for Scheduling: the one place that joins the app's Neon driver, the shared
// @scheduling/postgres repositories, the session's organisation and the organisation's configuration.
//
// What it does, in order, for an ALREADY authorised caller (lib/scheduling/route.ts runs the session, capability and role
// checks first; this file never decides who may do what):
//   1. Resolves the organisation timezone: organisations.timezone, or the platform fallback (Australia/Adelaide) when it
//      is NULL or blank. A stored value that is not a valid IANA zone is a configuration error, never silently replaced:
//      guessing a zone would put bookings at the wrong local time.
//   2. Builds the TenantContext from the session's organisation, user and role, plus that timezone.
//   3. Reads the organisation's scheduling settings through the repository. There MUST be a row. If an entitled
//      organisation has none, the caller gets SchedulingConfigurationError (a controlled 503) and NOTHING is written:
//      this module never creates, defaults or repairs settings. Creating the row is part of the explicit, owner-run
//      enablement of an organisation, with a currency chosen for it.
//
// The organisation comes only from the authenticated session. No function here accepts one from a request.

/** The organisation is entitled to Scheduling but is not set up for it (no settings row, or an unusable timezone). */
export class SchedulingConfigurationError extends Error {
  readonly code = 'SCHEDULING_NOT_CONFIGURED' as const;
  constructor(readonly reason: 'missing_settings' | 'invalid_timezone') {
    super(reason === 'missing_settings' ? 'Scheduling settings are missing for this organisation' : 'The organisation timezone is not a valid IANA timezone');
    this.name = 'SchedulingConfigurationError';
  }
}

export interface ResolvedTimezone {
  value: string;
  source: 'organisation' | 'fallback';
}

export interface SchedulingRuntime {
  tenant: TenantContext;
  persistence: SchedulingPersistence;
  settings: SchedulingSettings;
  timezone: ResolvedTimezone;
}

export const systemClock: Clock = {
  now: () => new Date(),
  today(timezone) {
    // en-CA formats as YYYY-MM-DD, the calendar date in the REQUESTED zone (not the server's).
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  },
};

/** The shared repositories run over the app's Neon HTTP driver, exactly as the 2A driver matrix proved. */
export function createSchedulingExecutor(): SqlExecutor {
  return fromNeonHttpLike(sql as unknown as { query(text: string, params?: unknown[]): Promise<unknown> });
}

/**
 * organisations.timezone for the SESSION's organisation, or the fallback when it has none. An organisation row that does
 * not exist, or a stored zone that is not valid, throws: the runtime fails closed rather than guess.
 */
export async function resolveOrganisationTimezone(organisationId: string): Promise<ResolvedTimezone> {
  const rows = (await sql`SELECT timezone FROM organisations WHERE id = ${organisationId} LIMIT 1`) as { timezone: string | null }[];
  if (rows.length === 0) throw new Error('organisation not found');
  const stored = rows[0].timezone;
  if (stored === null || stored === undefined || stored.trim() === '') return { value: BRAINBASE_FALLBACK_TIMEZONE, source: 'fallback' };
  if (!isIanaTimezone(stored.trim())) throw new SchedulingConfigurationError('invalid_timezone');
  return { value: stored.trim(), source: 'organisation' };
}

/** Builds the runtime for an authorised staff session. Read-only: it never writes to the database. */
export async function loadSchedulingRuntime(session: { organisationId: string; userId: string; role: string }): Promise<SchedulingRuntime> {
  const timezone = await resolveOrganisationTimezone(session.organisationId);
  const tenant = staffTenantContext({
    organisationId: session.organisationId,
    userId: session.userId,
    role: session.role,
    timezone: timezone.value,
  });
  const persistence = createPostgresScheduling({ sql: createSchedulingExecutor(), clock: systemClock });
  const settings = await persistence.config.getSettings(tenant);
  if (!settings) throw new SchedulingConfigurationError('missing_settings');
  return { tenant, persistence, settings, timezone };
}
