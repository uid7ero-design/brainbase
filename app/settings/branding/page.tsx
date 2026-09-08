import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/org';
import { getOrganisationBranding } from '@/lib/organisations/branding';
import BrandingSettingsClient from './BrandingSettingsClient';

// admin+ only — matches the API routes' own floor exactly (see
// app/api/organisations/branding/route.ts's own comment on why). Uses
// requireRole() directly (throws on failure) wrapped in try/catch, then
// redirects — matching the established page-level pattern this
// codebase already uses for role-gated Server Component pages (e.g.
// app/admin/orgs/page.tsx's own getSession()+redirect shape), rather
// than the throw-to-error-boundary behavior requireRole() is really
// designed for API routes. org_override is already resolved
// transparently inside requireRole()'s own requireSession() call — no
// special-casing needed here for a super_admin viewing/editing an
// impersonated organisation's branding.
export default async function BrandingSettingsPage() {
  let organisationId: string;
  try {
    ({ organisationId } = await requireRole('admin'));
  } catch {
    redirect('/');
  }

  const initial = await getOrganisationBranding(organisationId);

  return (
    <BrandingSettingsClient
      initialOrganisationName={initial?.organisationName ?? ''}
      initialBranding={initial?.branding ?? {
        name: null, logoUrl: null, accentColor: null, email: null, phone: null,
        website: null, address: null, abn: null, emailFooter: null, emailSenderName: null,
      }}
    />
  );
}
