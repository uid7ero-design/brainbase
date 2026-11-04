import { schedulingRoute } from '@/lib/scheduling/route';
import { createReservation, findReservationByKey } from '@/lib/scheduling/booking/reservations';

// Phase 2C.3b: staff facility hire. 404 unless the SCHEDULING_STAFF_BOOKING kill switch is 'on' AND the session's organisation holds scheduling.staff_booking.
export const dynamic = 'force-dynamic';

export const POST = schedulingRoute('scheduling.reserve', createReservation, { feature: 'staff_booking' });
export const GET = schedulingRoute('scheduling.reserve', findReservationByKey, { feature: 'staff_booking', deadlineMs: () => 8000 });
