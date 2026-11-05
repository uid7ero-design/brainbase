import { schedulingRoute } from '@/lib/scheduling/route';
import { getReservation } from '@/lib/scheduling/booking/reservations';

export const dynamic = 'force-dynamic';

export const GET = schedulingRoute('scheduling.reserve', getReservation, { feature: 'staff_booking', deadlineMs: () => 8000 });
