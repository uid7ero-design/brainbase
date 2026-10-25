import { schedulingRoute } from '@/lib/scheduling/route';
import { deleteException, updateException } from '@/lib/scheduling/config/availability';

// Phase 2B.3b: edit or remove one closure (both need the version token, expectedUpdatedAt).
export const dynamic = 'force-dynamic';

export const PATCH = schedulingRoute('scheduling.manage', updateException);
export const DELETE = schedulingRoute('scheduling.manage', deleteException);
