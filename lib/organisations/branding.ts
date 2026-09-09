import sql from '@/lib/db';

// Organisation Branding — Phase 1 (shared server model only, no UI, no
// Events/Commercial integration yet — see the architecture audit this
// implements). Storage: organisations.settings.branding, a namespaced
// key on the EXISTING `settings JSONB NOT NULL DEFAULT '{}'` column
// (prisma/schema.prisma's Organisation model), sibling to
// lib/commercial/businessProfile.ts's own `settings.commercial` key —
// same column, different top-level namespace. No new table, no new
// column, no migration: this file's read path is modeled directly on
// businessProfile.ts's own proven coerce-never-throw discipline
// (defensive COALESCE against a NULL settings value even though the
// schema nominally says NOT NULL); its write path is actually simpler
// than businessProfile.ts's own — see setOrganisationBranding's own
// comment for why this namespace doesn't need a read-merge-write step.
//
// Deliberately does NOT resolve organisationId, check a role, or touch
// a cookie/session anywhere in this file — every function takes an
// already-trusted organisationId from its caller, matching every other
// lib/commercial/*.ts and lib/events/public*.ts module's own boundary
// discipline. Auth (who may read/write branding) is a route-layer
// concern for a later phase, not this one.

export interface OrganisationBranding {
  name: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  abn: string | null;
  emailFooter: string | null;
  emailSenderName: string | null;
}

// The public-safe subset only — see getPublicOrganisationBranding's
// own comment for the exact reasoning behind excluding every other
// field.
export interface PublicOrganisationBranding {
  name: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  website: string | null;
}

const EMPTY_BRANDING: OrganisationBranding = {
  name: null,
  logoUrl: null,
  accentColor: null,
  email: null,
  phone: null,
  website: null,
  address: null,
  abn: null,
  emailFooter: null,
  emailSenderName: null,
};

// ── Length caps ──────────────────────────────────────────────────────
// Each tied to where the field actually renders, not an arbitrary
// round number — see each constant's own comment. None of these are
// enforced as a hard validation failure for name/phone/address/abn/
// emailFooter/emailSenderName (free text just gets trimmed and
// truncated, never rejected) — only accentColor/website/email have a
// genuine "invalid, not just long" concept, handled by the validate*
// functions below instead.
const MAX_NAME_LENGTH = 120; // a business/display name — generous for any real org name, short enough for a ticket header or email "From" display name
const MAX_SHORT_TEXT_LENGTH = 200; // phone/abn — no real-world value approaches this; a large margin over any legitimate format
const MAX_EMAIL_LENGTH = 254; // RFC 5321's own maximum total mailbox length
const MAX_URL_LENGTH = 2048; // the de facto safe URL length ceiling most browsers/servers already assume (used for both website and logoUrl)
const MAX_ADDRESS_LENGTH = 500; // a few lines of postal address, comfortably
const MAX_EMAIL_FOOTER_LENGTH = 1000; // a short paragraph-length signoff, not a document

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

// Strict 3- or 6-digit hex only (with or without a leading '#'),
// normalized to a lowercase 6-digit '#rrggbb' form. Anything else
// (a named colour, rgb(), an out-of-range value, garbage) coerces to
// null rather than being stored malformed — this module never stores
// a value it cannot itself safely re-emit into inline CSS/HTML later.
function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(trimmed);
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split('').map(c => c + c).join('') : match[1];
  return `#${hex.toLowerCase()}`;
}

// http(s)-only, matching lib/events/validation.ts's own validateArtworkUrl
// precedent exactly (same reasoning: never store a javascript:/data:/
// other-scheme value that could be rendered as an href/src later).
function normalizeUrl(value: unknown, maxLength: number): string | null {
  const trimmed = normalizeText(value, maxLength);
  if (!trimmed) return null;
  return /^https?:\/\/.+/i.test(trimmed) ? trimmed : null;
}

