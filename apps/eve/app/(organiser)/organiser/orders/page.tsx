import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Unavailable } from '@/components/ui/primitives';
import { getTicketingGateway } from '@/lib/ticketing/gateway';

export default async function OrganiserOrdersPage() {
  const result = await getTicketingGateway().listOrganiserOrders();
  return (
    <OrganiserShell title="Orders">
      {result.status === 'ok' ? (
        <p>{result.data.length} orders</p>
      ) : (
        <Unavailable
          title="Orders are not connected"
          detail="Orders will list purchaser, status, payment status and total, with refund, cancel and retry actions and a CSV export. No orders are shown until connected."
        />
      )}
    </OrganiserShell>
  );
}
