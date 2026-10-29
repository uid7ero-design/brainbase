import { schedulingRoute } from '@/lib/scheduling/route';
import { listAvailabilityFor } from '@/lib/scheduling/config/availability';

// Phase 2B.3b: the weekly rules and closures of one resource.
export const dynamic = 'force-dynamic';

export const GET = schedulingRoute('scheduling.view', listAvailabilityFor('resource'));
