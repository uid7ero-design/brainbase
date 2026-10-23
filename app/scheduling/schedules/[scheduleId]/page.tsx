import { resolveSchedulingPage } from '../../_components/pageAccess';
import ScheduleDetail from '../../_components/ScheduleDetail';

export const dynamic = 'force-dynamic';

export default async function ScheduleDetailPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  const { canManage, denied } = await resolveSchedulingPage();
  if (denied) return denied;
  const { scheduleId } = await params;
  return <ScheduleDetail scheduleId={scheduleId} canManage={canManage} />;
}
