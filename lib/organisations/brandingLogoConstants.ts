// Shared, client-safe constants for organisation logo uploads — no
// 'server-only' import here (unlike lib/organisations/brandingStorage.ts),
// so both the upload route AND the settings-page UI can import the same
// allow-list/size-limit values instead of duplicating them. Mirrors
// lib/events/artworkConstants.ts's own split exactly.

export const ALLOWED_LOGO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedLogoMimeType = (typeof ALLOWED_LOGO_MIME_TYPES)[number];

export function isAllowedLogoMimeType(value: string): value is AllowedLogoMimeType {
  return (ALLOWED_LOGO_MIME_TYPES as readonly string[]).includes(value);
}

// 2MB, per this phase's own explicit requirement — smaller than event
// artwork's 5MB (lib/events/artworkConstants.ts): a logo is a small,
// repeatedly-rendered mark, not a poster/banner image.
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_MB = MAX_LOGO_BYTES / (1024 * 1024);

export const LOGO_ACCEPT_ATTR = ALLOWED_LOGO_MIME_TYPES.join(',');
