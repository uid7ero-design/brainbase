import { schedulingRoute } from '@/lib/scheduling/route';
import { archiveOffering } from '@/lib/scheduling/config/offerings';

// Phase 2B.2b: archive an offering (one-way; reservations are untouched).
export const dynamic = 'force-dynamic';

export const POST = schedulingRoute('scheduling.manage', archiveOffering);
