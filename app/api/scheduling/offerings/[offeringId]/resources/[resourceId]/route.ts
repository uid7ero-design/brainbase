import { schedulingRoute } from '@/lib/scheduling/route';
import { unlinkResource } from '@/lib/scheduling/config/links';

// Phase 2B.2b: remove a resource from an offering (the link only).
export const dynamic = 'force-dynamic';

export const DELETE = schedulingRoute('scheduling.manage', unlinkResource);
