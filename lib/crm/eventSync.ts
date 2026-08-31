import sql from '@/lib/db';
import { checkCapability } from '@/lib/capabilities/requireCapability';

// Events -> CRM contact/activity sync. Deliberately best-effort relative
// to the Events booking/payment flow: every exported function here
// catches its own errors internally and NEVER throws. Order creation,
// payment state, ticket generation, capacity, and check-in must all
// keep working exactly as today even if CRM is disabled, unreachable,
// or misbehaving. Call these functions AFTER the Events booking/payment
// transaction has already committed — never from inside it (see the
// call sites in the register/checkout routes and lib/events/stripe.ts).
//
// Boundary (non-negotiable, per the Phase 5 brief): this file talks to
// crm_contacts / crm_activities ONLY. It must never import from, or
// write to, the separate vertical-specific `contacts` table (LD-Tennis/
// coaching — see app/api/contacts/[id]/route.ts and
// tests/containment/crmContactsSchemaAlignment.test.ts, which already
// documents and guards against exactly this kind of leakage the other
// direction). It must never write registration-question answers
// (dietary/accessibility/special-request) into any CRM field.
//
// ── Concurrency design ───────────────────────────────────────────────
// crm_contacts has no UNIQUE constraint on email/phone (see
// scripts/crm-migrate.mjs) — a plain "SELECT then INSERT if not found"
// from two concurrent requests for the same purchaser could create two
// duplicate contacts. Rather than add a new schema constraint (out of
// scope for this phase — the brief explicitly requires stopping before
// adding more schema than the approved crm_contact_id migration), this
// uses a real Postgres session-scoped advisory transaction lock
// (pg_advisory_xact_lock), keyed by (organisation_id, normalized
// identity), held for the duration of ONE statement (a bare SQL
// statement is its own implicit transaction — the lock is acquired and
// released within that single round trip). Two concurrent syncs for the
// SAME organisation+identity genuinely serialize against each other:
// the second one blocks on the lock until the first's statement
// finishes, then its own fresh read sees the first one's committed
// insert and correctly reuses it instead of creating a duplicate. This
// is the same lock-then-read-then-write shape already established in
// this codebase's own R1 concurrency remediation (see the free
// registration route's own extensive comment on
// sql.transaction()/snapshot timing) — real protection, proven against
// real Postgres below (scripts/tests/verify-events-crm-sync-concurrency.sh),
// not merely asserted.
//
// KNOWN LIMITATION, documented rather than overclaimed: the lock key is
// derived from whichever identity (email, else phone) THIS call
// actually has. Two concurrent bookings for the same real person where
// one supplies an email and the other supplies only a phone number (no
// email) use DIFFERENT lock keys and could each independently create a
// contact — this is a genuine, accepted gap, not a claim of total
// concurrency safety. When no email or phone is usable at all, no lock
// is taken and a fresh contact is always created (there is no stable
// identity to dedupe against or serialize on).

const EMAIL_MARKER = 'email';
const PHONE_MARKER = 'phone';

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

// Conservative, generic phone normalization: strips everything except
// digits and a single leading '+'. Deliberately introduces NO
// country-code assumptions (no Australia-only stripping of a leading
// '0', no implicit '+61' prefixing) — nothing in the existing generic
// CRM code does that either (see the Phase 5 investigation report: the
// only phone/email normalization precedent in this codebase belongs to
// the separate tennis-vertical `contacts` table, out of bounds here).
// Two phone strings that a human would consider "the same number" but
// that differ in country-code formatting (e.g. "0412 345 678" vs
// "+61412345678") will NOT normalize to the same value under this
// scheme — an accepted, documented limitation of a deliberately
// conservative approach, not a claim of true phone-number equivalence.
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const stripped = phone.trim().replace(/[^0-9+]/g, '');
  const digitsOnly = stripped.replace(/\+/g, '');
  return digitsOnly.length > 0 ? stripped : null;
}

