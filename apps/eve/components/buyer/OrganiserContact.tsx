import { displayWebsite, organiserReference, publicOrganiserContact } from '@ticketing/core/publicOrganiser';

// The organiser's public contact on Eve buyer pages: their public display name
// (else "the event organiser") with the public email and website they chose to
// show. Rendered only when at least one is set; otherwise nothing. The values
// are re-checked through the shared allowlist (email shape, http(s) only), so
// only those two fields can ever reach the page. Eve support is separate (the
// buyer footer) and is never presented as the organiser.
export function OrganiserContact({ organiserName, contact, className = '' }: {
  organiserName: string | null | undefined;
  contact: { email?: unknown; website?: unknown } | null | undefined;
  className?: string;
}) {
  const safe = publicOrganiserContact({ publicEmail: contact?.email, website: contact?.website });
  if (!safe) return null;
  return (
    <section data-testid="organiser-contact" aria-label="Organiser contact" className={`rounded-[var(--radius-eve)] border border-eve-line bg-eve-surface p-4 text-sm ${className}`}>
      <p>Questions about this event? Contact <strong>{organiserReference(organiserName)}</strong></p>
      <ul className="mt-2 space-y-1">
        {safe.email ? (
          <li><a data-testid="organiser-contact-email" className="font-medium text-eve-accent underline" href={`mailto:${safe.email}`}>{safe.email}</a></li>
        ) : null}
        {safe.website ? (
          <li><a data-testid="organiser-contact-website" className="font-medium text-eve-accent underline" href={safe.website} target="_blank" rel="noopener noreferrer nofollow">{displayWebsite(safe.website)}</a></li>
        ) : null}
      </ul>
    </section>
  );
}
