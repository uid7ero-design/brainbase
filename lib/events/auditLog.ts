import sql from '@/lib/db';

// Phase 6 §11 — Events registration-management audit history. Reuses
// the EXISTING, already-live, generic audit_logs table (see
// prisma/schema.prisma's AuditLog model; already written to by
// lib/tennisSchedule.ts's own session archive/restore feature via the
// exact same raw-SQL insert shape this file mirrors) — no new schema.
// This is a genuinely separate mechanism from lib/crm/eventSync.ts's
// crm_activities writes: audit_logs is BrainBase's own internal,
// staff-only system-of-record, never surfaced to CRM, and exists
// independently of whether the organisation has CRM enabled at all —
// matching this phase's own explicit "do not bury audit history in CRM
// activity" instruction.
//
// action namespace: 'event_order.<verb>' — e.g.
// 'event_order.purchaser_edited', 'event_order.checked_in'. resource_type
// is always the literal 'event_order', resource_id is always the
// order's own id — this is what makes "every audit entry for this
// order" a single, cheap, already-indexed query
// (audit_logs has idx on (resource_type, resource_id) — see
// prisma/schema.prisma's @@index([resource_type, resource_id])).
//
// Deliberately conservative about content, matching (and in one respect
// going further than) the tennisSchedule precedent's own stated
// discipline ("No contact/booking name, email, phone, or payment field
// is ever read by this function, let alone logged" — that precedent is
// for a feature with no legitimate reason to touch PII at all). Here,
// purchaser/attendee edits DO log the actual before/after field values
// (name/email/phone) — that is the entire point of an edit audit trail,
// and this data already exists duplicated in crm_contacts once CRM sync
// has run, so storing it in this internal, staff-only, non-public table
// is not a new category of exposure. Registration-question ANSWERS are
// the one thing this file will never log verbatim, even here — see
// logResponseEdited's own comment.
//
// Best-effort, like every other side-channel write in this Events
// module (see lib/crm/eventSync.ts's own header for the identical
// rationale): a failure to write an audit entry must never fail the
// underlying mutation it is describing. Call these functions AFTER the
// real mutation has already committed successfully.

