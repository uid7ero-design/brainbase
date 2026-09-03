import sql from '@/lib/db';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { normalizeEmail, normalizePhone, splitPurchaserName, recordEventBookingActivityForOrder } from './eventSync';
import { EVENT_CONTACT_CLASSIFICATION } from './classification';

// Phase 6.2 — historical Events -> CRM backfill. Reuses the existing,
// generic crm_contacts model (this file does NOT introduce a second
// CRM, a new table, or any new schema — see the migration note below).
// Deliberately a SEPARATE module from lib/crm/eventSync.ts rather than
// a modification to it: eventSync.ts's syncEventOrderContact() runs
// once, automatically, at order-creation time, and always creates a
// fresh contact when no email/phone is usable at all (documented in
// that file's own header — "there is no stable identity to dedupe
// against... a fresh contact is always created"). Backfill is a
// deliberately more conservative, manager-reviewed, batch operation
// over pre-existing historical orders, and diverges from that one
// behaviour on purpose: an order with neither a usable email nor phone
// is SKIPPED here (reported as "insufficient identity"), never
// auto-created, so a manager reviewing decades of old data isn't
// flooded with unreviewable, unlinkable contacts they have no way to
// later reconcile. Every other rule mirrors eventSync.ts exactly:
// email-first-then-phone matching, the same normalizeEmail/
// normalizePhone/splitPurchaserName helpers (imported, not
// reimplemented), and the same organisation-scoped
// pg_advisory_xact_lock concurrency mechanism keyed the identical way
// (hashtext(organisationId), hashtext('email:'+identity or
// 'phone:'+identity)) — a live registration syncing for the same
// purchaser while a backfill run is in progress correctly serializes
// against it and reuses/creates exactly one contact, not two.
//
// AMBIGUITY (the one genuine behavioural addition beyond eventSync.ts):
// syncEventOrderContact()'s own matching query silently picks the
// oldest matching contact if more than one exists (LIMIT 1) — an
// acceptable simplification for a single live booking, but not
// acceptable for a bulk historical operation reviewed by a human, per
// this phase's own explicit requirement. Both previewEventContactBackfill
// and executeEventContactBackfill therefore COUNT every matching
// contact, not just fetch one, and treat count > 1 as ambiguous — never
// choosing arbitrarily, always skipping and reporting it instead.
//
// DATA SAFETY: only purchaser_name/purchaser_email/purchaser_phone are
// ever read from event_orders or written to crm_contacts here. This
// file has no awareness of event_registration_responses,
// event_order_notes, or any attendee row at all — dietary/
// accessibility/special-request answers and internal staff notes are
// structurally unreachable from this code, not merely avoided by
// convention.
//
// NON-OVERWRITE: this file never UPDATEs an existing crm_contacts row's
// name/email/phone — a match only ever REUSES the existing row's id and
// links event_orders.crm_contact_id to it. An old event order's
// purchaser_name spelled slightly differently than a CRM contact's
// current, possibly-since-corrected name can never clobber the CRM
// contact's own data. The same rule now covers classification (see
// lib/crm/classification.ts): the single INSERT site below sets
// classification = EVENT_CONTACT_CLASSIFICATION only when creating a
// brand-new row (WHERE cnt = 0); a matched existing contact's own
// classification — CLIENT, LEAD, SUPPLIER, PARTNER, OTHER, or
// NULL/unclassified — is never touched, by construction, exactly like
// its name/email/phone.

export type BackfillClassification = 'would_link_existing' | 'would_create_new' | 'skipped_insufficient_identity' | 'ambiguous';

export interface BackfillPreviewRow {
  orderId: string;
  purchaserName: string;
  purchaserEmail: string | null;
  purchaserPhone: string | null;
  classification: BackfillClassification;
  matchCount: number;
  existingContactId: string | null;
}

export interface BackfillPreviewResult {
  crmEnabled: boolean;
  totalUnlinkedOrders: number;
  alreadyLinkedOrders: number;
  wouldLinkExisting: number;
  wouldCreateNew: number;
  skippedInsufficientIdentity: number;
  ambiguous: number;
  rows: BackfillPreviewRow[];
}

function emptyPreview(crmEnabled: boolean): BackfillPreviewResult {
  return {
    crmEnabled, totalUnlinkedOrders: 0, alreadyLinkedOrders: 0,
    wouldLinkExisting: 0, wouldCreateNew: 0, skippedInsufficientIdentity: 0, ambiguous: 0, rows: [],
  };
}

