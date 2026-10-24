import { schedulingRoute } from '@/lib/scheduling/route';
import { archiveSchedule } from '@/lib/scheduling/config/schedules';

// Phase 2B.2b: archive a schedule (one-way).
export const dynamic = 'force-dynamic';

export const POST = schedulingRoute('scheduling.manage', archiveSchedule);
