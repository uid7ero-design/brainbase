import 'server-only';
import { randomUUID } from 'crypto';
import { put, del } from '@vercel/blob';
import { ALLOWED_AVATAR_MIME_TYPES, type AllowedAvatarMimeType } from './avatarConstants';

// User profile-avatar object storage — Vercel Blob. Deliberately a
// small, dedicated module rather than a generalized "all Blob uploads"
// helper — this codebase already has several independent Blob helpers,
// each scoped to its own feature (event artwork — lib/events/
// blobStorage.ts, organisation logos — lib/organisations/
// brandingStorage.ts, Data Hub imports, organiser attachments); a fifth
// following the same shape is consistent with that established
// pattern, not a regression. Modeled line-for-line on
// lib/organisations/brandingStorage.ts (itself modeled on
// lib/events/blobStorage.ts) — magic-byte sniffing, managed-URL
// detection by exact path-segment comparison, generated-pathname-never-
// caller-filename, best-effort delete — see that file's own comments
// for the fuller rationale behind each of these choices, not repeated
// here. Deliberately NOT copied organisation-specific assumptions:
// there is no "public-facing brand mark" reasoning here, just "a small
// image the authenticated chrome renders for its owner" — access is
// still 'public' because every existing avatar consumer (TopNav, the
// profile page itself) renders it via a plain <img src>, with no
// authenticated-fetch/signed-URL plumbing anywhere in this codebase to
// build on, exactly the same reasoning brandingStorage.ts's own header
// already documents for logos.
//
// access: 'public' — same reasoning as organisation logos and event
// artwork: an avatar is rendered via a plain <img src> from the
// authenticated chrome (TopNav) and the profile page itself; neither
// has any signed-URL/authenticated-fetch plumbing to build on, and a
// profile photo carries materially lower sensitivity than the tenant/
// business data this app otherwise protects.

const EXTENSION_BY_MIME: Record<AllowedAvatarMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Real magic-byte signature check — identical detection logic to
// lib/organisations/brandingStorage.ts's sniffLogoMimeType (JPEG/PNG/
// WebP only; SVG is deliberately never in this allow-list at all — an
// uploaded SVG can embed <script>/event-handler content, a well-known
// XSS vector this module avoids by construction rather than by
// sanitizing SVG input, which this phase does not attempt).
export function sniffAvatarMimeType(buffer: Buffer): AllowedAvatarMimeType | null {
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

// Vercel Blob's own public-blob hostname pattern, plus an EXACT
// path-segment comparison for the owning user id — never a substring/
// prefix test. Mirrors lib/organisations/brandingStorage.ts's own
// isManagedLogoUrl and its post-review security fix exactly: every
// user's avatar lives on the SAME public Blob store hostname, so
// hostname alone can never distinguish "my avatar" from "user abcd's
// avatar" when checking a user whose id happens to be a prefix of
// another (e.g. "abc" vs "abcd") — segments are compared for EQUALITY,
// never with startsWith/includes on the concatenated string.
export function isManagedAvatarUrl(url: string, userId: string): boolean {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.public.blob.vercel-storage.com')) return false;
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments.length === 4 && segments[0] === 'users' && segments[1] === userId && segments[2] === 'avatar';
  } catch {
    return false;
  }
}

export type UploadUserAvatarResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

// Uploads validated image bytes to Blob under a user-scoped, GENERATED
// key — never the caller's original filename — at
// users/<userId>/avatar/<generated-uuid>.<ext>. `userId` must already
// be server-verified by the caller (the authenticated session's own
// userId — see the avatar route's own auth gate, requireSession());
// this function trusts its argument rather than re-deriving identity
// itself, matching uploadOrganisationLogo's own identical contract. It
// must never be sourced from a query param, form field, filename, or
// client-supplied JSON.
export async function uploadUserAvatar(
  userId: string,
  buffer: Buffer,
  mimeType: AllowedAvatarMimeType,
): Promise<UploadUserAvatarResult> {
  const ext = EXTENSION_BY_MIME[mimeType];
  const pathname = `users/${userId}/avatar/${randomUUID()}.${ext}`;
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

// Deletes a Blob object only if it is actually BrainBase-managed AND
// belongs to THIS user (see isManagedAvatarUrl) — never attempts to
// delete a third-party URL, an organisation logo, or another user's
// managed object. `userId` must be the caller's own authenticated,
// session-derived id — this function trusts its argument rather than
// re-deriving identity itself, exactly like uploadUserAvatar above; it
// must never be sourced from request input. Failures are caught and
// logged, never thrown — an already-gone or momentarily-unreachable
// Blob object must never block the caller's own success path. Reused
// for BOTH "delete the old avatar after a successful replace" and
// "clean up a newly-uploaded avatar after a failed DB write" — the
// avatar route's own comment explains which case is which; this
// function itself is agnostic to why it was called.
export async function deleteUserAvatarIfManaged(url: string, userId: string): Promise<void> {
  if (!isManagedAvatarUrl(url, userId)) return;
  try {
    await del(url);
  } catch (err) {
    console.error('[account avatar] failed to delete Blob avatar object (ignored)', err);
  }
}

export { ALLOWED_AVATAR_MIME_TYPES };
