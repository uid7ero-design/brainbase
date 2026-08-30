import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicUpcomingEvents } from '@/lib/events/publicEventsHub';
import PublicEventsHubClient from './PublicEventsHubClient';

type Params = { organisationSlug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { organisationSlug } = await params;
  const result = await getPublicUpcomingEvents(organisationSlug);
  if (!result.ok) return { title: 'Events' };
  return { title: `Events — ${result.organisationName}` };
}

// The reusable public events hub (§Step 4) — /e/[organisationSlug].
// Works for any BrainBase organisation with Events entitled; nothing
// here is specific to any one organisation. An organisation that
// doesn't exist, or doesn't have the Events capability, reaches the
// same not-found page as an unknown event slug does elsewhere in this
// module — resolvePublicEvent's own "never distinguish doesn't-exist
// from unavailable" discipline, applied consistently here too.
export default async function PublicEventsHubPage({ params }: { params: Promise<Params> }) {
  const { organisationSlug } = await params;
  const result = await getPublicUpcomingEvents(organisationSlug);
  if (!result.ok) notFound();

  return (
    <PublicEventsHubClient
      organisationSlug={organisationSlug}
      organisationName={result.organisationName}
      events={result.events}
    />
  );
}
