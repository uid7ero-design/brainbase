import { schedulingRoute } from '@/lib/scheduling/route';
import { coachingDates } from '@/lib/scheduling/config/coachingRoster';
export const dynamic = 'force-dynamic';
export const GET = schedulingRoute('scheduling.reserve', coachingDates);
