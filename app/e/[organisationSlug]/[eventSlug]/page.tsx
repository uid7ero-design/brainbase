import { notFound } from 'next/navigation';
import { getPublicEventDetail } from '@/lib/events/publicEventDetail';
import PublicEventClient from './PublicEventClient';

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ organisationSlug: string; eventSlug: string }>;
}) {
  const { organisationSlug, eventSlug } = await params;
  const result = await getPublicEventDetail(organisationSlug, eventSlug);

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
