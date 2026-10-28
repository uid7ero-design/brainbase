import { resolveSchedulingPage } from '../../../_components/pageAccess';
import CalendarScreen from '../../../_components/CalendarScreen';

export const dynamic = 'force-dynamic';

// Phase 2B.3d: the read-only availability calendar of one resource. The page checks access itself; the data comes from the calendar API.
export default async function ResourceCalendarPage({ params }: { params: Promise<{ resourceId: string }> }) {
  const { canManage, denied } = await resolveSchedulingPage();
  if (denied) return denied;
  const { resourceId } = await params;
  return <CalendarScreen kind="resource" id={resourceId} canManage={canManage} />;
}
