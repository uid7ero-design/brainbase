import 'server-only';
import sql from '@/lib/db';

// HR-1 — shared server-side validation for hr_people writes. Every
// cross-table reference (team_id, manager_person_id, linked_user_id) is
// checked here against the CALLER's own organisation_id before use —
// the database FK alone only proves the referenced row exists
// SOMEWHERE, never that it belongs to the same organisation (Postgres
// has no cross-table composite-FK primitive for that). This is the
// application-layer enforcement scripts/create-hr-people.sql's own
// header comment says is required.

export const WORKER_TYPES = ['employee', 'contractor', 'casual', 'volunteer', 'other'] as const;
export type WorkerType = typeof WORKER_TYPES[number];
export function isValidWorkerType(value: unknown): value is WorkerType {
  return typeof value === 'string' && (WORKER_TYPES as readonly string[]).includes(value);
}

export const EMPLOYMENT_STATUSES = ['active', 'inactive', 'onboarding', 'ended'] as const;
export type EmploymentStatus = typeof EMPLOYMENT_STATUSES[number];
export function isValidEmploymentStatus(value: unknown): value is EmploymentStatus {
  return typeof value === 'string' && (EMPLOYMENT_STATUSES as readonly string[]).includes(value);
}

// HR-2 Step 1C — strict 'YYYY-MM-DD' calendar-date validator for
// hr_people.start_date/end_date. Deliberately two stages, never `new
// Date('YYYY-MM-DD')` (which this repo's own lib/date.ts /
// lib/commercial/dates.ts already document as the wrong tool —
// timezone-coercion-prone) and never a date-parsing dependency (none
// exists in this repo's package.json today, and this narrow need
// doesn't justify adding one):
//   1. HR_DATE_FORMAT — an anchored regex, checked FIRST. Rejects any
//      wrong shape outright (locale dates like '14/09/2026', a
//      timestamp like '2026-09-14T00:00:00Z', '', '   ', garbage) with
//      zero Date construction attempted for any of these — no
//      timezone-coercion risk is even possible for a value that fails
//      here.
//   2. A real-calendar-date round-trip, using Date.UTC(...) and
//      UTC-suffixed getters EXCLUSIVELY (never local getters/`new
//      Date(string)`) — JS Date silently NORMALIZES an impossible date
//      (e.g. '2026-04-31' rolls forward into May 1; '2026-02-29' rolls
//      into March 1 in a non-leap year) rather than erroring; comparing
//      the round-tripped y/m/d back against the parsed input is what
//      actually catches that, precisely, with no timezone drift, since
//      every step here stays in UTC space and never touches the
//      process's local timezone.
const HR_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a value that is exactly 'YYYY-MM-DD' AND represents a real
 *  calendar date (rejects e.g. '2026-02-29' in a non-leap year,
 *  '2026-04-31', '2026-13-01'). null/undefined are NOT valid input to this
 *  function — callers decide null-handling themselves (start_date/end_date
 *  are nullable columns; null always means "no date" and is validated by
 *  the caller before ever reaching this function). */
export function isValidHrDate(value: string): boolean {
  if (!HR_DATE_FORMAT.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const roundTripped = new Date(Date.UTC(year, month - 1, day));
  return roundTripped.getUTCFullYear() === year
    && roundTripped.getUTCMonth() === month - 1
    && roundTripped.getUTCDate() === day;
}

/** Resolves whether `teamId` is a real hr_teams row in `organisationId`. */
export async function isTeamInOrganisation(teamId: string, organisationId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM hr_teams WHERE id = ${teamId}::uuid AND organisation_id = ${organisationId} LIMIT 1`;
  return rows.length > 0;
}

// HR-2 Step 1B — a person may keep an existing (even archived) team
// assignment, but may never be NEWLY assigned or moved onto an
// archived team. isTeamActive() is a separate, focused check for that
// one case — deliberately NOT folded into isTeamInOrganisation() above,
// which stays a pure same-org existence check unaffected by archive
// state (an unchanged assignment to a now-archived team must keep
// passing it). Callers apply isTeamActive() only when team_id is an
// ACTUAL new value — see app/api/hr/people/route.ts (always, since
// create has no "existing" to compare against) and
// app/api/hr/people/[id]/route.ts (only when the requested team_id
// differs from the person's current team_id).
/** Resolves whether `teamId` is a real, ACTIVE (archived_at IS NULL) hr_teams row in `organisationId`. */
export async function isTeamActive(teamId: string, organisationId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM hr_teams WHERE id = ${teamId}::uuid AND organisation_id = ${organisationId} AND archived_at IS NULL LIMIT 1`;
  return rows.length > 0;
}

/** Resolves whether `personId` is a real hr_people row in `organisationId`. */
export async function isPersonInOrganisation(personId: string, organisationId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM hr_people WHERE id = ${personId}::uuid AND organisation_id = ${organisationId} LIMIT 1`;
  return rows.length > 0;
}

/** Resolves whether `userId` is a real users row in `organisationId`. */
export async function isUserInOrganisation(userId: string, organisationId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM users WHERE id = ${userId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows.length > 0;
}
