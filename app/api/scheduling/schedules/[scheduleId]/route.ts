import { schedulingRoute } from '@/lib/scheduling/route';
import { getSchedule, updateSchedule } from '@/lib/scheduling/config/schedules';

// Phase 2B.2b: read and edit one schedule (optimistic concurrency: expectedUpdatedAt, 409 STALE_WRITE).
export const dynamic = 'force-dynamic';

export const GET = schedulingRoute('scheduling.view', getSchedule);
export const PATCH = schedulingRoute('scheduling.manage', updateSchedule);
