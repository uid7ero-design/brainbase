import 'server-only';

import type { HrPersonRow } from './projectPerson';

export type AiSafeHrPersonProjection = {
  display_name: string;
  job_title: string | null;
  worker_type: string;
  employment_status: string;
  team_name: string | null;
  manager_name: string | null;
};

/**
 * HR-8A — minimal person context that is safe to hand to a future
 * explicitly-authorised AI feature.
 *
 * This is NOT an authorization function. Callers must first establish that
 * the current actor may view the person. The purpose of this helper is data
 * minimisation after authorization: it builds a brand-new object literal
 * from a closed allowlist rather than filtering/spreading the normal HR API
 * projection.
 *
 * Deliberately excluded:
 * - every database/tenant/account identifier
 * - linked_user_id
 * - work email and phone
 * - surname as a standalone field
 * - exact start/end dates
 * - created/updated timestamps
 * - restricted-case, document, lifecycle, audit or grant data
 *
 * The display label intentionally uses only the person's preferred name (when
 * present) or first name. Manager context is likewise first-name-only. A
 * future feature that genuinely requires stronger identity/disambiguation must
 * add that field explicitly in its own reviewed slice rather than inheriting
 * it accidentally from HrPersonRow.
 */
export function projectPersonForAi(row: HrPersonRow): AiSafeHrPersonProjection {
  const preferredName = row.preferred_name?.trim();
  const managerFirstName = row.manager_first_name?.trim();

  return {
    display_name: preferredName || row.first_name,
    job_title: row.job_title,
    worker_type: row.worker_type,
    employment_status: row.employment_status,
    team_name: row.team_name ?? null,
    manager_name: managerFirstName || null,
  };
}
