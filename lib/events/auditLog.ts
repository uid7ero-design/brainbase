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

async function insertAuditLog(entry: {
  organisationId: string;
  userId: string | null;
  action: string;
  resourceId: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      VALUES (
        ${crypto.randomUUID()}, ${entry.organisationId}, ${entry.userId}, ${entry.action}, 'event_order', ${entry.resourceId},
        ${entry.beforeState ? JSON.stringify(entry.beforeState) : null}::jsonb,
        ${entry.afterState ? JSON.stringify(entry.afterState) : null}::jsonb
      )
    `;
  } catch (err) {
    console.error('[events audit] audit_logs write failed (ignored — the underlying mutation remains valid)', err, { action: entry.action, resourceId: entry.resourceId });
  }
}

export async function logPurchaserEdited(params: {
  organisationId: string; userId: string; orderId: string;
  before: { purchaser_name: string; purchaser_email: string; purchaser_phone: string | null };
  after: { purchaser_name: string; purchaser_email: string; purchaser_phone: string | null };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.purchaser_edited',
    resourceId: params.orderId, beforeState: params.before, afterState: params.after,
  });
}

export async function logAttendeeEdited(params: {
  organisationId: string; userId: string; orderId: string; attendeeId: string;
  before: { attendee_name: string; attendee_email: string | null };
  after: { attendee_name: string; attendee_email: string | null };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.attendee_edited',
    resourceId: params.orderId, beforeState: { attendee_id: params.attendeeId, ...params.before },
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
    resourceId: params.orderId,
    beforeState: { response_id: params.responseId, question_id: params.questionId, field_type: params.fieldType },
    afterState: null,
  });
}

export async function logCheckedIn(params: { organisationId: string; userId: string; orderId: string; attendeeId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.checked_in',
    resourceId: params.orderId, beforeState: null, afterState: { attendee_id: params.attendeeId },
  });
}

export async function logCheckInUndone(params: { organisationId: string; userId: string; orderId: string; attendeeId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.check_in_undone',
    resourceId: params.orderId, beforeState: { attendee_id: params.attendeeId }, afterState: null,
  });
}

export async function logCancelled(params: { organisationId: string; userId: string; orderId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.cancelled',
    resourceId: params.orderId, beforeState: null, afterState: null,
  });
}

export async function logRefunded(params: { organisationId: string; userId: string; orderId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.refunded',
    resourceId: params.orderId, beforeState: null, afterState: null,
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
    resourceId: params.orderId, beforeState: null, afterState: { note_id: params.noteId },
  });
}

export async function logNoteEdited(params: { organisationId: string; userId: string; orderId: string; noteId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.note_edited',
    resourceId: params.orderId, beforeState: { note_id: params.noteId }, afterState: null,
  });
}

export async function logNoteDeleted(params: { organisationId: string; userId: string; orderId: string; noteId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'event_order.note_deleted',
    resourceId: params.orderId, beforeState: { note_id: params.noteId }, afterState: null,
  });
}
