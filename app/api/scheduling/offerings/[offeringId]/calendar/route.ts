import { schedulingRoute } from '@/lib/scheduling/route';
import { calendarDeadlineMs, offeringCalendar } from '@/lib/scheduling/config/calendar';

// Phase 2B.3d: the READ-ONLY availability calendar of one offering (its hours, its resources' hours, holds and free slots). GET only.
export const dynamic = 'force-dynamic';

// A read with a bounded execution time (504 SCHEDULING_TIMEOUT, see calendarDeadlineMs); it writes nothing, so answering "timed out" is always safe.
export const GET = schedulingRoute('scheduling.view', offeringCalendar, { deadlineMs: calendarDeadlineMs });
