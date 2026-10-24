import { schedulingRoute } from '@/lib/scheduling/route';
import { createResource, listResources } from '@/lib/scheduling/config/resources';

// Phase 2B.2b: list and create resources.
export const dynamic = 'force-dynamic';

export const GET = schedulingRoute('scheduling.view', listResources);
export const POST = schedulingRoute('scheduling.manage', createResource);
