import { schedulingRoute } from '@/lib/scheduling/route';
import { getOffering, updateOffering } from '@/lib/scheduling/config/offerings';

// Phase 2B.2b: read and edit one offering.
export const dynamic = 'force-dynamic';

export const GET = schedulingRoute('scheduling.view', getOffering);
export const PATCH = schedulingRoute('scheduling.manage', updateOffering);
