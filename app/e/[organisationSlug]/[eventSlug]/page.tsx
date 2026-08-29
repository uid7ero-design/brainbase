import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicEventDetail } from '@/lib/events/publicEventDetail';
import PublicEventClient from './PublicEventClient';

type Params = { organisationSlug: string; eventSlug: string };

// Request-scoped memoization only (React's built-in cache(), not a data
// change) — generateMetadata and the page body both need the same
// lookup; this collapses them into one fetch per request without
// touching lib/events/publicEventDetail.ts itself.
const getCachedEventDetail = cache(getPublicEventDetail);

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { organisationSlug, eventSlug } = await params;
  const result = await getCachedEventDetail(organisationSlug, eventSlug);
  if (!result.ok) return { title: 'Event not found' };
  return {
    title: result.detail.event.name,
    description: result.detail.event.description ?? undefined,
  };
}

export default async function PublicEventPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { organisationSlug, eventSlug } = await params;
  const result = await getCachedEventDetail(organisationSlug, eventSlug);

  // Draft/cancelled/nonexistent/cross-org-slug-pair all reach here the
  // same way (see resolvePublicEvent's own comment) — Next's standard
  // not-found page, no distinguishing detail.
  if (!result.ok) notFound();

  return (
    <PublicEventClient
      organisationSlug={organisationSlug}
      eventSlug={eventSlug}
      detail={result.detail}
    />
  );
}
