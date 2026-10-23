import { schedulingRoute } from '@/lib/scheduling/route';
import { createSchedule, listSchedules } from '@/lib/scheduling/config/schedules';

// Phase 2B.2b: list and create schedules.
export const dynamic = 'force-dynamic';

export const GET = schedulingRoute('scheduling.view', listSchedules);
export const POST = schedulingRoute('scheduling.manage', createSchedule);
