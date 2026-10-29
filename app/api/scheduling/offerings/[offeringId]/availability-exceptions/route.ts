import { schedulingRoute } from '@/lib/scheduling/route';
import { createExceptionFor } from '@/lib/scheduling/config/availability';

// Phase 2B.3b: add a closure to a offering.
export const dynamic = 'force-dynamic';

export const POST = schedulingRoute('scheduling.manage', createExceptionFor('offering'));
