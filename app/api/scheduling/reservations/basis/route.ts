import { schedulingRoute } from '@/lib/scheduling/route';
import { readReservationBasis } from '@/lib/scheduling/booking/basis';

// Phase 2C.3c-B: the staff-only availability basis for the booking form. GET only, behind BOTH booking gates (kill switch + organisation capability) and scheduling.reserve. A read: it
// writes nothing, so a deadline that answers "timed out" is always safe.
export const dynamic = 'force-dynamic';

export const GET = schedulingRoute('scheduling.reserve', readReservationBasis, { feature: 'facility_hire', deadlineMs: () => 8000 });