// Basic shape only — "contains an @ with something on both sides and
// a dot in the domain part". Deliberately not RFC-5322-exhaustive per
// the brief's own "basic format validation only" instruction.
const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(value: unknown): string | null {
  const trimmed = normalizeText(value, MAX_EMAIL_LENGTH);
  if (!trimmed) return null;
  return BASIC_EMAIL_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

// ── Validation (route-facing) ────────────────────────────────────────
// Each returns an error message string if genuinely invalid, or null
// if acceptable (empty/absent is always acceptable — every branding
// field is optional) — matching lib/events/validation.ts's own
// validate*() return-shape convention exactly, so a future route can
// reuse these directly to produce a 400 before ever calling
// setOrganisationBranding. setOrganisationBranding itself never calls
// these — it always coerces instead (see sanitizeForWrite) so this
// low-level module can never throw or reject a write; rejecting bad
// input is the route layer's job, once it exists.

export function validateAccentColor(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return 'Accent colour must be a string.';
  if (!normalizeAccentColor(value)) return 'Accent colour must be a hex value like #8A4DFF.';
  return null;
}

export function validateWebsite(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return 'Website must be a string.';
  if (value.length > MAX_URL_LENGTH) return 'Website URL is too long.';
  if (!/^https?:\/\/.+/i.test(value.trim())) return 'Website must start with http:// or https://.';
  return null;
}

export function validateLogoUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return 'Logo URL must be a string.';
  if (value.length > MAX_URL_LENGTH) return 'Logo URL is too long.';
  if (!/^https?:\/\/.+/i.test(value.trim())) return 'Logo URL must start with http:// or https://.';
  return null;
}

export function validateEmail(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return 'Email must be a string.';
  if (value.length > MAX_EMAIL_LENGTH) return 'Email is too long.';
  if (!BASIC_EMAIL_RE.test(value.trim())) return 'A valid email address is required.';
  return null;
}

// ── Coercion (internal — always safe, never throws) ─────────────────

// Used by getOrganisationBranding: turns whatever is actually stored
// (possibly missing, possibly malformed from a future hand-edit or a
// schema drift) into a fully-typed, safe-to-render object. Mirrors
// businessProfile.ts's own coerceProfile() discipline: any field of
// the wrong shape silently becomes null rather than throwing or
// propagating a malformed value — a corrupted branding namespace must
// never break every other feature that reads it.
function coerceBranding(raw: unknown): OrganisationBranding {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_BRANDING };
  const r = raw as Record<string, unknown>;
  return {
    name: normalizeText(r.name, MAX_NAME_LENGTH),
    logoUrl: normalizeUrl(r.logoUrl, MAX_URL_LENGTH),
    accentColor: normalizeAccentColor(r.accentColor),
    email: normalizeEmail(r.email),
    phone: normalizeText(r.phone, MAX_SHORT_TEXT_LENGTH),
    website: normalizeUrl(r.website, MAX_URL_LENGTH),
    address: normalizeText(r.address, MAX_ADDRESS_LENGTH),
    abn: normalizeText(r.abn, MAX_SHORT_TEXT_LENGTH),
    emailFooter: normalizeText(r.emailFooter, MAX_EMAIL_FOOTER_LENGTH),
    emailSenderName: normalizeText(r.emailSenderName, MAX_NAME_LENGTH),
  };
}

// Used by setOrganisationBranding: the same coercion applied to
// caller-supplied input before it is ever written to the database —
// so a write can never persist an over-length string, a malformed
// hex colour, or a non-http(s) URL, regardless of whether the caller
// validated first. This is a defensive last line, not a substitute
// for a route calling validate*() to give the user a helpful error —
// invalid input here is silently dropped (stored as null), never
// rejected, matching this module's "never throw" contract.
function sanitizeForWrite(input: OrganisationBranding): OrganisationBranding {
  return coerceBranding(input as unknown as Record<string, unknown>);
}

// ── Normalise (pure — no DB access) ──────────────────────────────────

export type OrganisationBrandingResult = { organisationName: string; branding: OrganisationBranding };

