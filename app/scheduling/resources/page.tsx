import { resolveSchedulingPage } from '../_components/pageAccess';
import ResourcesManager from '../_components/ResourcesManager';

export const dynamic = 'force-dynamic';

export default async function ResourcesPage() {
  const { canManage, denied } = await resolveSchedulingPage();
  if (denied) return denied;
  return <ResourcesManager canManage={canManage} />;
}
