import { resolveSchedulingPage } from '../../../_components/pageAccess';
import CalendarScreen from '../../../_components/CalendarScreen';
import { getFacilityHireContext } from '@/lib/scheduling/facilityHireVisibility';

export const dynamic = 'force-dynamic';

// Phase 2B.3d: the read-only availability calendar of one resource. The page checks access itself; the data comes from the calendar API.
export default async function ResourceCalendarPage({ params }: { params: Promise<{ resourceId: string }> }) {
  const { canManage, denied, timezone } = await resolveSchedulingPage();
  if (denied) return denied;
  const { resourceId } = await params;
  // Facility-hire booking: decided here, on the server, once. False unless the facility-hire switch, the organisation's scheduling.facility_hire capability and scheduling.reserve all hold (the Coach gate plays no part).
  // The recovery secret (reload recovery) is derived only when the facility-hire gate holds; with the switch off it is null and nothing is derived.
  const { canBook, recoverySecret } = await getFacilityHireContext();
  return <CalendarScreen kind="resource" id={resourceId} canManage={canManage} canBook={canBook} recoverySecret={recoverySecret} organisationTimezone={timezone} />;
}
