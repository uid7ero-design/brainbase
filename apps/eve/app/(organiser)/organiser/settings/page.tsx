import { OrganiserShell } from '@/components/organiser/OrganiserShell';
import { Card } from '@/components/ui/primitives';
import { ConnectPanel } from '@/components/organiser/PaymentParts';
import { Chip, Section, Rows, describeFee } from '@/components/organiser/SettingsParts';
import { product } from '@/config/product';
import { requireOrganiser } from '@/lib/organiserAuth';
import { identityOf } from '@/lib/identity';
import { loadEvents, loadSettings } from '@/lib/organiserData';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ event?: string }> };

const ROLE_ACCESS: Record<string, string> = {
  viewer: 'You can view every organiser page. Check-in actions need a manager.',
  manager: 'You can view every organiser page and run check-in.',
  admin: 'You can view every organiser page and run check-in.',
  super_admin: 'You can view every organiser page and run check-in, and switch organisation.',
};

// READ-ONLY: organisation, ticketing, payments-connection, fee, branding and
// access information as the ticketing API reports it. There is no Save
// control and no form that changes anything: the only form is a GET event
// picker for the fee view.
export default async function OrganiserSettingsPage({ searchParams }: Props) {
  const { event: requested } = await searchParams;
  const { token, session } = await requireOrganiser();
  const [events, s] = await Promise.all([loadEvents(token), loadSettings(token, { event: requested || undefined })]);
  const fee = s.fees.effective;
  const eventScope = s.fees.scope.event;
  const b = s.branding;
  return (
    <OrganiserShell title="Settings" identity={identityOf(session)}>
      <div className="max-w-4xl space-y-5">
        <p className="text-sm text-eve-muted">These settings are read-only here. Changing them is not available in Eve yet.</p>

        <Section id="organisation" title="Organisation" chip={<Chip>Read-only</Chip>}>
          <Rows rows={[
            ['Name', s.organisation.name],
            ['Address in links', s.organisation.slug],
          ]} />
        </Section>

        <Section id="ticketing" title="Ticketing" chip={<Chip tone={s.events_capability.enabled ? 'good' : 'warn'} testId="events-chip">{s.events_capability.enabled ? 'Events enabled' : 'Events not enabled'}</Chip>}>
          <Rows rows={[
            ['Events', s.events_capability.enabled ? 'Enabled for this organisation' : 'Not enabled'],
            ['Paid tickets', s.ticketing.paid_ticketing_available === null ? 'Unavailable right now' : s.ticketing.paid_ticketing_available ? 'Available' : 'Not available until a Stripe account that can take payments is connected'],
            ['Free events', 'Do not need a Stripe account'],
          ]} />
        </Section>

        <section data-testid="section-payments" aria-label="Payments and Stripe connection" className="space-y-2">
          <ConnectPanel connect={s.connect} />
        </section>

        <Section id="fees" title="Fees" chip={fee ? <Chip tone={fee.state === 'FEE' ? 'warn' : 'neutral'} testId="fee-chip">{fee.state === 'FEE' ? 'Fee configured' : 'No fee configured'}</Chip> : <Chip tone="warn">Unavailable</Chip>}>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="event" className="block text-sm font-medium">Show fees for</label>
              <select id="event" name="event" defaultValue={eventScope?.id ?? ''} className="mt-1 min-h-11 rounded-lg border border-eve-line bg-white px-3 text-sm">
                <option value="">Organisation default</option>
                {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <button type="submit" className="min-h-11 rounded-full border border-eve-line px-4 text-sm font-semibold">Show</button>
          </form>
          {fee === null ? (
            <p data-testid="fee-unavailable">The fee policy could not be read right now.</p>
          ) : fee.state === 'NO_FEE' ? (
            <div data-testid="fee-none">
              <p className="font-medium">No fee configured{eventScope ? ` for ${eventScope.name}` : ''}.</p>
              <p className="mt-1 text-eve-muted">
                {fee.reason === 'DISABLED'
                  ? `A fee policy exists at ${fee.source === 'EVENT' ? 'event' : 'organisation'} level but is switched off, so no fee is charged.`
                  : 'Nothing is configured for this organisation, so the platform default applies: no fee is charged on tickets.'}
              </p>
            </div>
          ) : (
            <div data-testid="fee-policy">
              <Rows rows={[
                ['Applies to', eventScope ? `${eventScope.name}${fee.source === 'ORGANISATION' ? ' (inherited from the organisation policy)' : ' (this event\'s own policy)'}` : 'Organisation default'],
                ['Fee', describeFee(fee)],
                ['Shown to buyers as', fee.label],
                ['Who pays', fee.paid_by === 'BUYER' ? 'The buyer pays it on top of the ticket price' : 'You absorb it: it is deducted from your ticket sales'],
                ['Currency', fee.currency],
              ]} />
            </div>
          )}
          {s.fees.event_overrides_count ? <p className="mt-3 text-eve-muted" data-testid="fee-overrides">{s.fees.event_overrides_count} event{s.fees.event_overrides_count === 1 ? ' has' : 's have'} its own fee policy that overrides the organisation default.</p> : null}
          <p className="mt-3 text-xs text-eve-muted">This is the policy that applies to new orders. Existing orders keep the fee they were placed with.</p>
        </Section>

        <Section id="branding" title="Buyer branding and communications" chip={<Chip tone={b.configured ? 'good' : 'neutral'} testId="branding-chip">{b.configured ? 'Configured' : 'Not configured'}</Chip>}>
          <Rows rows={[
            ['Display name', b.display_name_is_custom ? b.display_name : <span>{b.display_name} <span className="text-eve-muted">(using your organisation name)</span></span>],
            ['Logo', b.logo_configured ? 'Set' : 'Not set'],
            ['Accent colour', b.accent_color ?? <span className="text-eve-muted">Not set</span>],
            ['Website', b.website ?? <span className="text-eve-muted">Not set</span>],
            ['Support email', b.support_email ?? <span className="text-eve-muted">Not set</span>],
            ['Support phone', b.support_phone ?? <span className="text-eve-muted">Not set</span>],
            ['Email footer', b.email_footer ?? <span className="text-eve-muted">Not set</span>],
          ]} />
          <p className="mt-3 text-eve-muted" data-testid="product-identity-note">
            Orders placed through Eve are sent to buyers as Eve: Eve branding and Eve ticket links. Your display name and contact details above appear as the organiser.
          </p>
        </Section>

        <Section id="access" title="Access" chip={<Chip>{s.user.role}</Chip>}>
          <Rows rows={[['Signed in as', s.user.name], ['Role', s.user.role]]} />
          <p className="mt-3 text-eve-muted">{ROLE_ACCESS[s.user.role] ?? 'You can view the organiser pages.'}</p>
        </Section>

        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-muted">Product identity (read-only)</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-eve-muted">Product</dt><dd>{product.name}</dd>
            <dt className="text-eve-muted">Tagline</dt><dd>{product.tagline}</dd>
          </dl>
        </Card>
      </div>
    </OrganiserShell>
  );
}
