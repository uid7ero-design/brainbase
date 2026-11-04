import { schedulingRoute } from '@/lib/scheduling/route';
import { generateCoachingClasses, savedClassGeneration } from '@/lib/scheduling/config/coaching';
export const dynamic = 'force-dynamic';
export const POST = schedulingRoute('scheduling.manage', generateCoachingClasses);
export const GET = schedulingRoute('scheduling.manage', savedClassGeneration);
