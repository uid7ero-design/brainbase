import { resolveSchedulingPage } from '../../../_components/pageAccess';
import CalendarScreen from '../../../_components/CalendarScreen';

export const dynamic = 'force-dynamic';

// Phase 2B.3d: the read-only availability calendar of one offering. The page checks access itself; the data comes from the calendar API.
export default async function OfferingCalendarPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { canManage, denied, timezone } = await resolveSchedulingPage();
  if (denied) return denied;
  const { offeringId } = await params;
  return <CalendarScreen kind="offering" id={offeringId} canManage={canManage} organisationTimezone={timezone} />;
}
