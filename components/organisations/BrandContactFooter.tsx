// Organisation contact footer — presentation only, public-safe. Renders
// ONLY fields already present on PublicOrganisationBranding (see
// lib/organisations/branding.ts's own explicit allowlist: name, logoUrl,
// accentColor, website). Never accepts or renders email, phone, address,
// abn, emailFooter, or emailSenderName — those are legitimately private
// business/contact fields with no reason to appear on a public surface,
// and are not part of the public type this component's props are typed
// against, so passing them in is a compile-time error, not just a
// convention.
//
// Omits missing values rather than inventing BrainBase-owned contact
// details — an organisation with no configured website renders nothing
// here, never a fallback to BrainBase's own site/contact info.
//
// BrainBase's own "Powered by BrainBase" attribution is a SEPARATE
// concern, already rendered independently by each existing public page
// today (app/e/**, app/t/[token]/page.tsx, app/b/[bookingToken]/tickets/
// page.tsx) — this component does not render it and is not a
// replacement for it.
//
// Deliberately UNUSED by any page as of this PR (Phase 3A scope).

import type { PublicOrganisationBranding } from '@/lib/organisations/branding';

export type BrandContactFooterProps = {
  branding: PublicOrganisationBranding | null;
  organisationName: string;
};

export function BrandContactFooter({ branding, organisationName }: BrandContactFooterProps) {
  const displayName = branding?.name ?? organisationName;
  const website = branding?.website ?? null;

  return (
    <div style={{ fontSize: 12, color: 'rgba(226,232,240,.5)', textAlign: 'center' }}>
      <div>{displayName}</div>
      {website && (
        <a href={website} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
          {website}
        </a>
      )}
    </div>
  );
}
