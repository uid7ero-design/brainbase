import 'server-only';
import { randomUUID } from 'crypto';
import { put, del } from '@vercel/blob';
import { ALLOWED_LOGO_MIME_TYPES, type AllowedLogoMimeType } from './brandingLogoConstants';

// Organisation logo object storage — Vercel Blob. Deliberately a small,
// dedicated module rather than a generalized "all Blob uploads" helper:
// this codebase already has three independent Blob helpers (event
// artwork — lib/events/blobStorage.ts, Data Hub imports, organiser
// attachments), each scoped to its own feature with its own path/
// access-mode decisions; a fourth following the same shape is
// consistent with that established pattern, not a regression. Modeled
// line-for-line on lib/events/blobStorage.ts (magic-byte sniffing,
// managed-URL detection, generated-pathname-never-user-filename,
// best-effort delete) — see that file's own comments for the fuller
// rationale behind each of these choices, not repeated here.
//
// access: 'public' — deliberate, same reasoning as event artwork: an
// organisation logo's entire purpose (once a later phase actually
// renders it somewhere) is to appear on customer-facing surfaces; a
// private/authenticated-read object would defeat that. Nothing in THIS
// phase actually serves the logo publicly yet (no Events/ticket/email
// integration — see this phase's own explicit scope boundary), but the
// storage decision is made once, correctly, for how it will be used.

const EXTENSION_BY_MIME: Record<AllowedLogoMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Real magic-byte signature check — identical detection logic to
// lib/events/blobStorage.ts's sniffImageMimeType (JPEG/PNG/WebP only;
// SVG is deliberately never in this allow-list at all — an uploaded SVG
// can embed <script>/event-handler content, a well-known XSS vector
// this module avoids by construction rather than by sanitizing SVG
// input, which this phase does not attempt).
export function sniffLogoMimeType(buffer: Buffer): AllowedLogoMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && // "RIFF"
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50 // "WEBP"
  ) {
    return 'image/webp';
  }
  return null;
}

// Vercel Blob's own public-blob hostname pattern — see
// lib/events/blobStorage.ts's isManagedArtworkUrl for the identical
// reasoning: distinguishes a BrainBase-managed uploaded object from any
// other URL (e.g. a future "paste an externally-hosted logo URL"
// path, not built in this phase but the OrganisationBranding.logoUrl
// field already accepts any http(s) URL per Phase 1's own validation)
// without a second metadata column just to track that distinction.
export function isManagedLogoUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.public.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

export type UploadOrganisationLogoResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

// Uploads validated image bytes to Blob under a tenant-scoped, GENERATED
// key — never the caller's original filename — matching the
// organisations/<organisationId>/logo/<generated-name> structure this
// phase's own brief specifies. organisationId must already be
// server-verified by the caller (the authenticated session's own
// organisationId — see the logo route's own auth gate); this function
// trusts its argument rather than re-deriving tenancy itself.
export async function uploadOrganisationLogo(
  organisationId: string,
  buffer: Buffer,
  mimeType: AllowedLogoMimeType,
): Promise<UploadOrganisationLogoResult> {
  const ext = EXTENSION_BY_MIME[mimeType];
  const pathname = `organisations/${organisationId}/logo/${randomUUID()}.${ext}`;
  try {
    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType: mimeType,
      addRandomSuffix: false, // the uuid segment already guarantees uniqueness
    });
    return { ok: true, url: blob.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Upload failed.' };
  }
}

// Deletes a Blob object only if it is actually BrainBase-managed (see
// isManagedLogoUrl) — never attempts to delete a third-party URL.
// Failures are caught and logged, never thrown — an already-gone or
// momentarily-unreachable Blob object must never block the caller's
// own success path. Reused for BOTH "delete the old logo after a
// successful replace" and "clean up a newly-uploaded logo after a
// failed DB write" — the logo route's own comment explains which case
// is which; this function itself is agnostic to why it was called.
export async function deleteOrganisationLogoIfManaged(url: string): Promise<void> {
  if (!isManagedLogoUrl(url)) return;
  try {
    await del(url);
  } catch (err) {
    console.error('[organisation branding] failed to delete Blob logo object (ignored)', err);
  }
}

export { ALLOWED_LOGO_MIME_TYPES };
