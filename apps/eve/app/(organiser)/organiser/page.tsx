import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Card, Unavailable } from '@/components/ui/primitives';
import { TICKETING_CONCEPTS } from '@ticketing/core';

const LABELS: Record<(typeof TICKETING_CONCEPTS)[number], string> = {
  organiser: 'Organiser',
  venue: 'Venue',
  event: 'Event',
  session: 'Session / performance',
  ticket_type: 'Ticket type',
  inventory: 'Inventory',
  order: 'Order',
  attendee: 'Attendee',
  ticket: 'Ticket',
  payment: 'Payment',
};

export default function OrganiserDashboardPage() {
  return (
    <OrganiserShell title="Dashboard">
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Unavailable
          title="No organiser account is connected"
          detail="Once sign-in exists, this dashboard will show your upcoming sessions, sales to date and door status from the shared ticketing core. Nothing is shown until then — no sample figures."
        />
        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-muted">What the console manages</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {TICKETING_CONCEPTS.map(c => (
              <li key={c} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-eve-accent" />
                {LABELS[c]}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </OrganiserShell>
  );
}
