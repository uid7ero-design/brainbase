import { schedulingRoute } from '@/lib/scheduling/route';
import { linkResource, listOfferingResources } from '@/lib/scheduling/config/links';

// Phase 2B.2b: list and assign the resources of an offering.
export const dynamic = 'force-dynamic';

export const GET = schedulingRoute('scheduling.view', listOfferingResources);
export const POST = schedulingRoute('scheduling.manage', linkResource);
