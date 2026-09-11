import type { HrAccessContext, HrPersonTarget } from './access';
import { canFieldBeShown } from './access';
import { classifyField } from './fieldTiers';
import { HR_PERSON_FIELD_TIERS } from './personFieldTiers';

export type HrPersonRow = {
  id: string;
  organisation_id: string;
  linked_user_id: string | null;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  work_email: string | null;
  work_phone: string | null;
  job_title: string | null;
  worker_type: string;
  employment_status: string;
  team_id: string | null;
  manager_person_id: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  team_name?: string | null;
  manager_first_name?: string | null;
  manager_last_name?: string | null;
};

/**
 * Projects one hr_people row down to only the fields `ctx` is permitted
 * to see for `target`, using the real HR-1 field-tier map — never the
 * raw row. Callers must have already confirmed canViewPerson(ctx,
 * target) themselves (this function does not re-check it, so it can be
 * reused for a list endpoint that has already filtered rows down to
 * viewable ones).
 */
export function projectPersonRow(
  ctx: HrAccessContext,
  target: HrPersonTarget,
  row: HrPersonRow,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'team_name' || key === 'manager_first_name' || key === 'manager_last_name') {
      // Derived join columns, not real hr_people columns — always safe
      // alongside team_id/manager_person_id themselves (both 'internal').
      out[key] = value;
      continue;
    }
    const tier = classifyField(HR_PERSON_FIELD_TIERS, key);
    if (canFieldBeShown(ctx, target, tier)) out[key] = value;
  }
  return out;
}
