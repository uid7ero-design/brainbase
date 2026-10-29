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
