import { schedulingRoute } from '@/lib/scheduling/route';
import { deactivateResource } from '@/lib/scheduling/config/resources';

// Phase 2B.2b: deactivate a resource (refused while a live reservation holds it).
export const dynamic = 'force-dynamic';

export const POST = schedulingRoute('scheduling.manage', deactivateResource);