// Read-only. Issues one lightweight matching query per unlinked order
// (deliberately, not a single mega-JOIN) — each order's classification
// depends on a different predicate (email match vs phone match vs
// neither), which does not collapse cleanly into one set-based query
// without either duplicating rows or losing per-order attribution. This
// is an admin-triggered, per-organisation, infrequently-run tool over a
// tenant's own historical order volume (hundreds, not millions) — N
// small indexed lookups is the right trade favouring simplicity and
// auditability over micro-optimising a rare, bounded-size operation.
export async function previewEventContactBackfill(organisationId: string): Promise<BackfillPreviewResult> {
  const capability = await checkCapability(organisationId, 'crm');
  if (!capability.allowed) return emptyPreview(false);

  const alreadyLinkedRows = (await sql`
    SELECT COUNT(*)::int AS count FROM event_orders WHERE organisation_id = ${organisationId} AND crm_contact_id IS NOT NULL
  `) as { count: number }[];
  const alreadyLinkedOrders = alreadyLinkedRows[0]?.count ?? 0;

  const unlinkedOrders = (await sql`
    SELECT id, purchaser_name, purchaser_email, purchaser_phone
    FROM event_orders
    WHERE organisation_id = ${organisationId} AND crm_contact_id IS NULL
    ORDER BY created_at ASC
  `) as { id: string; purchaser_name: string; purchaser_email: string | null; purchaser_phone: string | null }[];

  const rows: BackfillPreviewRow[] = [];
  let wouldLinkExisting = 0, wouldCreateNew = 0, skippedInsufficientIdentity = 0, ambiguous = 0;

  for (const order of unlinkedOrders) {
    const normEmail = normalizeEmail(order.purchaser_email);
    const normPhone = normalizePhone(order.purchaser_phone);
    const base = { orderId: order.id, purchaserName: order.purchaser_name, purchaserEmail: order.purchaser_email, purchaserPhone: order.purchaser_phone };

    if (!normEmail && !normPhone) {
      skippedInsufficientIdentity++;
      rows.push({ ...base, classification: 'skipped_insufficient_identity', matchCount: 0, existingContactId: null });
      continue;
    }

    const matches = normEmail
      ? ((await sql`
          SELECT id FROM crm_contacts
          WHERE organisation_id = ${organisationId} AND lower(trim(email)) = ${normEmail}
          ORDER BY created_at ASC
        `) as { id: string }[])
      : ((await sql`
          SELECT id FROM crm_contacts
          WHERE organisation_id = ${organisationId} AND regexp_replace(trim(phone), '[^0-9+]', '', 'g') = ${normPhone}
          ORDER BY created_at ASC
        `) as { id: string }[]);

    if (matches.length === 0) {
      wouldCreateNew++;
      rows.push({ ...base, classification: 'would_create_new', matchCount: 0, existingContactId: null });
    } else if (matches.length === 1) {
      wouldLinkExisting++;
      rows.push({ ...base, classification: 'would_link_existing', matchCount: 1, existingContactId: matches[0].id });
    } else {
      ambiguous++;
      rows.push({ ...base, classification: 'ambiguous', matchCount: matches.length, existingContactId: null });
    }
  }

  return {
    crmEnabled: true,
    totalUnlinkedOrders: unlinkedOrders.length,
    alreadyLinkedOrders,
    wouldLinkExisting, wouldCreateNew, skippedInsufficientIdentity, ambiguous,
    rows,
  };
}

export type BackfillOutcome = 'linked_existing' | 'created_new' | 'skipped_insufficient_identity' | 'skipped_ambiguous' | 'skipped_already_linked_concurrently' | 'failed';

export interface BackfillExecutionRow {
  orderId: string;
  outcome: BackfillOutcome;
  contactId: string | null;
  error?: string;
}

export interface BackfillExecutionResult {
  crmEnabled: boolean;
  processed: number;
  linkedExisting: number;
  createdNew: number;
  skippedInsufficientIdentity: number;
  ambiguousSkipped: number;
  failed: number;
  results: BackfillExecutionRow[];
}

function emptyExecution(crmEnabled: boolean): BackfillExecutionResult {
  return {
    crmEnabled, processed: 0, linkedExisting: 0, createdNew: 0,
    skippedInsufficientIdentity: 0, ambiguousSkipped: 0, failed: 0, results: [],
  };
}

const EMAIL_MARKER = 'email';
const PHONE_MARKER = 'phone';

