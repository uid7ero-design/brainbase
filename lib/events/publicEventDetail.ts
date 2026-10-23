import 'server-only';
import sql from '@/lib/db';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { listActiveQuestions, type FieldType, type QuestionScope } from '@/lib/events/registrationQuestions';
import type { PublicOrganisationBranding } from '@/lib/organisations/branding';
import { resolveFeePolicy, publicFeeDisclosure, type PublicFeeDisclosure } from '@/lib/events/services/fees';

export type PublicSession = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  remaining: number;
};

export type PublicTicketType = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  capacity: number;
  remaining: number;
  // Phase 4 — sale window (ISO strings, NULL = unbounded), the server's
  // own on-sale verdict at response time, and whether the type needs an
  // access code. The server (lib/events/services/cart.ts and the
  // reservation gate) re-evaluates all of this at submit against the
  // database clock — these fields drive display only. A restricted type
  // is still LISTED (name/price/status) so the visitor knows an access
  // code exists; it cannot be purchased without one regardless of what
  // the UI shows (brief §6: "do not rely solely on hiding ticket types").
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  sale_status: 'COMING_SOON' | 'ON_SALE' | 'SALES_ENDED';
  requires_access_code: boolean;
};

// Phase 3 (ticket type × session inventory) — one row per (ticket type,
// session) pair that has a capacity OVERRIDE configured (see
// scripts/create-events-ticket-type-session-inventory.sql). A pair with
// no row here falls back to the ticket type's event-wide `remaining`
// above — the client applies exactly that precedence when a session is
// selected. `remaining` is this type's remaining places within THIS
// session only, under the same stale-hold predicate as every other
// remaining figure here.
export type PublicSessionInventory = {
  ticket_type_id: string;
  event_session_id: string;
  capacity: number;
  remaining: number;
};

// Phase 4B §5/§6 — the question DEFINITION (what to ask, and how) is
// itself public-safe: it's exactly the form the visitor is about to
// fill in. Never includes `active` (this list is already active-only,
// see listActiveQuestions) and never anything response-shaped —
// answers/responses are never part of this public detail fetch at all
// (§6: never expose one registrant's answers to another, or to an
// anonymous visitor who hasn't submitted anything).
export type PublicQuestion = {
  id: string;
  label: string;
  help_text: string | null;
  field_type: FieldType;
  required: boolean;
  scope: QuestionScope;
  options: string[] | null;
  sort_order: number;
  // Whether the organiser marked answers as possibly sensitive — drives
  // the acknowledgement Eve shows. Part of the definition, not an answer.
  sensitive: boolean;
};

export type PublicEventDetail = {
  event: {
    name: string;
    slug: string;
    description: string | null;
    venue: string | null;
    // Externally-hosted image URL — approved public-safe field, see
    // scripts/add-events-artwork.sql and PublicEvent's own comment.
    artwork_url: string | null;
    starts_at: string;
    ends_at: string;
    timezone: string;
  };
  sessions: PublicSession[];
  ticket_types: PublicTicketType[];
  // Override pairs only — see PublicSessionInventory.
  session_inventory: PublicSessionInventory[];
  questions: PublicQuestion[];
  // Phase 4 — whether at least one promotion code is currently live for
  // this event (active, inside its window). Drives only whether the
  // "promotional code" input is shown; never which codes exist.
  has_promotions: boolean;
  // Phase 5A — the PASS_THROUGH booking fee the purchaser will pay on a
  // paid selection (label + the integer inputs, so the page can show the
  // fee for a selection before any quote), or null when no fee applies to
  // this event or the fee is ABSORBED by the organiser (never a purchaser
  // fact). Never the policy id, version or tax metadata. The server
  // recomputes and snapshots the authoritative figure at checkout.
  booking_fee: PublicFeeDisclosure | null;
  // Public-safe view model only (lib/organisations/branding.ts's own
  // explicit allowlist) — never organisationId, never raw settings.
  branding: PublicOrganisationBranding;
  // The organisation's own plain name (organisations.name) — already
  // public-safe precedent elsewhere (e.g. the Events hub page's own H1
  // uses this same column directly). Render-layer fallback source for
  // branding.name when an organisation hasn't configured a display name
  // (see lib/organisations/branding.ts's normalisePublicOrganisationBranding
  // comment on why this substitution is deliberately NOT done inside the
  // branding module itself).
  organisationName: string;
};

