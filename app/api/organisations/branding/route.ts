import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden, roleGte } from '@/lib/org';
import { getOrganisationBranding, setOrganisationBranding, validateAccentColor, validateWebsite, validateLogoUrl, validateEmail, type OrganisationBranding } from '@/lib/organisations/branding';

// Organisation branding settings — admin+ only, matching Commercial's
// own precedent for "org-level configuration" (lib/commercial/
// authorize.ts's COMMERCIAL_MIN_ROLE.administer comment: "an
// organisation's OWN top-level user's job, not BrainBase staff's").
// Deliberately NOT gated behind requireCapability('events'/'commercial')
// — branding is a free, shared, cross-module capability, not a paid
// module entitlement (see this phase's own explicit "no Events
// capability gate, no Commercial capability gate" instruction, and
// lib/organisations/branding.ts's own header comment on why the model
// layer itself never resolves auth). A single role floor for both GET
// and PUT, unlike Commercial's own view/administer split — a dedicated
// branding settings page has no "read-only browsing" use case distinct
// from the page existing at all.
//
// organisationId is NEVER read from the request body or any query
// param — only from requireSession()'s own DB-validated result, which
// already resolves a super_admin's org_override transparently (see
// lib/org.ts's own comment on this).

async function requireAdmin() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false as const, response: unauthorized() };
  }
  if (!roleGte(session.role, 'admin')) {
    return { ok: false as const, response: forbidden() };
  }
  return { ok: true as const, session };
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const result = await getOrganisationBranding(auth.session.organisationId);
  if (!result) return NextResponse.json({ error: 'Organisation not found.' }, { status: 404 });

  // organisationName is included as fallback CONTEXT for the settings
  // UI ("blank brand name falls back to X") — never raw settings JSON,
  // never any other organisation column (plan/status/stripe fields/etc).
  return NextResponse.json({ organisationName: result.organisationName, branding: result.branding });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  // Real, user-facing validation errors — matching this repo's own
  // validate*() convention (lib/events/validation.ts) — BEFORE ever
  // calling the write helper, which itself only coerces (never
  // rejects) per lib/organisations/branding.ts's own documented
  // contract. A route is exactly where that distinction says
  // rejection belongs.
  const accentColorError = validateAccentColor(body.accentColor);
  if (accentColorError) return NextResponse.json({ error: accentColorError }, { status: 400 });
  const websiteError = validateWebsite(body.website);
  if (websiteError) return NextResponse.json({ error: websiteError }, { status: 400 });
  const logoUrlError = validateLogoUrl(body.logoUrl);
  if (logoUrlError) return NextResponse.json({ error: logoUrlError }, { status: 400 });
  const emailError = validateEmail(body.email);
  if (emailError) return NextResponse.json({ error: emailError }, { status: 400 });

  // Every field is required-but-nullable on the wire, matching
  // setOrganisationBranding's own "caller submits the full current
  // form state" contract — a field simply absent from the request
  // body is treated the same as an explicit null (cleared), never as
  // "leave whatever was previously stored." This mirrors how the
  // settings UI itself always sends its complete current form state.
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  const branding: OrganisationBranding = {
    name: str(body.name),
    logoUrl: str(body.logoUrl),
    accentColor: str(body.accentColor),
    email: str(body.email),
    phone: str(body.phone),
    website: str(body.website),
    address: str(body.address),
    abn: str(body.abn),
    emailFooter: str(body.emailFooter),
    emailSenderName: str(body.emailSenderName),
  };

  await setOrganisationBranding(auth.session.organisationId, branding);

  // Re-read rather than echo the input back — returns the actual
  // sanitized/coerced/persisted value (e.g. an accent colour
  // normalized to lowercase), never merely what the client sent, so
  // the UI's post-save state always reflects DB truth.
  const result = await getOrganisationBranding(auth.session.organisationId);
  return NextResponse.json({ organisationName: result?.organisationName ?? null, branding: result?.branding ?? branding });
}
