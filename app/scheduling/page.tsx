import Overview from './_components/Overview';
import { resolveSchedulingPage } from './_components/pageAccess';

export const dynamic = 'force-dynamic';

export default async function SchedulingOverviewPage() {
  const { canManage, denied } = await resolveSchedulingPage();
  if (denied) return denied;
  return <Overview canManage={canManage} />;
}
