import { schedulingRoute } from '@/lib/scheduling/route';
import { createOffering, listOfferings } from '@/lib/scheduling/config/offerings';

// Phase 2B.2b: list and create the offerings of a schedule.
export const dynamic = 'force-dynamic';

export const GET = schedulingRoute('scheduling.view', listOfferings);
export const POST = schedulingRoute('scheduling.manage', createOffering);
