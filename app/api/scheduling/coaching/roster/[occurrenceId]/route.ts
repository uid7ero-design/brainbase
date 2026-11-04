import { schedulingRoute } from '@/lib/scheduling/route';
import { coachingRoster } from '@/lib/scheduling/config/coachingRoster';
export const dynamic = 'force-dynamic';
export const GET = schedulingRoute('scheduling.reserve', coachingRoster);