// Pure counterpart to getOrganisationBranding — same coercion, same
// {organisationName, branding} result shape, but takes an already-
// loaded organisations.settings value (and the organisation's own
// already-loaded name) instead of querying for them itself. Exists so a
// caller that already has both in hand (every existing public resolver
// in this codebase — resolvePublicEvent, getPublicTicketDetail,
// getPublicBookingDetail — already selects organisations.name alongside
// whatever else it needs) can normalise branding in-process, with zero
// extra DB round trip, rather than being forced into a second
// getOrganisationBranding query just to reuse this module's own
// coercion logic. Takes rawSettings (the whole organisations.settings
// value, not a pre-extracted .branding) and performs the
// settings.branding extraction internally — mirrors exactly what
// getOrganisationBranding itself does below, which now delegates here.
export function normaliseOrganisationBranding(rawSettings: unknown, organisationName: string): OrganisationBrandingResult {
  const settings = (rawSettings ?? {}) as Record<string, unknown>;
  const branding = (settings && typeof settings === 'object' ? settings.branding : null) ?? null;
  return { organisationName, branding: coerceBranding(branding) };
}

// ── Read ──────────────────────────────────────────────────────────────

// Returns null only if the organisation itself does not exist — never
// throws solely because branding is absent, malformed, or the
// settings column is unexpectedly NULL. Every unrelated settings
// namespace (settings.commercial, or anything else) is left completely
// untouched by this function — it only ever reads settings.branding.
export async function getOrganisationBranding(organisationId: string): Promise<OrganisationBrandingResult | null> {
  const rows = (await sql`
    SELECT name, settings FROM organisations WHERE id = ${organisationId}
  `) as { name: string; settings: unknown }[];
  const org = rows[0];
  if (!org) return null;

  return normaliseOrganisationBranding(org.settings, org.name);
}

// ── Write ─────────────────────────────────────────────────────────────

// Replaces the ENTIRE `branding` namespace on organisations.settings in
// one atomic statement — this function takes a complete
// OrganisationBranding, not a partial patch (matching
// setBusinessProfile's own "caller submits the full current form
// state" convention), which is what makes "clear a field by passing
// null" unambiguous: there is no separate concept of "omitted" to
// confuse with "explicitly cleared" — every field is always present.
//
// Deliberately NO separate read-then-merge step, unlike
// businessProfile.ts's own setBusinessProfile: that function merges in
// application code because settings.commercial is itself a namespace
// with OTHER sibling sub-keys beside businessProfile that a naive
// jsonb_set('{commercial,businessProfile}', ...) could clobber (jsonb_set
// does not create a missing intermediate path element, and a two-level
// path replaces only that leaf — see that file's own comment). Here,
// `branding` has no such internal sub-keys to protect; this call always
// replaces the whole namespace, one level deep. A single
// jsonb_set(COALESCE(settings, '{}'::jsonb), '{wrongpath}', ..., true)
// already preserves every OTHER top-level sibling key (settings.
// commercial, or any future namespace) automatically — jsonb_set only
// ever touches the one path given — and does so as a single atomic
// UPDATE with no intervening read, so there is no read-modify-write
// race window against a concurrent write to a sibling namespace at all.
//
// organisations.updated_at is bumped, matching setBusinessProfile's
// own existing write pattern for this same column.
export async function setOrganisationBranding(organisationId: string, branding: OrganisationBranding): Promise<void> {
  const sanitized = sanitizeForWrite(branding);

  await sql`
    UPDATE organisations
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{branding}', ${JSON.stringify(sanitized)}::jsonb, true),
        updated_at = now()
    WHERE id = ${organisationId}
  `;
}

// ── Public projection ────────────────────────────────────────────────