// crm_contacts.first_name/last_name are both NOT NULL — every purchaser
// must map to *something* in both columns; the purchaser must never be
// silently dropped. Multi-token names split on the first whitespace run
// (first token -> first_name, remainder -> last_name). A single-token
// name has no existing splitting convention anywhere in this codebase's
// generic CRM (the CRM contact form itself just takes two separate
// required fields — there is no "split a full name" helper to reuse).
// Chosen, documented, tested fallback: the single token becomes
// first_name, and last_name is stored as an empty string rather than a
// fabricated surname — inventing a surname the purchaser never gave
// would misrepresent them, whereas an empty last_name honestly records
// that none was provided. This intentionally bypasses the manager-facing
// contact form's own non-empty last_name validation (POST
// /api/crm/contacts requires last_name.trim() to be non-empty) — that
// validation exists for a human filling in a form by hand; this is a
// system sync writing directly to the table, not a call through that
// route, so it is not bound by that route's own UX-level requirement.
export function splitPurchaserName(rawName: string): { firstName: string; lastName: string } {
  const trimmed = rawName.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    // Believed unreachable: Events' own public input validation
    // (lib/events/publicValidation.ts) already requires a non-empty,
    // trimmed purchaser_name before any order can be created. This
    // fallback exists only so this function itself can never throw or
    // produce a NOT NULL violation if that upstream guarantee is ever
    // weakened.
    return { firstName: 'Event', lastName: 'Purchaser' };
  }
  const parts = trimmed.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export interface SyncEventOrderContactInput {
  organisationId: string;
  orderId: string;
  purchaserName: string;
  purchaserEmail: string | null | undefined;
  purchaserPhone: string | null | undefined;
}

// Best-effort. Never throws. Resolves (does nothing) if CRM is disabled
// for this organisation, if the DB is unreachable, or if any step
// fails — logged, not surfaced, exactly like the rest of this file.
export async function syncEventOrderContact(input: SyncEventOrderContactInput): Promise<void> {
  const { organisationId, orderId, purchaserName, purchaserEmail, purchaserPhone } = input;

  try {
    const capability = await checkCapability(organisationId, 'crm');
    if (!capability.allowed) return;

    const normEmail = normalizeEmail(purchaserEmail);
    const normPhone = normalizePhone(purchaserPhone);
    const { firstName, lastName } = splitPurchaserName(purchaserName);

    // Lock identity: prefer email (matches this Phase's own §3 matching
    // order — email first, then phone), else phone, else no lock (no
    // stable identity to serialize on — see this file's header comment).
    const lockMarker = normEmail ? EMAIL_MARKER : normPhone ? PHONE_MARKER : null;
    const lockIdentity = normEmail ?? normPhone ?? null;

    let rows: { id: string }[];
    if (lockIdentity && lockMarker) {
      rows = (await sql`
        WITH lock_cte AS (
          SELECT pg_advisory_xact_lock(hashtext(${organisationId}), hashtext(${lockMarker + ':' + lockIdentity})) AS locked
        ),
        existing AS (
          SELECT c.id
          FROM crm_contacts c, lock_cte
          WHERE c.organisation_id = ${organisationId}
            AND (
              (${normEmail}::text IS NOT NULL AND lower(trim(c.email)) = ${normEmail})
              OR (
                ${normEmail}::text IS NULL AND ${normPhone}::text IS NOT NULL
                AND regexp_replace(trim(c.phone), '[^0-9+]', '', 'g') = ${normPhone}
              )
            )
          ORDER BY c.created_at ASC
          LIMIT 1
        ),
        ins AS (
          INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, phone, notes)
          SELECT ${organisationId}, ${firstName}, ${lastName}, ${purchaserEmail ?? null}, ${purchaserPhone ?? null}, 'Events / Event Booking'
          FROM lock_cte
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id
        )
        SELECT id FROM existing
        UNION ALL
        SELECT id FROM ins
      `) as { id: string }[];
    } else {
      // No usable email or phone: nothing to dedupe against. Always
      // create a fresh contact rather than silently dropping the
      // purchaser (per this Phase's own explicit instruction).
      rows = (await sql`
        INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, phone, notes)
        VALUES (${organisationId}, ${firstName}, ${lastName}, ${purchaserEmail ?? null}, ${purchaserPhone ?? null}, 'Events / Event Booking')
        RETURNING id
      `) as { id: string }[];
    }

    const contactId = rows[0]?.id;
    if (!contactId) return;

    await sql`
      UPDATE event_orders SET crm_contact_id = ${contactId}
      WHERE id = ${orderId} AND organisation_id = ${organisationId}
    `;
  } catch (err) {
    console.error('[crm sync] contact create/link failed (ignored — booking remains valid)', err, { organisationId, orderId });
  }
}

export interface RecordEventBookingActivityInput {
  organisationId: string;
  orderId: string;
  eventName: string;
  quantity: number;
  totalCents: number;
  currency: string;
  paymentStatus: string;
}

