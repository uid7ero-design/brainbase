import {schedulingRoute} from '@/lib/scheduling/route';
import {changeCoachingClass,savedCoachingClassChange} from '@/lib/scheduling/config/coachingLifecycle';
export const dynamic = 'force-dynamic';
export const POST = schedulingRoute('scheduling.manage', changeCoachingClass);
export const GET = schedulingRoute('scheduling.manage', savedCoachingClassChange);