// The ONLY public-safe read path — deliberately a separate function
// from getOrganisationBranding, not a filtered call to it, matching
// this codebase's existing getPublicEventDetail-vs-authenticated-query
// separation. Takes an already-resolved organisationId (never a slug,
// never anything read from client input) — every existing public
// resolver in this codebase (resolvePublicEvent, getPublicTicketDetail,
// getPublicBookingDetail) already establishes organisationId as the
// ONE trusted identifier public server code passes around; this
// function follows that same boundary rather than introducing a second
// one that resolves tenant identity from a slug itself.
//
// Explicit allowlist: name, logoUrl, accentColor, website only. Never
// email/phone/address/abn/emailFooter/emailSenderName (legitimately
// private business/contact details a public event or ticket page has
// no reason to render) — and never raw settings, plan, status, or any
// other organisation column. Returns null only if the organisation
// itself does not exist; every field inside a real result is
// independently nullable exactly like the private read path, so an
// organisation with no branding configured yields an all-null object,
// never an error.
//
// Deliberately does NOT substitute organisationName into the returned
// name field — branding.name is returned exactly as configured
// (possibly null), preserving this function's own existing contract.
// The organisation-name fallback (branding.name ?? organisationName) is
// a render-layer decision, left to each caller, matching how every
// other nullable field here already works (no logo → caller decides
// the no-logo treatment; no accent colour → caller decides the default
// palette).
function toPublicBranding(branding: OrganisationBranding): PublicOrganisationBranding {
  return {
    name: branding.name,
    logoUrl: branding.logoUrl,
    accentColor: branding.accentColor,
    website: branding.website,
  };
}

// Pure counterpart to getPublicOrganisationBranding — same allowlist,
// same result shape, but takes an already-loaded organisations.settings
// value instead of querying for it. See normaliseOrganisationBranding's
// own comment for the full rationale (every existing public resolver
// already has settings loaded; this avoids forcing a redundant second
// query just to reuse this module's own allowlist logic). organisationName
// is accepted for signature symmetry with normaliseOrganisationBranding
// and for callers that want it for their own fallback logic — it is not
// itself substituted into the returned name field (see toPublicBranding).
export function normalisePublicOrganisationBranding(rawSettings: unknown, organisationName: string): PublicOrganisationBranding {
  const { branding } = normaliseOrganisationBranding(rawSettings, organisationName);
  return toPublicBranding(branding);
}

export async function getPublicOrganisationBranding(organisationId: string): Promise<PublicOrganisationBranding | null> {
  const result = await getOrganisationBranding(organisationId);
  if (!result) return null;
  return toPublicBranding(result.branding);
}

// ── Email projection (Phase 3D — trusted, server-only) ──────────────

// A second, WIDER allow-list than PublicOrganisationBranding — safe
// ONLY because ticket-email generation is a trusted, server-side-only
// operation (lib/events/ticketEmail.ts) that never returns this shape
// to any client, API response, or public page. Adds emailFooter
// (an already-existing, already-normalised field on OrganisationBranding)
// on top of the same 4 public-safe fields — still deliberately excludes
// email/phone/address/abn, which remain private business-contact
// details with no ticket-email use case (see this file's own header
// comment on the private/public split). Deliberately excludes
// emailSenderName too: a sender display-name override was evaluated and
// explicitly DEFERRED (see lib/events/ticketEmail.ts's own comment) —
// this view-model exposes only fields the email template actually
// consumes today; emailSenderName remains on OrganisationBranding
// itself (persisted schema/settings UI unaffected) for a future phase
// to pick up once that decision is revisited.
export interface TicketEmailBranding {
  name: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  website: string | null;
  emailFooter: string | null;
}

function toTicketEmailBranding(branding: OrganisationBranding): TicketEmailBranding {
  return {
    name: branding.name,
    logoUrl: branding.logoUrl,
    accentColor: branding.accentColor,
    website: branding.website,
    emailFooter: branding.emailFooter,
  };
}

// Pure counterpart, same pattern as normalisePublicOrganisationBranding
// — takes an already-loaded organisations.settings value (the
// resend-ticket-email route already selects it alongside everything
// else that route needs, same zero-extra-round-trip discipline every
// other public/trusted resolver in this codebase already follows).
// organisationName is accepted for signature symmetry and is NOT
// substituted into the returned name field (see toPublicBranding's own
// comment — the render-layer fallback stays the caller's decision).
export function normaliseTicketEmailBranding(rawSettings: unknown, organisationName: string): TicketEmailBranding {
  const { branding } = normaliseOrganisationBranding(rawSettings, organisationName);
  return toTicketEmailBranding(branding);
}
