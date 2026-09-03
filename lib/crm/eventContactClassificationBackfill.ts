import sql from '@/lib/db';
import { checkCapability } from '@/lib/capabilities/requireCapability';

// Historical CRM contact classification — PREVIEW ONLY in this phase.
// Deliberately a separate module from lib/crm/eventBackfill.ts: that
// file's own scope is order-to-contact LINKING (does a crm_contacts row
// exist / get created for a given event_orders row); this module's
// scope is CLASSIFICATION of contacts that already exist and are
// already linked. Different question, different evidence, kept apart
// the same way lib/crm/eventSync.ts and lib/crm/eventBackfill.ts are
// already kept apart from each other.
//
// EVIDENCE MODEL (see this phase's own audit report for the full
// reasoning): no single existing signal is both origin-specific AND
// immutable, so eligibility requires TWO independent, corroborating
// signals together:
//
//   1. crm_contacts.notes still starts with 'Events / Event Booking' or
//      'Events / Historical Backfill' — origin-specific by
//      construction (lib/crm/eventSync.ts and lib/crm/eventBackfill.ts
//      write this text ONLY on their brand-new-row INSERT branch,
//      never on a matched-existing-contact branch, which performs zero
//      writes). Mutable: a manager can overwrite `notes` via
//      PUT /api/crm/contacts/[id] at any time, so absence does not
//      disprove Events origin — it only means this tool safely skips
//      that row rather than risking a wrong guess.
//
//   2. At least one event_orders row in the SAME organisation currently
//      has crm_contact_id = this contact's id, resolved live at query
//      time (not a cached/precomputed flag) — a real, permanent
//      foreign key once set (no code anywhere ever nulls it), but not
//      origin-specific alone: eventSync.ts's own dedupe can link a
//      pre-existing, manually-created contact to an order without that
//      contact ever having been "created by" Events. Resolving it live
//      also means a link whose event was later deleted (which cascades
//      and removes its orders) naturally fails this check with no
//      separate cleanup logic needed.
//
// Neither signal alone is trusted. crm_activities booking-activity
// presence is reported for corroboration only — that write is
// documented as best-effort elsewhere in this codebase, so its absence
// must never disqualify an otherwise-eligible contact.
//
// classification IS NULL is enforced structurally, not just checked:
// CLIENT/LEAD/SUPPLIER/PARTNER/OTHER contacts are still INCLUDED in
// this preview's candidate universe (any contact with Events evidence,
// regardless of current classification) so a reviewer has full
// visibility into why they are being left alone — but they are always
// reported ineligible with an explicit "already classified" reason,
// never silently omitted and never eligible.
//
// DATA SAFETY: only crm_contacts.id/first_name/last_name/email/notes/
// classification, event_orders.crm_contact_id, and a crm_activities
// existence/count check are ever read here. No registration-question
// answer, no event_registration_responses/event_registration_questions
// table, is referenced anywhere in this file.
//
// THIS FILE PERFORMS ZERO WRITES. No UPDATE, no INSERT, no DELETE.
// Execution (an actual reclassification) is explicitly out of scope
// for this phase and does not exist anywhere in this module.

export interface ClassificationPreviewRow {
  contactId: string;
  name: string;
  email: string | null;
  currentClassification: string | null;
  notesMarker: 'Events / Event Booking' | 'Events / Historical Backfill' | null;
  linkedEventOrderCount: number;
  eventActivityCount: number;
  eligible: boolean;
  skipReason: string | null;
}

export interface ClassificationPreviewResult {
  crmEnabled: boolean;
  totalCandidates: number;
  eligibleCount: number;
  rows: ClassificationPreviewRow[];
}

const EVENTS_NOTES_MARKERS = ['Events / Event Booking', 'Events / Historical Backfill'] as const;

