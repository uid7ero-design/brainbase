import { schedulingRoute } from '@/lib/scheduling/route';
import { cancelReservation } from '@/lib/scheduling/booking/reservations';

export const dynamic = 'force-dynamic';

export const POST = schedulingRoute('scheduling.reserve', cancelReservation, { feature: 'facility_hire' });