// Processes eligible orders ONE AT A TIME — each order's own
// match/create + link is its own independent unit of work (§6: "prefer
// transactional handling per order rather than one giant all-or-nothing
// transaction"). A failure on any single order is caught, recorded in
// that order's own result row, and does NOT abort or roll back any
// other order already processed in this run — matching exactly how
// eventSync.ts's own syncEventOrderContact() is already independently
// safe-to-fail-per-call for every other Events mutation route.
//
// Re-derives the eligible order set itself (organisationId, crm_contact_id
// IS NULL) rather than trusting a caller-supplied order-id list — the
// caller (the API route) never passes orderIds; this function is the
// single source of truth for "what counts as backfillable right now",
// matching the preview function's own query exactly so a manager who
// just ran preview sees the same population get processed.
export async function executeEventContactBackfill(organisationId: string): Promise<BackfillExecutionResult> {
  const capability = await checkCapability(organisationId, 'crm');
  if (!capability.allowed) return emptyExecution(false);

  const unlinkedOrders = (await sql`
    SELECT id, purchaser_name, purchaser_email, purchaser_phone
    FROM event_orders
    WHERE organisation_id = ${organisationId} AND crm_contact_id IS NULL
    ORDER BY created_at ASC
  `) as { id: string; purchaser_name: string; purchaser_email: string | null; purchaser_phone: string | null }[];

  const results: BackfillExecutionRow[] = [];
  let linkedExisting = 0, createdNew = 0, skippedInsufficientIdentity = 0, ambiguousSkipped = 0, failed = 0;

  for (const order of unlinkedOrders) {
    try {
      const normEmail = normalizeEmail(order.purchaser_email);
      const normPhone = normalizePhone(order.purchaser_phone);

      if (!normEmail && !normPhone) {
        skippedInsufficientIdentity++;
        results.push({ orderId: order.id, outcome: 'skipped_insufficient_identity', contactId: null });
        continue;
      }

      const { firstName, lastName } = splitPurchaserName(order.purchaser_name);
      const lockMarker = normEmail ? EMAIL_MARKER : PHONE_MARKER;
      const lockIdentity = (normEmail ?? normPhone) as string;

      // Single compound statement — lock, count every match, and (only
      // when zero matches exist) create a new contact, all in one round
      // trip, mirroring syncEventOrderContact()'s own lock-then-read-
      // then-write shape exactly. Unlike that function, this reports
      // match_count back to the caller so ambiguity (>1) can be detected
      // and skipped rather than silently resolved via LIMIT 1.
      const rows = (await sql`
        WITH lock_cte AS (
          SELECT pg_advisory_xact_lock(hashtext(${organisationId}), hashtext(${lockMarker + ':' + lockIdentity})) AS locked
        ),
        matches AS (
          SELECT c.id, c.created_at
          FROM crm_contacts c, lock_cte
          WHERE c.organisation_id = ${organisationId}
            AND (
              (${normEmail}::text IS NOT NULL AND lower(trim(c.email)) = ${normEmail})
              OR (
                ${normEmail}::text IS NULL AND ${normPhone}::text IS NOT NULL
                AND regexp_replace(trim(c.phone), '[^0-9+]', '', 'g') = ${normPhone}
              )
            )
        ),
        match_count AS (
          SELECT COUNT(*)::int AS cnt FROM matches
        ),
        ins AS (
          INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, phone, notes, classification)
          SELECT ${organisationId}, ${firstName}, ${lastName}, ${order.purchaser_email ?? null}, ${order.purchaser_phone ?? null}, 'Events / Historical Backfill', ${EVENT_CONTACT_CLASSIFICATION}
          FROM match_count WHERE cnt = 0
          RETURNING id
        )
        SELECT
          (SELECT cnt FROM match_count) AS match_count,
          (SELECT id FROM matches ORDER BY created_at ASC LIMIT 1) AS existing_id,
          (SELECT id FROM ins) AS created_id
      `) as { match_count: number; existing_id: string | null; created_id: string | null }[];

      const matchCount = rows[0]?.match_count ?? 0;

      if (matchCount > 1) {
        ambiguousSkipped++;
        results.push({ orderId: order.id, outcome: 'skipped_ambiguous', contactId: null });
        continue;
      }

      const contactId = matchCount === 1 ? rows[0]?.existing_id ?? null : rows[0]?.created_id ?? null;
      if (!contactId) throw new Error('No contact id resolved after match/create — unexpected state.');

      // Defensive re-check of crm_contact_id IS NULL: guards against two
      // concurrent executions of THIS SAME backfill for this org (e.g. a
      // manager double-clicking Execute) racing on the same order. The
      // contact itself is never lost either way (it was created/reused
      // above, under the advisory lock); only the order-link write can
      // lose this race, and losing it here is safe — this run simply
      // reports it as already resolved rather than double-linking.
      const updated = (await sql`
        UPDATE event_orders SET crm_contact_id = ${contactId}
        WHERE id = ${order.id} AND organisation_id = ${organisationId} AND crm_contact_id IS NULL
        RETURNING id
      `) as { id: string }[];

      if (!updated.length) {
        results.push({ orderId: order.id, outcome: 'skipped_already_linked_concurrently', contactId });
        continue;
      }

      if (matchCount === 1) { linkedExisting++; results.push({ orderId: order.id, outcome: 'linked_existing', contactId }); }
      else { createdNew++; results.push({ orderId: order.id, outcome: 'created_new', contactId }); }

      // Reuses Phase 5's own deterministic, idempotent booking-activity
      // writer exactly (§6: "optionally create/update the same
      // deterministic Events booking activity used by Phase 5") — best-
      // effort, never throws, so a failure here cannot turn a successful
      // contact link into a reported failure for this order.
      await recordEventBookingActivityForOrder(order.id);
    } catch (err) {
      failed++;
      results.push({ orderId: order.id, outcome: 'failed', contactId: null, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    crmEnabled: true,
    processed: unlinkedOrders.length,
    linkedExisting, createdNew, skippedInsufficientIdentity, ambiguousSkipped, failed,
    results,
  };
}
