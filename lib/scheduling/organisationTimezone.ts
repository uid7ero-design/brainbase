import 'server-only';
import sql from '@/lib/db';
import { isIanaTimezone } from '@scheduling/core';
import { BRAINBASE_FALLBACK_TIMEZONE } from './adapters/brainbase';

// The organisation's timezone for Scheduling (host data: organisations.timezone, else the platform fallback) and the error for an organisation that is entitled but not
// set up. Split out of the runtime so the page gate (lib/scheduling/pageAccess.ts) can read the zone BESIDE its entitlement check, without importing the runtime itself:
// the runtime stays reachable only through the central guard (tests/containment/schedulingPhase2b1Containment.test.ts). One SELECT, read only.

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
