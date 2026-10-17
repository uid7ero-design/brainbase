import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Unavailable } from '@/components/ui/primitives';
import { requireOrganiser } from '@/lib/organiserAuth';
import { identityOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export default async function OrganiserPaymentsPage() {
  const { session } = await requireOrganiser();
  return (
    <OrganiserShell title="Payments" identity={identityOf(session)}>
      <Unavailable
        title="Payments are not connected"
        detail="Connecting a Stripe account, payouts, refunds and per-order fee review are not available in this product yet."
      />
    </OrganiserShell>
  );
}
