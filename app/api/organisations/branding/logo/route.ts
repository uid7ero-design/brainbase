import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden, roleGte } from '@/lib/org';
import { getOrganisationBranding, setOrganisationBranding } from '@/lib/organisations/branding';
import { MAX_LOGO_BYTES, isAllowedLogoMimeType } from '@/lib/organisations/brandingLogoConstants';
import { sniffLogoMimeType, uploadOrganisationLogo, deleteOrganisationLogoIfManaged } from '@/lib/organisations/brandingStorage';

// admin+ only — same floor as the branding settings route itself (see
// that file's own comment on why: org-level configuration, not a
// paid-module-gated action).

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

// POST — upload (or replace) the organisation's logo. multipart/
// form-data with a single "file" field.
//
// Ordering (this phase's own explicit requirement — a deliberate
// divergence from lib/events/artworkConstants.ts's own artwork route,
// which does NOT clean up an orphaned Blob object on a post-upload DB
// failure, only logs it): validate -> upload new Blob -> write the DB
// link -> ONLY THEN delete the old managed logo. If the DB write
// itself fails after a successful upload, the newly-uploaded (now
// orphaned, since nothing references it) Blob object is cleaned up
// best-effort rather than left behind — this route can afford that
// extra step because, unlike event artwork, there is only ever one
// well-known field (branding.logoUrl) that could reference it, so the
// cleanup decision is unambiguous.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.session;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'File is empty.' }, { status: 400 });
  if (file.size > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: `File too large — max ${Math.round(MAX_LOGO_BYTES / (1024 * 1024))}MB.` }, { status: 400 });
  }
  if (!isAllowedLogoMimeType(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, or WebP images are allowed.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Never trust the declared Content-Type (or filename/extension)
  // alone — inspect the actual bytes, and reject outright (not
  // "silently correct") a declared-vs-sniffed mismatch, matching
  // lib/events artwork's own identical discipline.
  const sniffed = sniffLogoMimeType(buffer);
  if (!sniffed) {
    return NextResponse.json({ error: 'File content does not match an allowed image type.' }, { status: 400 });
  }
  if (sniffed !== file.type) {
    return NextResponse.json({ error: 'File content does not match its declared type.' }, { status: 400 });
  }

  // Read the CURRENT branding first — needed both to know what old
  // logo (if any) to clean up afterward, and because
  // setOrganisationBranding takes a complete branding object, not a
  // single-field patch (see that function's own comment).
  const before = await getOrganisationBranding(organisationId);
  if (!before) return NextResponse.json({ error: 'Organisation not found.' }, { status: 404 });
  const previousLogoUrl = before.branding.logoUrl;

  const uploadResult = await uploadOrganisationLogo(organisationId, buffer, sniffed);
  if (!uploadResult.ok) {
    console.error('[organisation branding] logo upload failed', uploadResult.error);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 502 });
  }

  // The new object is durably stored BEFORE branding.logoUrl is
  // touched — a DB failure past this point leaves the PREVIOUS logo
  // fully intact; only the new (as-yet-unreferenced) upload becomes
  // an orphan, which is exactly what the cleanup below removes.
  try {
    await setOrganisationBranding(organisationId, { ...before.branding, logoUrl: uploadResult.url });
  } catch (err) {
    console.error('[organisation branding] DB link failed after a successful logo upload — cleaning up the orphaned object', uploadResult.url, err);
    await deleteOrganisationLogoIfManaged(uploadResult.url);
    return NextResponse.json({ error: 'Upload succeeded but could not be saved. Please try again.' }, { status: 500 });
  }

  // Only now — after the new logo is safely stored AND branding.logoUrl
  // points at it — remove whatever it replaced, and only if that was
  // itself a BrainBase-managed object. An externally-pasted logo URL
  // (branding.logoUrl accepts any http(s) URL per Phase 1's own
  // validation, even though no UI for pasting one exists in this
  // phase) is never deleted — this app never owned that content.
  if (previousLogoUrl && previousLogoUrl !== uploadResult.url) {
    await deleteOrganisationLogoIfManaged(previousLogoUrl);
  }

  return NextResponse.json({ logoUrl: uploadResult.url }, { status: 200 });
}

// DELETE — clear the organisation's logo. Clears branding.logoUrl
// FIRST, then best-effort deletes the underlying Blob object only if
// it was BrainBase-managed — never the reverse, so a delete failure
// can never leave branding pointing at a now-gone object. An
// externally-pasted URL is simply forgotten, never "deleted".
export async function DELETE() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.session;

  const before = await getOrganisationBranding(organisationId);
  if (!before) return NextResponse.json({ error: 'Organisation not found.' }, { status: 404 });
  const previousLogoUrl = before.branding.logoUrl;

  if (!previousLogoUrl) {
    return NextResponse.json({ logoUrl: null }, { status: 200 });
  }

  await setOrganisationBranding(organisationId, { ...before.branding, logoUrl: null });

  await deleteOrganisationLogoIfManaged(previousLogoUrl);

  return NextResponse.json({ logoUrl: null }, { status: 200 });
}
