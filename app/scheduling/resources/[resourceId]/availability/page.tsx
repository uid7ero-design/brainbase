import { resolveSchedulingPage } from '../../../_components/pageAccess';
import AvailabilityScreen from '../../../_components/AvailabilityScreen';

export const dynamic = 'force-dynamic';

export default async function ResourceAvailabilityPage({ params }: { params: Promise<{ resourceId: string }> }) {
  const { canManage, denied } = await resolveSchedulingPage();
  if (denied) return denied;
  const { resourceId } = await params;
  return <AvailabilityScreen kind="resource" id={resourceId} canManage={canManage} />;
}
