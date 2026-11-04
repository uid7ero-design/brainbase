import 'server-only';
import sql from '@/lib/db';
import { type Clock, type SchedulingAvailabilityRepository, type SchedulingPersistence, type SchedulingSettings, type TenantContext } from '@scheduling/core';
import { createPostgresScheduling, fromNeonHttpLike, PostgresAvailabilityRepository, PostgresBookingReadRepository, PostgresHireRepository, type SqlExecutor, type SqlStatement } from '@scheduling/postgres';
import { BRAINBASE_FALLBACK_TIMEZONE, staffTenantContext } from './adapters/brainbase';
import { SchedulingConfigurationError, resolveOrganisationTimezone, type ResolvedTimezone } from './organisationTimezone';
import { CoachingClasses, type GenerationResult, type RestorationResult } from './compatibility/tennis/coachingClasses';
import { CoachingWorkspace } from './compatibility/tennis/coachingWorkspace';
import { CoachingRosterActions } from './compatibility/tennis/coachingRosterActions';
import type { CoachingAction } from './coachingContract';
import { TennisPublicBooking } from './compatibility/tennis/publicBooking';

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

// The organisation-timezone lookup and its configuration error live in ./organisationTimezone (the page gate needs the zone without the rest of the runtime) and are
// re-exported here, so everything that imported them from the runtime still does.
export { SchedulingConfigurationError, resolveOrganisationTimezone, type ResolvedTimezone } from './organisationTimezone';

