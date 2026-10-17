import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Unavailable } from '@/components/ui/primitives';

export default function OrganiserPaymentsPage() {
  return (
    <OrganiserShell title="Payments">
      <Unavailable
        title="Payments are not connected"
        detail="Connect a Stripe account, see payouts and refunds, and review the fee applied to each order. No Stripe account is linked in this product, and no live Stripe configuration exists in this phase."
      />
    </OrganiserShell>
  );
}