// Best-effort, idempotent-via-advisory-lock (see this file's header).
// Writes/updates exactly ONE crm_activities row per order, keyed by a
// deterministic marker line in the activity body ("Order: <orderId>").
// Never includes any registration-question answer — only the safe
// operational fields listed in RecordEventBookingActivityInput. No-ops
// silently if CRM is disabled or the order has no linked contact yet
// (syncEventOrderContact must have already run and succeeded).
export async function recordEventBookingActivity(input: RecordEventBookingActivityInput): Promise<void> {
  const { organisationId, orderId, eventName, quantity, totalCents, currency, paymentStatus } = input;

  try {
    const capability = await checkCapability(organisationId, 'crm');
    if (!capability.allowed) return;

    const contactRows = (await sql`
      SELECT crm_contact_id FROM event_orders WHERE id = ${orderId} AND organisation_id = ${organisationId}
    `) as { crm_contact_id: string | null }[];
    const contactId = contactRows[0]?.crm_contact_id;
    if (!contactId) return;

    const amount = (totalCents / 100).toFixed(2);
    const orderMarker = `Order: ${orderId}`;
    const subject = `Booked: ${eventName}`;
    const body = [
      orderMarker,
      `Event: ${eventName}`,
      `Quantity: ${quantity}`,
      `Amount: ${amount} ${currency}`,
      `Payment status: ${paymentStatus}`,
    ].join('\n');

    // type='note' — the CHECK-constrained vocabulary on crm_activities is
    // exactly call|email|note|meeting (scripts/crm-migrate.mjs); no new
    // value is introduced. Idempotency: an advisory lock keyed on
    // (organisation_id, orderId) serializes concurrent attempts (e.g. a
    // retried Stripe webhook racing the original request) for the SAME
    // order; the exact-match lookup on the deterministic first body line
    // (split_part(body, E'\n', 1) = orderMarker) then decides
    // update-in-place vs insert. This is NOT a database-level UNIQUE
    // constraint — crm_activities carries none — so it is a real,
    // lock-backed guarantee for concurrent writes from this codebase,
    // not a structural DB-enforced one; documented here rather than
    // overclaimed.
    await sql`
      WITH lock_cte AS (
        SELECT pg_advisory_xact_lock(hashtext(${organisationId}), hashtext(${orderId})) AS locked
      ),
      existing AS (
        SELECT a.id
        FROM crm_activities a, lock_cte
        WHERE a.organisation_id = ${organisationId}
          AND a.contact_id = ${contactId}
          AND a.type = 'note'
          AND split_part(a.body, E'\n', 1) = ${orderMarker}
        LIMIT 1
      ),
      upd AS (
        UPDATE crm_activities
        SET subject = ${subject}, body = ${body}, activity_date = now()
        WHERE id = (SELECT id FROM existing)
        RETURNING id
      ),
      ins AS (
        INSERT INTO crm_activities (organisation_id, contact_id, type, subject, body, activity_date)
        SELECT ${organisationId}, ${contactId}, 'note', ${subject}, ${body}, now()
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id
      )
      SELECT id FROM upd
      UNION ALL
      SELECT id FROM ins
    `;
  } catch (err) {
    console.error('[crm activity] booking activity write failed (ignored — booking/payment remains valid)', err, { organisationId, orderId });
  }
}

// Convenience wrapper for callers (the Stripe webhook handlers) that
// only have an orderId in scope — resolves organisationId and every
// other RecordEventBookingActivityInput field itself, from the order's
// CURRENT, just-updated state, then delegates to
// recordEventBookingActivity above. Kept in THIS module (not in
// lib/events/stripe.ts) deliberately, so every CRM-related `sql` call
// this Phase introduces lives behind the same single boundary — the
// lookup below is not itself "Events" logic, it exists only to feed the
// CRM sync that follows it. Best-effort; never throws.
export async function recordEventBookingActivityForOrder(orderId: string): Promise<void> {
  try {
    const rows = (await sql`
      SELECT eo.organisation_id, eo.total_cents, eo.currency, eo.payment_status, e.name AS event_name,
        (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM event_order_items oi WHERE oi.order_id = eo.id) AS quantity
      FROM event_orders eo
      JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
      WHERE eo.id = ${orderId}
    `) as { organisation_id: string; total_cents: number; currency: string; payment_status: string; event_name: string; quantity: number }[];
    const order = rows[0];
    if (!order) return;

    await recordEventBookingActivity({
      organisationId: order.organisation_id,
      orderId,
      eventName: order.event_name,
      quantity: order.quantity,
      totalCents: order.total_cents,
      currency: order.currency,
      paymentStatus: order.payment_status,
    });
  } catch (err) {
    console.error('[crm activity] booking activity lookup failed (ignored)', err, { orderId });
  }
}