export interface SchedulingRuntime {
  coachingLifecycle?: {
    archive(id: string, key: string): Promise<unknown>; restore(id: string, key: string): Promise<RestorationResult>;
    saved(id: string, key: string, action: string): Promise<unknown|null>;
  };
  coachingRoster?: {
    dates(from: string, until: string, after?: string): ReturnType<CoachingWorkspace['dates']>;
    roster(id: string, after?: string): ReturnType<CoachingWorkspace['roster']>;
    execute(action: CoachingAction): Promise<unknown>;
    saved(key: string, kind: string, bookingId?: string): Promise<boolean>;
  };
  /** Lazy, tenant-bound commands; no schema is installed or activated here. */
  coaching?: { generateClasses(offeringId: string, key: string): Promise<GenerationResult>; savedGeneration(offeringId: string, key: string): Promise<GenerationResult | null> };
  tenant: TenantContext;
  persistence: SchedulingPersistence;
  /** Phase 2B.3b: availability rules and exceptions. Needs migration 034; until it is applied its calls throw AvailabilityNotReadyError. */
  availability: SchedulingAvailabilityRepository;
  /** Phase 2C.2: READ-ONLY range reads of occurrences, reservations (viewer-reduced) and holds, and the booking overlay. Single SELECTs; writes nothing. */
  bookingReads: PostgresBookingReadRepository;
  /** Phase 2C.3b: the staff facility-hire repository (createHire, findHireByKey, readHireBasis). Built lazily with no query; only the booking routes call it, and only behind the staff-booking gate. */
  hire: PostgresHireRepository;
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
/** What a request cost the database, for its log line and Server-Timing header: how many statements and how long they took IN TOTAL (they can overlap, so the total can exceed the request's own time). Numbers only: never SQL, parameters or rows. */
export interface StatementRecorder {
  statements: number;
  dbMs: number;
}

export function createSchedulingExecutor(signal?: AbortSignal, recorder?: StatementRecorder): SqlExecutor {
  // With a signal (a route that has a deadline), every repository statement of the request stops waiting when it aborts. The Neon HTTP protocol has no
  // per-session statement_timeout, so this bounds what the REQUEST waits for; the server-side statement ends on its own (reads here are indexed and bounded).
  const inner = fromNeonHttpLike(
    sql as unknown as { query(text: string, params?: unknown[], queryOptions?: Record<string, unknown>): Promise<unknown> },
    signal ? { queryOptions: { fetchOptions: { signal } } } : {},
  );
  if (!recorder) return inner;
  const recorded: SqlExecutor = {
    async query<Row>(text: string, params: readonly unknown[] = []) {
      const started = performance.now();
      try {
        return await inner.query<Row>(text, params);
      } finally {
        recorder.statements += 1;
        recorder.dbMs += performance.now() - started;
      }
    },
  };
  // Phase 2C.3b: the recorder used to return an object with `query` only, which silently dropped `transaction()` and made createHire refuse every call. The transaction is forwarded
  // as it is, never emulated: it exists on the recorded executor if and only if the underlying driver has one, so a driver without a transaction still fails closed
  // (createHire throws HireNotReadyError and nothing is written). It is ONE round trip, so its time is recorded once; its statements are counted individually (numbers only, never SQL).
  const innerTransaction = inner.transaction;
  if (typeof innerTransaction === 'function') {
    recorded.transaction = async (statements: readonly SqlStatement[]) => {
      const started = performance.now();
      try {
        return await innerTransaction.call(inner, statements);
      } finally {
        recorder.statements += statements.length;
        recorder.dbMs += performance.now() - started;
      }
    };
  }
  return recorded;
}

/** Public Tennis bridge: configuration only, never a request-supplied tenant. */
export function publicTennisBooking() {
  return new TennisPublicBooking(createSchedulingExecutor(), process.env.LD_TENNIS_ORG_ID ?? '');
}

/** Builds the runtime for an authorised staff session. Read-only: it never writes to the database. */
export async function loadSchedulingRuntime(session: { organisationId: string; userId: string; role: string }, options: { signal?: AbortSignal; recorder?: StatementRecorder } = {}): Promise<SchedulingRuntime> {
  const executor = createSchedulingExecutor(options.signal, options.recorder);
  const persistence = createPostgresScheduling({ sql: executor, clock: systemClock });
  const availability = new PostgresAvailabilityRepository({ sql: executor });
  const bookingReads = new PostgresBookingReadRepository({ sql: executor });
  const hire = new PostgresHireRepository({ sql: executor, clock: systemClock });
  // The organisation's zone and its settings row are independent reads, so they are asked together (one round trip, not two). The settings read only needs the
  // organisation and the caller's permission, and the stored settings never carry a zone (the host owns it), so it is made with a tenant built on the platform
  // fallback zone; the tenant handed to the handler is built on the resolved zone below. Failure order is unchanged: an unusable zone is reported before a
  // missing settings row, and nothing is created or repaired.
  const identity = { organisationId: session.organisationId, userId: session.userId, role: session.role };
  const [timezone, settings] = await Promise.all([
    resolveOrganisationTimezone(session.organisationId),
    persistence.config.getSettings(staffTenantContext({ ...identity, timezone: BRAINBASE_FALLBACK_TIMEZONE })),
  ]);
  const tenant = staffTenantContext({ ...identity, timezone: timezone.value });
  if (!settings) throw new SchedulingConfigurationError('missing_settings');
  const classes = new CoachingClasses(executor);
  const coachingLifecycle = {
    archive: (id:string,key:string) => classes.archiveLive(tenant,id,key),
    restore: (id:string,key:string) => classes.restoreLive(tenant,id,systemClock.today(tenant.timezone),key),
    saved: (id:string,key:string,action:string) => action==='restore' ? classes.savedRestoration(tenant,id,key) : classes.savedArchive(tenant,id,key),
  };
  const workspace = new CoachingWorkspace(executor);
  const actions = new CoachingRosterActions(executor);
  const coachingRoster = {
    dates: (from: string, until: string, after?: string) => workspace.dates(tenant,from,until,after),
    roster: (id: string, after?: string) => workspace.roster(tenant,id,after),
    execute: (action: CoachingAction) => actions.execute(tenant,action),
    saved: (key: string, kind: string, bookingId?: string) => actions.saved(tenant,key,kind,bookingId),
  };
  const coaching = {
    generateClasses: (offeringId: string, key: string) => classes.generateLive(tenant, offeringId, systemClock.today(tenant.timezone), key),
    savedGeneration: (offeringId: string, key: string) => classes.savedGeneration(tenant, offeringId, key),
  };
  return { tenant, persistence, availability, bookingReads, hire, settings, timezone, coaching, coachingRoster, coachingLifecycle };
}
