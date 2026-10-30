// Buyer-facing organiser identity. The ONLY source is the organisation's
// configured public display name (organisations.settings.branding.name);
// the internal organisation name is never a fallback. Pure: callers pass
// the configured value in.
//
//   publicOrganiserName('  Riverlights Festival ')  -> 'Riverlights Festival'
//   publicOrganiserName(null | '' | '   ')         -> null
//   organiserReference(null)                       -> 'the event organiser'
//   organiserReference(null, { sentenceStart: true }) -> 'The event organiser'

export const NEUTRAL_ORGANISER_REFERENCE = 'the event organiser';

export function publicOrganiserName(configured: unknown): string | null {
  if (typeof configured !== 'string') return null;
  const name = configured.trim();
  return name === '' ? null : name;
}

// The organiser as named in a sentence: the public display name exactly as
// configured, else the neutral wording (capitalised only when it opens a
// sentence; a configured name is never re-cased).
export function organiserReference(configured: unknown, opts: { sentenceStart?: boolean } = {}): string {
  const name = publicOrganiserName(configured);
  if (name) return name;
  return opts.sentenceStart ? 'The event organiser' : NEUTRAL_ORGANISER_REFERENCE;
}

// Buyer-facing organiser contact: the organiser's explicitly PUBLIC email
// (settings.branding.publicEmail) and website, nothing else. Built from this
// two-field allowlist, never by trimming a wider object. There is no fallback:
// an unset or invalid value is simply absent, and with neither set there is
// no contact at all (null), so nothing is shown.
//
//   publicOrganiserContact({ publicEmail: ' Hi@Acme.example ', website: '' })
//     -> { email: 'hi@acme.example', website: null }
//   publicOrganiserContact({ website: 'javascript:alert(1)' }) -> null

export type PublicOrganiserContact = { email: string | null; website: string | null };

const PUBLIC_EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const MAX_PUBLIC_EMAIL_LENGTH = 254;
const MAX_PUBLIC_WEBSITE_LENGTH = 2048;

export function publicOrganiserEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email === '' || email.length > MAX_PUBLIC_EMAIL_LENGTH || !PUBLIC_EMAIL_RE.test(email)) return null;
  return email.toLowerCase();
}

// http(s) only, and it must parse as a URL with a host.
export function publicOrganiserWebsite(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const website = value.trim();
  if (website === '' || website.length > MAX_PUBLIC_WEBSITE_LENGTH || !/^https?:\/\/[^/\s]/i.test(website)) return null;
  try {
    const url = new URL(website);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
  } catch {
    return null;
  }
  return website;
}

export function publicOrganiserContact(input: { publicEmail?: unknown; website?: unknown } | null | undefined): PublicOrganiserContact | null {
  const email = publicOrganiserEmail(input?.publicEmail);
  const website = publicOrganiserWebsite(input?.website);
  return email || website ? { email, website } : null;
}

// The website as shown in text: without the scheme or a trailing slash.
export function displayWebsite(website: string): string {
  return website.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}
