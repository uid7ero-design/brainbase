// Server-only configuration for talking to the ticketing API. Never import
// this from a client component (tests/boundary.test.ts enforces it): the
// shared secret must not reach a browser bundle. Not NEXT_PUBLIC.

export type ApiConfig = { baseUrl: string; secret: string };

export function readApiConfig(): ApiConfig | null {
  const baseUrl = process.env.TICKETING_API_BASE_URL?.trim().replace(/\/+$/, '');
  const secret = process.env.TICKETING_API_SECRET;
  if (!baseUrl || !secret) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
  } catch {
    return null;
  }
  return { baseUrl, secret };
}
