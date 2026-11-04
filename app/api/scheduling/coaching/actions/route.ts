import { schedulingRoute } from '@/lib/scheduling/route';
import { changeCoachingRoster, savedRosterAction } from '@/lib/scheduling/config/coachingRoster';
export const dynamic = 'force-dynamic';
export const POST = schedulingRoute('scheduling.reserve', changeCoachingRoster);
export const GET = schedulingRoute('scheduling.reserve', savedRosterAction);
