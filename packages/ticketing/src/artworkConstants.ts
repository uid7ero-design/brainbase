// Shared, client-safe constants for event artwork uploads — no
// 'server-only' import here (unlike lib/events/blobStorage.ts) so both
// the upload route AND the backend edit-form UI can import the same
// allow-list/size-limit values instead of duplicating them.

export const ALLOWED_ARTWORK_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedArtworkMimeType = (typeof ALLOWED_ARTWORK_MIME_TYPES)[number];

export function isAllowedArtworkMimeType(value: string): value is AllowedArtworkMimeType {
  return (ALLOWED_ARTWORK_MIME_TYPES as readonly string[]).includes(value);
}

// No repo-wide image-size constant exists to reuse — the avatar upload
// route uses its own 3MB limit, the tennis blog cover-image route
// resizes down to a fixed 1200x800 webp regardless of input size. 5MB
// matches this task brief's own suggested default.
export const MAX_ARTWORK_BYTES = 5 * 1024 * 1024;
export const MAX_ARTWORK_MB = MAX_ARTWORK_BYTES / (1024 * 1024);

export const ARTWORK_ACCEPT_ATTR = ALLOWED_ARTWORK_MIME_TYPES.join(',');