// eveQuestionsEnabled sits beside `detail`, not inside it: only the Eve
// event read uses it (to decide whether Eve shows the questions), and it is
// never part of the public body as such.
export type PublicEventDetailResult =
  | { ok: true; detail: PublicEventDetail; eveQuestionsEnabled: boolean }
  | { ok: false };

// Shared by both the public API route and the public page's own
// server-side fetch, so the "which fields are safe to expose publicly"
// decision lives in exactly one place. Deliberately returns only:
// event name/description/venue/start/end/timezone, and per session/
// ticket-type: name, capacity, remaining availability, and (for ticket
// types) description/price. Never returns organisation internal ids,
// created_by, attendee lists, purchaser data, or internal status
// metadata — see this file's own field lists, which are the exhaustive
// allow-list, not a redaction of a wider row.
//
// "remaining" is computed by subtracting the sum of quantities from
// active (non-CANCELLED) event_order_items against that row's id — a
// read-only estimate for display purposes. It is NOT the mechanism that
// enforces capacity; that is the FOR UPDATE-gated write path in the
// register route. A remaining count read here can be stale by the time
// a registration is submitted (by design — capacity correctness is a
// write-time, not a read-time, guarantee), and is clamped to a minimum
// of 0 for display even if a legacy discrepancy ever produced a
// negative value.
//
// Both "remaining" expressions below are explicitly cast to ::int.
// Root cause of a real bug this fixes: Postgres's SUM(int) returns
// bigint, so tt.capacity - COALESCE(SUM(...), 0) is bigint arithmetic
// throughout, and GREATEST(bigint, 0) is itself bigint. The Neon
// serverless driver returns bigint columns as JS strings (not numbers)
// by default, since not every bigint value round-trips safely through
// a JS number — so `remaining` was a STRING at runtime despite
// PublicTicketType/PublicSession's own `remaining: number` type lying
// about it. That silently turned PublicEventClient's
// `.reduce((sum, t) => sum + t.remaining, 0)` into STRING
// CONCATENATION (0 + "280" + "147" -> "0280147", not 427) — the exact
// malformed "0280147 places remaining" defect this pass was asked to
// investigate. Casting to ::int here makes the driver return a real
// JS number, fixing the type at its source for every caller, not just
// the one call site that happened to reduce() over it.
export async function getPublicEventDetail(
  organisationSlug: string,
  eventSlug: string,
): Promise<PublicEventDetailResult> {
  const resolved = await resolvePublicEvent(organisationSlug, eventSlug);
  if (!resolved.ok) return { ok: false };
  const { organisationId, organisationName, event, branding } = resolved;

  // Phase 4: the sold-quantity subtraction now also excludes a pending
  // paid reservation whose expires_at has passed — mirroring exactly
  // the same predicate the paid checkout route's own capacity-gated
  // transaction uses to decide what actually blocks a new reservation
  // (see that route's comment). This is a read-only display estimate
  // (see this function's own header comment on "remaining" already);
  // keeping the two predicates identical just means the number shown
  // here doesn't visibly disagree with what the write path will do a
  // moment later.
  const [sessionRows, ticketTypeRows, inventoryRows, questionRows, promotionRows, feeResolution] = await Promise.all([
    sql`
      SELECT
        es.id, es.name, es.starts_at, es.ends_at, es.capacity,
        GREATEST(
          es.capacity - COALESCE((
            SELECT SUM(oi.quantity)
            FROM event_order_items oi
            JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
            WHERE oi.event_session_id = es.id AND oi.organisation_id = ${organisationId}
              AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
          ), 0),
          0
        )::int AS remaining
      FROM event_sessions es
      WHERE es.event_id = ${event.id} AND es.organisation_id = ${organisationId}
      ORDER BY es.starts_at
    `,
    // Phase 4 — sale_status is the DATABASE's verdict at NOW() (the same
    // half-open rule the reservation gate enforces); SOLD_OUT and
    // ACCESS_REQUIRED are client-side refinements of ON_SALE (see
    // lib/events/saleWindow.ts). Restricted types are listed, not hidden.
    sql`
      SELECT
        tt.id, tt.name, tt.description, tt.price_cents, tt.capacity,
        GREATEST(
          tt.capacity - COALESCE((
            SELECT SUM(oi.quantity)
            FROM event_order_items oi
            JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
            WHERE oi.ticket_type_id = tt.id AND oi.organisation_id = ${organisationId}
              AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
          ), 0),
          0
        )::int AS remaining,
        tt.sale_starts_at, tt.sale_ends_at, tt.requires_access_code,
        CASE
          WHEN tt.sale_starts_at IS NOT NULL AND tt.sale_starts_at > NOW() THEN 'COMING_SOON'
          WHEN tt.sale_ends_at IS NOT NULL AND tt.sale_ends_at <= NOW() THEN 'SALES_ENDED'
          ELSE 'ON_SALE'
        END AS sale_status
      FROM event_ticket_types tt
      WHERE tt.event_id = ${event.id} AND tt.organisation_id = ${organisationId} AND tt.active = true
      ORDER BY tt.sort_order, tt.created_at
    `,
    // Phase 3 — per-(type, session) override rows for this event's ACTIVE
    // ticket types; "sold" here is narrowed to the pair itself, matching
    // the reservation gate's own pair-filtered aggregate. Same ::int cast
    // rationale as the two expressions above.
    sql`
      SELECT
        inv.ticket_type_id, inv.event_session_id, inv.capacity,
        GREATEST(
          inv.capacity - COALESCE((
            SELECT SUM(oi.quantity)
            FROM event_order_items oi
            JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
            WHERE oi.ticket_type_id = inv.ticket_type_id AND oi.event_session_id = inv.event_session_id AND oi.organisation_id = ${organisationId}
              AND eo.status <> 'CANCELLED' AND (eo.payment_status <> 'PENDING' OR eo.expires_at > NOW())
          ), 0),
          0
        )::int AS remaining
      FROM event_ticket_type_session_inventory inv
      JOIN event_ticket_types tt ON tt.id = inv.ticket_type_id AND tt.organisation_id = inv.organisation_id AND tt.active = true
      WHERE inv.event_id = ${event.id} AND inv.organisation_id = ${organisationId}
    `,
    listActiveQuestions(organisationId, event.id),
    // Phase 4 — existence only, never the codes themselves.
    sql`
      SELECT 1 AS live FROM event_promotion_codes pc
      WHERE pc.event_id = ${event.id} AND pc.organisation_id = ${organisationId} AND pc.active = true
        AND (pc.starts_at IS NULL OR pc.starts_at <= NOW()) AND (pc.ends_at IS NULL OR pc.ends_at > NOW())
      LIMIT 1
    `,
    // Phase 5A — the fee policy that applies to this event (event row >
    // organisation row > none). A malformed row must not take the public
    // page down: it is reported as "no fee" here (display only) and the
    // checkout itself fails closed on it.
    resolveFeePolicy(organisationId, event.id).catch(err => {
      console.error('[public event detail] fee policy could not be interpreted; hiding the fee from the page', err);
      return { policy: null, source: 'PLATFORM_DEFAULT' as const };
    }),
  ]);

  const toIsoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
  const ticketTypes = (ticketTypeRows as unknown as PublicTicketType[]).map(t => ({
    ...t,
    sale_starts_at: toIsoOrNull(t.sale_starts_at),
    sale_ends_at: toIsoOrNull(t.sale_ends_at),
    requires_access_code: t.requires_access_code === true,
  }));

  return {
    ok: true,
    detail: {
      event: {
        name: event.name,
        slug: event.slug,
        description: event.description,
        venue: event.venue,
        artwork_url: event.artwork_url,
        starts_at: new Date(event.starts_at).toISOString(),
        ends_at: new Date(event.ends_at).toISOString(),
        timezone: event.timezone,
      },
      sessions: sessionRows as unknown as PublicSession[],
      ticket_types: ticketTypes,
      session_inventory: inventoryRows as unknown as PublicSessionInventory[],
      questions: questionRows.map(q => ({
        id: q.id, label: q.label, help_text: q.help_text, field_type: q.field_type,
        required: q.required, scope: q.scope, options: q.options, sort_order: q.sort_order, sensitive: q.sensitive === true,
      })),
      has_promotions: promotionRows.length > 0,
      booking_fee: publicFeeDisclosure(feeResolution.policy),
      branding,
      organisationName,
    },
    eveQuestionsEnabled: event.eve_questions_enabled === true,
  };
}
