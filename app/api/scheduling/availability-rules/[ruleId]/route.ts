import { schedulingRoute } from '@/lib/scheduling/route';
import { deleteRule, updateRule } from '@/lib/scheduling/config/availability';

// Phase 2B.3b: edit or remove one weekly availability rule (both need the version token, expectedUpdatedAt).
export const dynamic = 'force-dynamic';

export const PATCH = schedulingRoute('scheduling.manage', updateRule);
export const DELETE = schedulingRoute('scheduling.manage', deleteRule);
