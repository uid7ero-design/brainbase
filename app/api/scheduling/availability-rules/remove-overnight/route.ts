import { schedulingRoute } from '@/lib/scheduling/route';
import { removeOvernightWindow } from '@/lib/scheduling/config/availability';

// Phase 2B.3c follow-up: remove both halves of an overnight window together (one statement; all or none).
export const dynamic = 'force-dynamic';

export const POST = schedulingRoute('scheduling.manage', removeOvernightWindow);
