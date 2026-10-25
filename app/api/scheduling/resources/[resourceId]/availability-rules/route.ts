import { schedulingRoute } from '@/lib/scheduling/route';
import { createRuleFor } from '@/lib/scheduling/config/availability';

// Phase 2B.3b: add a weekly availability rule to a resource.
export const dynamic = 'force-dynamic';

export const POST = schedulingRoute('scheduling.manage', createRuleFor('resource'));
