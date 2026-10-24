import { schedulingRoute } from '@/lib/scheduling/route';
import { reactivateResource } from '@/lib/scheduling/config/resources';

// Phase 2B.2b: reactivate a resource.
export const dynamic = 'force-dynamic';

export const POST = schedulingRoute('scheduling.manage', reactivateResource);
