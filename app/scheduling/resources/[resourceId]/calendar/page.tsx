import { resolveSchedulingPage } from '../../../_components/pageAccess';
import CalendarScreen from '../../../_components/CalendarScreen';
import { getFacilityHireVisibility } from '@/lib/scheduling/facilityHireVisibility';

export const dynamic = 'force-dynamic';

// Phase 2B.3d: the read-only availability calendar of one resource. The page checks access itself; the data comes from the calendar API.
export default async function ResourceCalendarPage({ params }: { params: Promise<{ resourceId: string }> }) {
  const { canManage, denied, timezone } = await resolveSchedulingPage();
  if (denied) return denied;
  const { resourceId } = await params;
  // Staff booking (2C.3c slice 1): decided here, on the server, once. False unless the switch, the organisation capability and scheduling.reserve all hold.
  const canBook = await getFacilityHireVisibility();
  return <CalendarScreen kind="resource" id={resourceId} canManage={canManage} canBook={canBook} organisationTimezone={timezone} />;
}
