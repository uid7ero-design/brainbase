import 'server-only';
import { randomUUID } from 'crypto';
import { put, del } from '@vercel/blob';
import { ALLOWED_ARTWORK_MIME_TYPES, type AllowedArtworkMimeType } from './artworkConstants';

// Event artwork object storage — Vercel Blob.
//
// This is the platform's own already-selected direction for durable
// file storage, not a new one introduced by this feature: see
// docs/architecture/decisions/0001-data-hub-ingestion-foundation.md §9
// ("no new vendor relationship... Private, immutable Vercel Blob
// storage is the selected direction"), written for a different future
// feature (Data Hub file ingestion) but framed as a platform-wide
// choice. This is simply the first feature to actually implement it.
//
// Divergence from that ADR worth noting explicitly: it frames Blob
// storage there as PRIVATE. Event artwork uses access: 'public' here
// instead, deliberately — its entire purpose is to render on the
// anonymous public booking page (app/e/[organisationSlug]/[eventSlug]);
// a private/authenticated-read object would defeat that. Data Hub's own
// future implementation, uploading internal business data rather than
// public marketing images, is a genuinely different use case and can
// still choose 'private' independently — nothing here constrains it.

const EXTENSION_BY_MIME: Record<AllowedArtworkMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Real magic-byte signature check. A multipart file part's declared
// Content-Type (and certainly its filename/extension) is not
// trustworthy on its own — a request can claim image/jpeg while
// carrying arbitrary bytes. This inspects the actual leading bytes of
// the uploaded buffer and returns the genuine type, or null if it
// matches none of the three allowed image formats' known signatures.
export function sniffImageMimeType(buffer: Buffer): AllowedArtworkMimeType | null {
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

// Vercel Blob's own public-blob hostname pattern
// (https://$storeId.public.blob.vercel-storage.com/$pathname — see the
// put() JSDoc shipped with @vercel/blob). Used to distinguish a
// BrainBase-managed uploaded object from an arbitrary external URL
// pasted under the prior interim (URL-reference-only) architecture,
// without adding a second metadata column just to track that
// distinction — reliable provider-URL recognition is sufficient here.
export function isManagedArtworkUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.public.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

export type UploadEventArtworkResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

// Uploads validated image bytes to Blob under a tenant/event-scoped,
// GENERATED key — never the caller's original filename — matching the
// events/<organisationId>/<eventId>/<generated-name> structure the
// implementation brief asked for. Both organisationId and eventId
// arguments must already be server-verified by the caller (the
// session's own organisationId, and an ownership-checked event row);
// this function trusts its arguments rather than re-deriving tenancy
// itself — see the artwork route's loadOwnedEvent for that check.
export async function uploadEventArtwork(
  organisationId: string,
  eventId: string,
  buffer: Buffer,
  mimeType: AllowedArtworkMimeType,
): Promise<UploadEventArtworkResult> {
  const ext = EXTENSION_BY_MIME[mimeType];
  const pathname = `events/${organisationId}/${eventId}/${randomUUID()}.${ext}`;
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
// isManagedArtworkUrl) — never attempts to delete a third-party URL.
// Failures are caught and logged, never thrown: an already-gone or
// momentarily-unreachable Blob object must never block clearing (or
// overwriting) the Event's own artwork_url reference to it. Callers
// must ensure DB state is already correct BEFORE calling this — see
// the artwork route's POST/DELETE handlers for the exact ordering.
export async function deleteEventArtworkIfManaged(url: string): Promise<void> {
  if (!isManagedArtworkUrl(url)) return;
  try {
    await del(url);
  } catch (err) {
    console.error('[events artwork] failed to delete Blob object (ignored — DB reference was already updated first)', err);
  }
}

export { ALLOWED_ARTWORK_MIME_TYPES };
