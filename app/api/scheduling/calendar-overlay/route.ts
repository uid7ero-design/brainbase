import { schedulingRoute } from '@/lib/scheduling/route';
import { bookingOverlay } from '@/lib/scheduling/config/bookingOverlay';
import { calendarDeadlineMs } from '@/lib/scheduling/config/calendar';

// Phase 2C.2: the READ-ONLY booking overlay (committed sessions, slot bookings and the holds they own) for a calendar window. GET only. No customer data for any role.
export const dynamic = 'force-dynamic';

// A read with a bounded execution time (504 SCHEDULING_TIMEOUT, the calendar's deadline); it writes nothing, so answering "timed out" is always safe.
export const GET = schedulingRoute('scheduling.view', bookingOverlay, { deadlineMs: calendarDeadlineMs });