// resourceType is now a parameter (Phase 8 — management/Connect audit
// coverage) rather than the hardcoded literal 'event_order' every call
// site used exclusively until now. Every existing call below passes
// 'event_order' explicitly, so this is purely additive — no existing
// call site's behaviour changes. A single resource_type per audited
// entity (never a finer-grained sub-resource) still applies per entity
// family, matching ADR-0003 §10 — 'event', 'event_session',
// 'event_ticket_type', and 'stripe_connect_account' are each their own
// literal, exactly like 'event_order' already is.
async function insertAuditLog(entry: {
  organisationId: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      VALUES (
        ${crypto.randomUUID()}, ${entry.organisationId}, ${entry.userId}, ${entry.action}, ${entry.resourceType}, ${entry.resourceId},
        ${entry.beforeState ? JSON.stringify(entry.beforeState) : null}::jsonb,
        ${entry.afterState ? JSON.stringify(entry.afterState) : null}::jsonb
      )
    `;
  } catch (err) {
    console.error('[events audit] audit_logs write failed (ignored — the underlying mutation remains valid)', err, { action: entry.action, resourceId: entry.resourceId });
  }
}

// Shared by every *Updated logger below (event/session/ticket type) —
// ADR-0003 §4: before_state/after_state must carry "the specific fields
// that changed, never the entire row." Compares only the caller-supplied
// field allowlist (each entity's own safe, non-sensitive catalog fields
// — see each logger's own comment) and returns null/undefined-free
// before/after objects containing ONLY the fields that actually differ.
// Returns null for both when nothing in the allowlist changed (e.g. a
// PATCH that only touched a field outside the list) — callers should
// skip writing an audit entry entirely in that case rather than log an
// empty no-op.
function diffFields<T extends Record<string, unknown>>(
  before: T, after: T, fields: readonly (keyof T)[],
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};
  let changed = false;
  for (const field of fields) {
    const b = before[field] ?? null;
    const a = after[field] ?? null;
    // Dates may arrive as Date instances or strings depending on the
    // driver's return shape for a freshly-inserted/updated row vs. one
    // read back from an existing SELECT — compare by ISO string value,
    // not reference/type, so an unchanged timestamp is never reported
    // as "changed" merely because of a shape mismatch between the two
    // sides being compared.
    const bCmp = b instanceof Date ? b.toISOString() : b;
    const aCmp = a instanceof Date ? a.toISOString() : a;
    if (bCmp !== aCmp) {
      changed = true;
      beforeOut[field as string] = bCmp;
      afterOut[field as string] = aCmp;
    }
  }
  return changed ? { before: beforeOut, after: afterOut } : null;
}

export async function logPurchaserEdited(params: {
  organisationId: string; userId: string; orderId: string;
  before: { purchaser_name: string; purchaser_email: string; purchaser_phone: string | null };
  after: { purchaser_name: string; purchaser_email: string; purchaser_phone: string | null };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.purchaser_edited',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: params.before, afterState: params.after,
  });
}

export async function logAttendeeEdited(params: {
  organisationId: string; userId: string; orderId: string; attendeeId: string;
  before: { attendee_name: string; attendee_email: string | null };
  after: { attendee_name: string; attendee_email: string | null };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.attendee_edited',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: { attendee_id: params.attendeeId, ...params.before },
    afterState: { attendee_id: params.attendeeId, ...params.after },
  });
}

// Deliberately does NOT log the actual answer text (before or after) —
// unlike purchaser/attendee edits above. Registration-question answers
// are the one category of data this entire Events -> CRM/audit surface
// treats as never-duplicated-anywhere-else (see lib/crm/eventSync.ts's
// own identical boundary for CRM). Only the fact that an edit occurred,
// which question it was, and its field type are recorded — enough to
// know something changed and prompt a manager to look at the response
// itself (still the single source of truth, in
// event_registration_responses), never enough to leak the content into
// a second table.
export async function logResponseEdited(params: {
  organisationId: string; userId: string; orderId: string; responseId: string; questionId: string; fieldType: string;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.response_edited',
    resourceType: 'event_order', resourceId: params.orderId,
    beforeState: { response_id: params.responseId, question_id: params.questionId, field_type: params.fieldType },
    afterState: null,
  });
}

export async function logCheckedIn(params: { organisationId: string; userId: string; orderId: string; attendeeId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.checked_in',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: null, afterState: { attendee_id: params.attendeeId },
  });
}

export async function logCheckInUndone(params: { organisationId: string; userId: string; orderId: string; attendeeId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.check_in_undone',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: { attendee_id: params.attendeeId }, afterState: null,
  });
}

// Phase L1 — before/after now required (previously null/null): a
// cancellation audit entry that doesn't record what state it moved
// FROM and TO is materially less useful for support than the
// purchaser/attendee-edit entries above, which already carry this
// shape. eventId is carried inside both before/after (rather than as a
// new top-level column on audit_logs, which would touch every other
// log*() function's shared insertAuditLog() call shape below) — cheap,
// consistent with this file's existing before/after convention, and
// sufficient to identify "actor, order, event, previous state,
// resulting state" together in one row without a schema change.
export async function logCancelled(params: {
  organisationId: string; userId: string; orderId: string; eventId: string;
  before: { status: string; payment_status: string };
  after: { status: string; payment_status: string };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.cancelled',
    resourceType: 'event_order', resourceId: params.orderId,
    beforeState: { event_id: params.eventId, ...params.before },
    afterState: { event_id: params.eventId, ...params.after },
  });
}

export async function logRefunded(params: { organisationId: string; userId: string; orderId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.refunded',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: null, afterState: null,
  });
}

// Phase 6 — internal notes (§ notes schema approval). Deliberately never
// logs the note body, matching logResponseEdited's own rationale above:
// the note's own text lives only in event_order_notes, never duplicated
// into audit_logs. Metadata only — note id, action, actor (userId is
// already on every audit_logs row) — enough to know a note existed and
// changed, never enough to leak its content into a second table.
export async function logNoteAdded(params: { organisationId: string; userId: string; orderId: string; noteId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.note_added',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: null, afterState: { note_id: params.noteId },
  });
}

export async function logNoteEdited(params: { organisationId: string; userId: string; orderId: string; noteId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.note_edited',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: { note_id: params.noteId }, afterState: null,
  });
}

export async function logNoteDeleted(params: { organisationId: string; userId: string; orderId: string; noteId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.note_deleted',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: { note_id: params.noteId }, afterState: null,
  });
}

// Phase 7 §9 — "Resend ticket email" audit entry. Deliberately does
// NOT go through this file's own insertAuditLog() helper above: every
// log*() function elsewhere in this file is intentionally
// fire-and-forget (a failed audit write must never fail the mutation
// it describes), but the ticket-email resend route has its own,
// separate failure mode (Case D — the email provider already accepted
// the send, and only the audit write afterwards fails) that the
// CALLING ROUTE must detect and react to distinctly from an ordinary
// successful resend, per that route's own explicit contract. Silently
// swallowing the error here the way insertAuditLog() does would make
// that case indistinguishable from success. Callers of this function
// must catch its thrown errors themselves.
//
// after_state is operational metadata only — result/recipient
// (masked)/attendee count/provider message id — never the ticket
// token, ticket URL, email body, registration answers, notes, Stripe
// ids, or CRM ids (see lib/events/ticketEmail.ts's maskEmailForAudit).
export async function logTicketEmailResent(params: {
  organisationId: string; userId: string | null; orderId: string;
  // 'not_configured' — pre-push hardening — RESEND_API_KEY absent, no
  // network request was made. Recorded as its own distinct outcome
  // (not collapsed into 'failed') so a manager or a later investigation
  // can tell "we tried and Resend rejected it" apart from "this
  // environment isn't wired up to send email at all". Still counts
  // toward the 60-second cooldown exactly like every other outcome —
  // the cooldown lookup (see the resend route) filters only on
  // organisation_id/resource_type/resource_id/action, never on result.
  result: 'sent' | 'failed' | 'unknown' | 'not_configured';
  recipientMasked: string;
  attendeeCount: number;
  providerMessageId: string | null;
}): Promise<void> {
  await sql`
    INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
    VALUES (
      ${crypto.randomUUID()}, ${params.organisationId}, ${params.userId}, 'event_order.ticket_email_resent', 'event_order', ${params.orderId},
      NULL,
      ${JSON.stringify({
        result: params.result,
        recipient_masked: params.recipientMasked,
        attendee_count: params.attendeeCount,
        provider_message_id: params.providerMessageId,
      })}::jsonb
    )
  `;
}

// Phase 3E.2 — AUTOMATIC initial-delivery audit entries. Deliberately
// SEPARATE action names from 'event_order.ticket_email_resent' above
// (never reused) so the two paths can never be confused with each
// other and, critically, so an automatic 'sent' row can never be
// mistaken by the manual resend route's own 60-second-cooldown lookup
// for a manual resend — that lookup filters specifically on
// action = 'event_order.ticket_email_resent' (see the resend route's
// own COOLDOWN_SECONDS query), which these two new action strings are
// structurally invisible to. userId is always NULL — no authenticated
// actor initiated this, matching lib/events/stripe.ts's own
// user_id = NULL convention for its own system-triggered audit rows.
// Uses this file's normal fire-and-forget insertAuditLog() (unlike
// logTicketEmailResent above): the automatic-delivery orchestration
// helper (lib/events/ticketEmailDelivery.ts's
// attemptAutomaticTicketEmail) has no interactive caller that needs to
// react differently to an audit-write failure — registration success
// never depends on any of this succeeding.
//
// after_state is operational metadata only — attempt_count/outcome/
// provider message id/masked recipient — matching
// logTicketEmailResent's own discipline exactly: never the ticket
// token, booking token, raw email HTML, or any provider credential.
export async function logAutomaticTicketEmailSent(params: {
  organisationId: string; orderId: string; attemptCount: number;
  providerMessageId: string | null; recipientMasked: string;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: null, action: 'event_order.ticket_email_sent',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: null,
    afterState: {
      source: 'automatic',
      attempt_count: params.attemptCount,
      provider_message_id: params.providerMessageId,
      recipient_masked: params.recipientMasked,
    },
  });
}

export async function logAutomaticTicketEmailFailed(params: {
  organisationId: string; orderId: string; attemptCount: number;
  // terminal: true for an attempt that will never be automatically
  // retried again (MAX_ATTEMPTS reached, or an idempotency payload
  // mismatch) — lets staff/tooling distinguish a final failure from a
  // retryable one without a separate action name.
  terminal: boolean;
  reason: string;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: null, action: 'event_order.ticket_email_failed',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: null,
    afterState: { source: 'automatic', attempt_count: params.attemptCount, terminal: params.terminal, reason: params.reason },
  });
}

// ── Lifecycle notifications (Phase 5B) ────────────────────────────────
//
// resource_type stays 'event_order' with the ORDER as resource_id —
// ADR-0003 §10: "show me everything for this order" remains one query,
// exactly as the ticket-email actions above already do; the notification
// row id and type travel in after_state. after_state is operational
// metadata only (type, attempt, outcome, provider message id, masked
// recipient) — never the email body, a ticket/booking token, or any
// provider credential. The bulk scheduling paths (event cancelled,
// reminders) write their 'notification_scheduled' rows atomically inside
// their own INSERT CTE (lib/events/notifications.ts); the per-order
// transitions use this best-effort form because the human-initiated
// cancel/refund has already been audited and committed.
export async function logNotificationScheduled(params: {
  organisationId: string; userId: string | null; orderId: string; notificationId: string; notificationType: string; source: string;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.notification_scheduled',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: null,
    afterState: { source: params.source, notification_type: params.notificationType, notification_id: params.notificationId },
  });
}

export async function logNotificationSent(params: {
  organisationId: string; orderId: string; notificationId: string; notificationType: string; attemptCount: number;
  providerMessageId: string | null; recipientMasked: string;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: null, action: 'event_order.notification_sent',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: null,
    afterState: {
      source: 'automatic',
      notification_type: params.notificationType,
      notification_id: params.notificationId,
      attempt_count: params.attemptCount,
      provider_message_id: params.providerMessageId,
      recipient_masked: params.recipientMasked,
    },
  });
}

export async function logNotificationFailed(params: {
  organisationId: string; orderId: string; notificationId: string; notificationType: string; attemptCount: number;
  terminal: boolean; reason: string;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: null, action: 'event_order.notification_failed',
    resourceType: 'event_order', resourceId: params.orderId, beforeState: null,
    afterState: {
      source: 'automatic',
      notification_type: params.notificationType,
      notification_id: params.notificationId,
      attempt_count: params.attemptCount,
      terminal: params.terminal,
      reason: params.reason,
    },
  });
}

// ── Event / session / ticket-type management audit (Phase 8) ────────
//
// Closes the gap the Events production-readiness audit named: event
// create/edit/publish/unpublish and EventSession/EventTicketType
// management previously had NO audit coverage at all, unlike
// check-in/refund/cancellation above. Same file, same table, same
// best-effort-after-the-mutation-commits discipline as every function
// above — every route calling these is human-initiated and already
// gated by authorizeEventsRequest('manager') before the mutation runs,
// which is exactly ADR-0003 §3's criterion for "acceptable as a
// separate, best-effort write" (no webhook-style redelivery risk that
// would require transactional atomicity instead).
//
// resource_type is 'event' / 'event_session' / 'event_ticket_type'
// respectively — each its own literal (ADR-0003 §10), matching how
// 'event_order' is already its own literal above; sessions and ticket
// types are independently manager-visible/editable catalog entities in
// their own right (their own list rows, their own Edit/Delete
// controls), not sub-objects folded under a parent's resource_type the
// way order line items are under 'event_order'. eventId is carried
// inside every session/ticket-type entry's before/after state (matching
// logCancelled's own established precedent above) so "which event does
// this belong to" is answered without a join.
//
// Only safe catalog fields ever appear in before/after — name, slug,
// description, venue, artwork_url, status, starts_at, ends_at, timezone
// (event); name, starts_at, ends_at, capacity (session); name,
// description, price_cents, capacity, active, sort_order (ticket type).
// None of these are PII, payment credentials, or Stripe secrets — they
// are the same public event-catalog data already returned by this
// module's own GET routes.

const EVENT_AUDIT_FIELDS = ['name', 'slug', 'description', 'venue', 'artwork_url', 'status', 'starts_at', 'ends_at', 'timezone'] as const;
const EVENT_SESSION_AUDIT_FIELDS = ['name', 'starts_at', 'ends_at', 'capacity'] as const;
// Phase 4 — the sale-window/access fields join the allowlist (public
// catalog data, never PII); a change to any of them is logged under the
// distinct action event_ticket_type.sale_window_changed — see
// logEventTicketTypeUpdated.
const EVENT_TICKET_TYPE_AUDIT_FIELDS = ['name', 'description', 'price_cents', 'capacity', 'active', 'sort_order', 'sale_starts_at', 'sale_ends_at', 'requires_access_code'] as const;
const EVENT_TICKET_TYPE_SALE_WINDOW_FIELDS: ReadonlySet<string> = new Set(['sale_starts_at', 'sale_ends_at', 'requires_access_code']);

type EventRow = Record<(typeof EVENT_AUDIT_FIELDS)[number], unknown>;
type EventSessionRow = Record<(typeof EVENT_SESSION_AUDIT_FIELDS)[number], unknown>;
type EventTicketTypeRow = Record<(typeof EVENT_TICKET_TYPE_AUDIT_FIELDS)[number], unknown>;

function pickFields<T extends Record<string, unknown>>(row: T, fields: readonly (keyof T)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row[f];
    out[f as string] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

export async function logEventCreated(params: { organisationId: string; userId: string; eventId: string; after: EventRow }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event.created',
    resourceType: 'event', resourceId: params.eventId, beforeState: null, afterState: pickFields(params.after, EVENT_AUDIT_FIELDS),
  });
}

// Callers (app/api/events/[id]/route.ts's PATCH) decide whether a given
// status transition is specifically a publish/unpublish edge (calling
// logEventPublished/logEventUnpublished instead) or an ordinary edit —
// this function is the ordinary-edit / non-publish-boundary path,
// including a status change that ISN'T a publish/unpublish edge (e.g.
// DRAFT -> CANCELLED). Returns without writing anything if the diff
// against the safe field list is empty (a PATCH that only touched a
// field outside the allowlist, if one existed, would otherwise log a
// content-free no-op row).
export async function logEventUpdated(params: { organisationId: string; userId: string; eventId: string; before: EventRow; after: EventRow }): Promise<void> {
  const diff = diffFields(params.before, params.after, EVENT_AUDIT_FIELDS);
  if (!diff) return;
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event.updated',
    resourceType: 'event', resourceId: params.eventId, beforeState: diff.before, afterState: diff.after,
  });
}

// Registration-answer retention (ADR 0013 §4b) — one row per event per run.
// Response ids and counts per category ONLY: never an answer, label or
// help text. userId is null: the scheduled retention job acts, not a person.
export async function logResponsesRedacted(params: {
  organisationId: string; eventId: string; responseIds: string[]; byCategory: Record<string, number>;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: null, action: 'event_responses.redacted',
    resourceType: 'event', resourceId: params.eventId, beforeState: null,
    afterState: { reason: 'RETENTION', count: params.responseIds.length, by_category: params.byCategory, response_ids: params.responseIds },
  });
}

// Legal hold on answer retention for an event or one order — the reason
// code only (COMPLAINT | INCIDENT | DISPUTE | LEGAL_OBLIGATION | null).
export async function logAnswersLegalHoldChanged(params: {
  organisationId: string; userId: string; eventId: string; orderId: string | null; before: string | null; after: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId,
    action: params.after ? 'event.answers_legal_hold_set' : 'event.answers_legal_hold_cleared',
    resourceType: params.orderId ? 'event_order' : 'event', resourceId: params.orderId ?? params.eventId,
    beforeState: { answers_legal_hold: params.before, event_id: params.eventId },
    afterState: { answers_legal_hold: params.after, event_id: params.eventId },
  });
}

// Eve registration questions (ADR 0013 §4) — the per-event opt-in that
// starts (or stops) Eve showing this event's questions and accepting
// answers. Only the boolean itself is recorded.
export async function logEventEveQuestionsToggled(params: {
  organisationId: string; userId: string; eventId: string; before: boolean; after: boolean;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event.eve_questions_toggled',
    resourceType: 'event', resourceId: params.eventId,
    beforeState: { eve_questions_enabled: params.before }, afterState: { eve_questions_enabled: params.after },
  });
}

// ── Registration-question lifecycle audit ────────────────────────────
//
// resource_type 'event_registration_question' — its own literal
// (ADR-0003 §10), resource_id = the question's own id; event_id travels
// in state like every other catalog child above. Configuration metadata
// ONLY, never an answer: these functions are never handed a response.
// The organiser's label (the question wording buyers see) is logged as
// written. Help text and select options are reduced to markers —
// help_text_set / help_text_changed, option_count / options_changed —
// because free-form organiser copy can carry personal detail ("call
// Sam on …"), and a select option's text is exactly what an answer
// stores, so logging options would put answer-equal strings in
// audit_logs.
//
// Actions:
//   .created            — the full safe shape at creation
//   .deactivated        — active true -> false
//   .reactivated        — active false -> true
//   .category_changed   — data_category changed (with every other changed
//                         field in the same diff), mirroring
//                         event_ticket_type.sale_window_changed
//   .updated            — any other configuration change (label, help
//                         text, type, required, scope, options, sort order)
//   .reordered          — the dedicated up/down swap
// A PATCH that changes active AND other fields writes two rows: the
// active transition, then the configuration diff.

export type RegistrationQuestionAuditRow = {
  label: string; help_text: string | null; field_type: string; required: boolean; scope: string;
  options: string[] | null; sort_order: number; active: boolean; data_category: string; template_key: string | null;
};

const QUESTION_CONFIG_AUDIT_FIELDS = ['label', 'field_type', 'required', 'scope', 'sort_order', 'data_category', 'help_text_set', 'option_count'] as const;

function questionAuditShape(q: RegistrationQuestionAuditRow): Record<(typeof QUESTION_CONFIG_AUDIT_FIELDS)[number], unknown> {
  return {
    label: q.label, field_type: q.field_type, required: q.required, scope: q.scope, sort_order: q.sort_order,
    data_category: q.data_category, help_text_set: Boolean(q.help_text), option_count: q.options?.length ?? 0,
  };
}

function sameOptions(a: string[] | null, b: string[] | null): boolean {
  const x = a ?? [], y = b ?? [];
  return x.length === y.length && x.every((o, i) => o === y[i]);
}

export async function logRegistrationQuestionCreated(params: {
  organisationId: string; userId: string; eventId: string; questionId: string; after: RegistrationQuestionAuditRow;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_registration_question.created',
    resourceType: 'event_registration_question', resourceId: params.questionId, beforeState: null,
    afterState: {
      event_id: params.eventId, ...questionAuditShape(params.after),
      active: params.after.active, template_key: params.after.template_key,
    },
  });
}

export async function logRegistrationQuestionUpdated(params: {
  organisationId: string; userId: string; eventId: string; questionId: string;
  before: RegistrationQuestionAuditRow; after: RegistrationQuestionAuditRow;
}): Promise<void> {
  const base = { organisationId: params.organisationId, userId: params.userId, resourceType: 'event_registration_question', resourceId: params.questionId };
  if (params.before.active !== params.after.active) {
    await insertAuditLog({
      ...base, action: params.after.active ? 'event_registration_question.reactivated' : 'event_registration_question.deactivated',
      beforeState: { event_id: params.eventId, active: params.before.active },
      afterState: { event_id: params.eventId, active: params.after.active },
    });
  }
  const diff = diffFields(questionAuditShape(params.before), questionAuditShape(params.after), QUESTION_CONFIG_AUDIT_FIELDS);
  const helpTextChanged = (params.before.help_text ?? null) !== (params.after.help_text ?? null);
  const optionsChanged = !sameOptions(params.before.options, params.after.options);
  if (!diff && !helpTextChanged && !optionsChanged) return;
  const before: Record<string, unknown> = { event_id: params.eventId, ...diff?.before };
  const after: Record<string, unknown> = { event_id: params.eventId, ...diff?.after };
  if (helpTextChanged) after.help_text_changed = true;
  if (optionsChanged) after.options_changed = true;
  await insertAuditLog({
    ...base,
    action: diff && 'data_category' in diff.after ? 'event_registration_question.category_changed' : 'event_registration_question.updated',
    beforeState: before, afterState: after,
  });
}

export async function logRegistrationQuestionReordered(params: {
  organisationId: string; userId: string; eventId: string; questionId: string; direction: 'up' | 'down';
  swappedWithId: string; beforeSortOrder: number; afterSortOrder: number;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_registration_question.reordered',
    resourceType: 'event_registration_question', resourceId: params.questionId,
    beforeState: { event_id: params.eventId, sort_order: params.beforeSortOrder },
    afterState: { event_id: params.eventId, sort_order: params.afterSortOrder, direction: params.direction, swapped_with: params.swappedWithId },
  });
}

export async function logEventPublished(params: { organisationId: string; userId: string; eventId: string; before: EventRow; after: EventRow }): Promise<void> {
  const diff = diffFields(params.before, params.after, EVENT_AUDIT_FIELDS);
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event.published',
    resourceType: 'event', resourceId: params.eventId,
    beforeState: diff?.before ?? { status: params.before.status }, afterState: diff?.after ?? { status: params.after.status },
  });
}

// Phase 5B — a non-cancelled -> CANCELLED transition is its own
// lifecycle action (it triggers purchaser communications), distinct from
// an ordinary edit, exactly as publish/unpublish are. Carries the same
// safe-field diff; status is always present in the diff by construction.
export async function logEventCancelled(params: { organisationId: string; userId: string; eventId: string; before: EventRow; after: EventRow }): Promise<void> {
  const diff = diffFields(params.before, params.after, EVENT_AUDIT_FIELDS);
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event.cancelled',
    resourceType: 'event', resourceId: params.eventId,
    beforeState: diff?.before ?? { status: params.before.status }, afterState: diff?.after ?? { status: params.after.status },
  });
}

export async function logEventUnpublished(params: { organisationId: string; userId: string; eventId: string; before: EventRow; after: EventRow }): Promise<void> {
  const diff = diffFields(params.before, params.after, EVENT_AUDIT_FIELDS);
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event.unpublished',
    resourceType: 'event', resourceId: params.eventId,
    beforeState: diff?.before ?? { status: params.before.status }, afterState: diff?.after ?? { status: params.after.status },
  });
}

export async function logEventSessionCreated(params: {
  organisationId: string; userId: string; eventId: string; sessionId: string; after: EventSessionRow;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_session.created',
    resourceType: 'event_session', resourceId: params.sessionId, beforeState: null,
    afterState: { event_id: params.eventId, ...pickFields(params.after, EVENT_SESSION_AUDIT_FIELDS) },
  });
}

export async function logEventSessionUpdated(params: {
  organisationId: string; userId: string; eventId: string; sessionId: string; before: EventSessionRow; after: EventSessionRow;
}): Promise<void> {
  const diff = diffFields(params.before, params.after, EVENT_SESSION_AUDIT_FIELDS);
  if (!diff) return;
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_session.updated',
    resourceType: 'event_session', resourceId: params.sessionId,
    beforeState: { event_id: params.eventId, ...diff.before }, afterState: { event_id: params.eventId, ...diff.after },
  });
}

// Called with the row DELETE ... RETURNING already produced — enough
// pre-delete state to identify what was removed (name/starts_at/
// ends_at/capacity) without a separate read-then-delete round trip.
export async function logEventSessionDeleted(params: {
  organisationId: string; userId: string; eventId: string; sessionId: string; before: EventSessionRow;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_session.deleted',
    resourceType: 'event_session', resourceId: params.sessionId,
    beforeState: { event_id: params.eventId, ...pickFields(params.before, EVENT_SESSION_AUDIT_FIELDS) }, afterState: null,
  });
}

export async function logEventTicketTypeCreated(params: {
  organisationId: string; userId: string; eventId: string; ticketTypeId: string; after: EventTicketTypeRow;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_ticket_type.created',
    resourceType: 'event_ticket_type', resourceId: params.ticketTypeId, beforeState: null,
    afterState: { event_id: params.eventId, ...pickFields(params.after, EVENT_TICKET_TYPE_AUDIT_FIELDS) },
  });
}

export async function logEventTicketTypeUpdated(params: {
  organisationId: string; userId: string; eventId: string; ticketTypeId: string; before: EventTicketTypeRow; after: EventTicketTypeRow;
}): Promise<void> {
  const diff = diffFields(params.before, params.after, EVENT_TICKET_TYPE_AUDIT_FIELDS);
  if (!diff) return;
  // Phase 4 — a PATCH that touches the sale window or the access gate is
  // logged as `sale_window_changed` (the brief's own audit vocabulary),
  // with every changed field still carried in the diff; any other change
  // keeps the existing `.updated` action unchanged.
  const saleWindowChanged = Object.keys(diff.after).some(f => EVENT_TICKET_TYPE_SALE_WINDOW_FIELDS.has(f));
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId,
    action: saleWindowChanged ? 'event_ticket_type.sale_window_changed' : 'event_ticket_type.updated',
    resourceType: 'event_ticket_type', resourceId: params.ticketTypeId,
    beforeState: { event_id: params.eventId, ...diff.before }, afterState: { event_id: params.eventId, ...diff.after },
  });
}

// ── Promotional codes & presale access codes audit (Phase 4) ─────────
//
// resource_type 'event_promotion_code' / 'event_access_code' — each its
// own literal (ADR-0003 §10), resource_id = the code row's own id. Three
// actions each: .created, .updated (field diff only) and .disabled (an
// update whose only effect is active true -> false, called out
// separately because disabling is the organiser's "stop this code" act).
// Promotion code TEXT is marketing copy and is logged in full (approval
// D8); access code text is MASKED everywhere in audit state ("ME*****")
// because it gates restricted inventory. No order, purchaser or payment
// data ever appears here — these entries describe catalog configuration.

const EVENT_PROMOTION_CODE_AUDIT_FIELDS = ['code', 'discount_type', 'discount_value', 'active', 'starts_at', 'ends_at', 'max_redemptions', 'min_cart_cents', 'ticket_type_ids'] as const;
const EVENT_ACCESS_CODE_AUDIT_FIELDS = ['code', 'active', 'starts_at', 'ends_at', 'ticket_type_ids'] as const;

export type EventPromotionCodeAuditRow = Record<(typeof EVENT_PROMOTION_CODE_AUDIT_FIELDS)[number], unknown>;
export type EventAccessCodeAuditRow = Record<(typeof EVENT_ACCESS_CODE_AUDIT_FIELDS)[number], unknown>;

// Ticket-type id lists are compared as sorted, comma-joined strings so
// diffFields' scalar comparison works on them and ordering never reads
// as a change.
function normaliseIdList<T extends Record<string, unknown>>(row: T): T {
  const ids = row.ticket_type_ids;
  if (!Array.isArray(ids)) return row;
  return { ...row, ticket_type_ids: [...ids].map(String).sort().join(',') };
}

function codeAction(kind: 'event_promotion_code' | 'event_access_code', before: { active: unknown }, after: { active: unknown }): string {
  return before.active === true && after.active === false ? `${kind}.disabled` : `${kind}.updated`;
}

export async function logEventPromotionCodeCreated(params: {
  organisationId: string; userId: string; eventId: string; promotionCodeId: string; after: EventPromotionCodeAuditRow;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_promotion_code.created',
    resourceType: 'event_promotion_code', resourceId: params.promotionCodeId, beforeState: null,
    afterState: { event_id: params.eventId, ...pickFields(normaliseIdList(params.after), EVENT_PROMOTION_CODE_AUDIT_FIELDS) },
  });
}

export async function logEventPromotionCodeUpdated(params: {
  organisationId: string; userId: string; eventId: string; promotionCodeId: string; before: EventPromotionCodeAuditRow; after: EventPromotionCodeAuditRow;
}): Promise<void> {
  const diff = diffFields(normaliseIdList(params.before), normaliseIdList(params.after), EVENT_PROMOTION_CODE_AUDIT_FIELDS);
  if (!diff) return;
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId,
    action: codeAction('event_promotion_code', params.before as { active: unknown }, params.after as { active: unknown }),
    resourceType: 'event_promotion_code', resourceId: params.promotionCodeId,
    beforeState: { event_id: params.eventId, ...diff.before }, afterState: { event_id: params.eventId, ...diff.after },
  });
}

function maskAccessCodeRow<T extends Record<string, unknown>>(row: T, mask: (code: string) => string): T {
  return typeof row.code === 'string' ? { ...row, code: mask(row.code) } : row;
}

export async function logEventAccessCodeCreated(params: {
  organisationId: string; userId: string; eventId: string; accessCodeId: string; after: EventAccessCodeAuditRow; mask: (code: string) => string;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_access_code.created',
    resourceType: 'event_access_code', resourceId: params.accessCodeId, beforeState: null,
    afterState: { event_id: params.eventId, ...pickFields(maskAccessCodeRow(normaliseIdList(params.after), params.mask), EVENT_ACCESS_CODE_AUDIT_FIELDS) },
  });
}

export async function logEventAccessCodeUpdated(params: {
  organisationId: string; userId: string; eventId: string; accessCodeId: string; before: EventAccessCodeAuditRow; after: EventAccessCodeAuditRow; mask: (code: string) => string;
}): Promise<void> {
  const diff = diffFields(
    maskAccessCodeRow(normaliseIdList(params.before), params.mask),
    maskAccessCodeRow(normaliseIdList(params.after), params.mask),
    EVENT_ACCESS_CODE_AUDIT_FIELDS,
  );
  if (!diff) return;
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId,
    action: codeAction('event_access_code', params.before as { active: unknown }, params.after as { active: unknown }),
    resourceType: 'event_access_code', resourceId: params.accessCodeId,
    beforeState: { event_id: params.eventId, ...diff.before }, afterState: { event_id: params.eventId, ...diff.after },
  });
}

export async function logEventTicketTypeDeleted(params: {
  organisationId: string; userId: string; eventId: string; ticketTypeId: string; before: EventTicketTypeRow;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_ticket_type.deleted',
    resourceType: 'event_ticket_type', resourceId: params.ticketTypeId,
    beforeState: { event_id: params.eventId, ...pickFields(params.before, EVENT_TICKET_TYPE_AUDIT_FIELDS) }, afterState: null,
  });
}

// ── Ticket type × session inventory audit (Phase 3) ──────────────────
//
// resource_type 'event_ticket_type_session_inventory' — its own literal
// (ADR-0003 §10), exactly as event_session/event_ticket_type are above:
// an override row is a manager-editable catalog entity in its own right
// (set/cleared from the Sessions panel), not a sub-field of either
// parent. resource_id = the override row's own id. Setting an override
// (create OR change — one action, since the organiser sees one "Set"
// control and the write is an upsert) logs `.set` with the previous
// capacity (null when newly created); clearing logs `.cleared`. Both
// carry event_id, ticket_type_id and event_session_id in state so
// "which pair" is answered without a join. Capacity is public catalog
// data — never PII or payment detail.

export async function logEventTicketTypeSessionInventorySet(params: {
  organisationId: string; userId: string; eventId: string; sessionId: string; ticketTypeId: string; inventoryId: string;
  beforeCapacity: number | null; afterCapacity: number;
}): Promise<void> {
  const pair = { event_id: params.eventId, ticket_type_id: params.ticketTypeId, event_session_id: params.sessionId };
  if (params.beforeCapacity === params.afterCapacity) return;
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_ticket_type_session_inventory.set',
    resourceType: 'event_ticket_type_session_inventory', resourceId: params.inventoryId,
    beforeState: params.beforeCapacity === null ? null : { ...pair, capacity: params.beforeCapacity },
    afterState: { ...pair, capacity: params.afterCapacity },
  });
}

export async function logEventTicketTypeSessionInventoryCleared(params: {
  organisationId: string; userId: string; eventId: string; sessionId: string; ticketTypeId: string; inventoryId: string;
  beforeCapacity: number;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_ticket_type_session_inventory.cleared',
    resourceType: 'event_ticket_type_session_inventory', resourceId: params.inventoryId,
    beforeState: { event_id: params.eventId, ticket_type_id: params.ticketTypeId, event_session_id: params.sessionId, capacity: params.beforeCapacity },
    afterState: null,
  });
}

// ── Stripe Connect audit (Phase 8) ───────────────────────────────────
//
// resource_type 'stripe_connect_account', resource_id = the Stripe
// connected account id (acct_...) — already an acceptable, non-secret
// identifier by this codebase's own existing convention (stored in
// plain DB columns organisations.stripe_account_id/event_orders.
// stripe_account_id, and passed to createRefund/createCheckoutSession
// throughout lib/events/stripe.ts) — never the secret key, webhook
// secret, or any onboarding-link URL, none of which are ever accepted
// as parameters here.
export async function logStripeConnectOnboardingInitiated(params: {
  organisationId: string; userId: string; accountId: string; newAccount: boolean;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'stripe_connect_account.onboarding_initiated',
    resourceType: 'stripe_connect_account', resourceId: params.accountId, beforeState: null,
    afterState: { new_account: params.newAccount },
  });
}

// Callers (app/events/payments/connect/return/page.tsx) compare the
// cached state before and after refreshConnectedAccountStatus() and
// only call this when at least one field actually changed — an
// unchanged refresh (Stripe reports exactly what BrainBase already had
// cached) intentionally writes nothing, matching the task's own
// "where the stored BrainBase state changes" scope.
export async function logStripeConnectStatusRefreshed(params: {
  organisationId: string; userId: string; accountId: string;
  before: { status: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean };
  after: { status: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'stripe_connect_account.status_refreshed',
    resourceType: 'stripe_connect_account', resourceId: params.accountId,
    beforeState: params.before, afterState: params.after,
  });
}

// Eve organiser allow-list (lib/organisations/eveEnablement.ts) — the
// organisation-level decision that lets (or stops) its published events
// appearing on Eve. resource_type 'organisation', resource_id = the
// organisation's own id. Only the boolean itself is recorded.
export async function logOrganisationEveEnabledChanged(params: {
  organisationId: string; userId: string; before: boolean; after: boolean;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'organisation.eve_enabled_changed',
    resourceType: 'organisation', resourceId: params.organisationId,
    beforeState: { eve_enabled: params.before }, afterState: { eve_enabled: params.after },
  });
}
