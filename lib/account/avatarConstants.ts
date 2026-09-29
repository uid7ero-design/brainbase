// Shared, client-safe constants for account avatar uploads — no
// 'server-only' import here (unlike lib/account/avatarStorage.ts), so
// both the upload route AND the profile-page UI can import the same
// allow-list/size-limit values instead of duplicating them. Mirrors
// lib/organisations/brandingLogoConstants.ts's own split exactly.

export const ALLOWED_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedAvatarMimeType = (typeof ALLOWED_AVATAR_MIME_TYPES)[number];

export function isAllowedAvatarMimeType(value: string): value is AllowedAvatarMimeType {
  return (ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(value);
}

// GIF is deliberately dropped from the previous filesystem-based route's
// allow-list (this phase's own explicit instruction) — no existing
// requirement anywhere in this codebase depends on animated avatars, and
// dropping it narrows the magic-byte/validation surface to the same
// three formats every other Blob-backed image upload in this codebase
// already standardises on (see lib/organisations/brandingLogoConstants.ts,
// lib/events/artworkConstants.ts). SVG was never allowed and stays never
// allowed — see lib/account/avatarStorage.ts's own sniff function for why.
export const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3 MB — unchanged from the existing route's own established limit
export const MAX_AVATAR_MB = MAX_AVATAR_BYTES / (1024 * 1024);

export const AVATAR_ACCEPT_ATTR = ALLOWED_AVATAR_MIME_TYPES.join(',');
