import { resolveSchedulingPage } from '../../../_components/pageAccess';
import AvailabilityScreen from '../../../_components/AvailabilityScreen';

export const dynamic = 'force-dynamic';

export default async function OfferingAvailabilityPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { canManage, denied } = await resolveSchedulingPage();
  if (denied) return denied;
  const { offeringId } = await params;
  return <AvailabilityScreen kind="offering" id={offeringId} canManage={canManage} />;
}
