import { schedulingRoute } from '@/lib/scheduling/route';
import { createReservation, findReservationByKey } from '@/lib/scheduling/booking/reservations';

// Phase 2C.3b: staff facility hire. 404 unless the SCHEDULING_FACILITY_HIRE kill switch is 'on' AND the session's organisation holds scheduling.facility_hire (independent of the Coach controls SCHEDULING_STAFF_BOOKING / scheduling.staff_booking).
export const dynamic = 'force-dynamic';

export const POST = schedulingRoute('scheduling.reserve', createReservation, { feature: 'facility_hire' });
export const GET = schedulingRoute('scheduling.reserve', findReservationByKey, { feature: 'facility_hire', deadlineMs: () => 8000 });
