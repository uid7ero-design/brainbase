import { resolveSchedulingPage } from '../_components/pageAccess';
import SchedulesManager from '../_components/SchedulesManager';

export const dynamic = 'force-dynamic';

export default async function SchedulesPage() {
  const { canManage, denied } = await resolveSchedulingPage();
  if (denied) return denied;
  return <SchedulesManager canManage={canManage} />;
}
