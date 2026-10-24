import { schedulingRoute } from '@/lib/scheduling/route';
import { getResource, updateResource } from '@/lib/scheduling/config/resources';

// Phase 2B.2b: read and edit one resource.
export const dynamic = 'force-dynamic';

export const GET = schedulingRoute('scheduling.view', getResource);
export const PATCH = schedulingRoute('scheduling.manage', updateResource);
