import type { HrFieldTierMap } from './fieldTiers';

// HR-1 — the concrete HrFieldTierMap lib/hr/fieldTiers.ts's own header
// comment said HR-1 would supply, now that hr_people's real columns are
// defined (scripts/create-hr-people.sql). Every hr_people column HR-1
// exposes through the API is classified here; classifyField() fails
// closed to 'restricted' for anything NOT listed, so a future column
// added without updating this map is protected by default, never
// silently exposed.
//
// 'internal' — safe for anyone who can view the record at all (self,
// direct manager, or HR administrator; see lib/hr/access.ts's
// canViewPerson()) to see: identity and org-structure fields.
//
// 'confidential' — safe for the person themself or an HR administrator
// only (canViewConfidentialFields()), NOT a direct manager: personal
// contact details. HR-1 stores no more sensitive category than this —
// there is no 'restricted' member set yet (see fieldTiers.ts), so any
// field not listed below (there are none outside this map today) would
// fall to the most protected tier by default.
export const HR_PERSON_FIELD_TIERS: HrFieldTierMap = {
  internal: new Set([
    'id',
    'organisation_id',
    'first_name',
    'last_name',
    'preferred_name',
    'job_title',
    'worker_type',
    'employment_status',
    'team_id',
    'manager_person_id',
    'start_date',
    'end_date',
    'linked_user_id',
    'created_at',
    'updated_at',
  ]),
  confidential: new Set([
    'work_email',
    'work_phone',
  ]),
};