// Exported so its exact origin-specific matching can be unit tested
// directly, independent of the SQL candidate query.
export function detectEventsNotesMarker(notes: string | null): ClassificationPreviewRow['notesMarker'] {
  if (!notes) return null;
  for (const marker of EVENTS_NOTES_MARKERS) {
    if (notes.startsWith(marker)) return marker;
  }
  return null;
}

// Pure, exported, directly unit-testable — the exact three-tier
// priority this phase's audit specified: an existing classification
// always wins first (never overwritten, never even considered further);
// then the origin-specific notes marker; then the live order-link
// corroboration. Deliberately does NOT accept an activity count — that
// signal is informational only and must never affect this decision.
export function computeClassificationEligibility(input: {
  currentClassification: string | null;
  notesMarker: ClassificationPreviewRow['notesMarker'];
  linkedEventOrderCount: number;
}): { eligible: boolean; skipReason: string | null } {
  if (input.currentClassification !== null) {
    return { eligible: false, skipReason: `already classified (${input.currentClassification})` };
  }
  if (!input.notesMarker) {
    return { eligible: false, skipReason: 'no Events notes marker' };
  }
  if (input.linkedEventOrderCount === 0) {
    return { eligible: false, skipReason: 'no linked event order found' };
  }
  return { eligible: true, skipReason: null };
}

// Read-only. The candidate universe is deliberately broader than "NULL
// classification contacts" — it is every contact in this organisation
// with ANY Events evidence (notes marker OR a live order link),
// regardless of current classification — so an already-classified
// CLIENT/LEAD who also happens to have booked an event is visibly
// reported as ineligible with its own reason, never silently absent
// from the preview a reviewer is looking at.
export async function previewEventContactClassification(organisationId: string): Promise<ClassificationPreviewResult> {
  const capability = await checkCapability(organisationId, 'crm');
  if (!capability.allowed) return { crmEnabled: false, totalCandidates: 0, eligibleCount: 0, rows: [] };

  const rows = (await sql`
    SELECT
      c.id, c.first_name, c.last_name, c.email, c.notes, c.classification,
      (
        SELECT COUNT(*)::int FROM event_orders eo
        WHERE eo.organisation_id = ${organisationId} AND eo.crm_contact_id = c.id
      ) AS linked_order_count,
      (
        SELECT COUNT(*)::int FROM crm_activities a
        WHERE a.organisation_id = ${organisationId} AND a.contact_id = c.id
          AND a.type = 'note' AND split_part(a.body, E'\n', 1) LIKE 'Order: %'
      ) AS event_activity_count
    FROM crm_contacts c
    WHERE c.organisation_id = ${organisationId}
      AND (
        c.notes LIKE 'Events / Event Booking%'
        OR c.notes LIKE 'Events / Historical Backfill%'
        OR EXISTS (
          SELECT 1 FROM event_orders eo
          WHERE eo.organisation_id = ${organisationId} AND eo.crm_contact_id = c.id
        )
      )
    ORDER BY c.created_at ASC
  `) as {
    id: string; first_name: string; last_name: string; email: string | null;
    notes: string | null; classification: string | null;
    linked_order_count: number; event_activity_count: number;
  }[];

  const previewRows: ClassificationPreviewRow[] = rows.map(r => {
    const notesMarker = detectEventsNotesMarker(r.notes);
    const { eligible, skipReason } = computeClassificationEligibility({
      currentClassification: r.classification,
      notesMarker,
      linkedEventOrderCount: r.linked_order_count,
    });
    return {
      contactId: r.id,
      name: `${r.first_name} ${r.last_name}`.trim(),
      email: r.email,
      currentClassification: r.classification,
      notesMarker,
      linkedEventOrderCount: r.linked_order_count,
      eventActivityCount: r.event_activity_count,
      eligible,
      skipReason,
    };
  });

  return {
    crmEnabled: true,
    totalCandidates: previewRows.length,
    eligibleCount: previewRows.filter(r => r.eligible).length,
    rows: previewRows,
  };
}
