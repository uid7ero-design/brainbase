import sql from '@/lib/db';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { EVENT_CONTACT_CLASSIFICATION } from './classification';

// Historical CRM contact classification.
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
// EXECUTION (this phase): executeEventContactClassification() below
// re-derives eligibility from the database itself, via the exact same
// candidate query and the exact same computeClassificationEligibility()
// function preview uses (fetchClassificationCandidates() is shared by
// both, not duplicated) — it never trusts a client-supplied contact-id
// list or a stale preview response as authority. Each eligible
// contact's write is a single, guarded, atomic Postgres statement (a
// compound CTE, the same technique already established in
// lib/crm/eventSync.ts / lib/crm/eventBackfill.ts): the UPDATE only
// succeeds if classification IS STILL NULL at that exact moment, and
// the audit_logs INSERT is a CTE chained FROM that UPDATE's own RETURNING
// — so if the guarded UPDATE affects zero rows (a contact was manually
// classified in the gap between preview and execute, or by a concurrent
// execute run), the audit INSERT structurally cannot fire either.
// Nothing is ever left half-applied. Contacts are processed one at a
// time, each independently caught, mirroring executeEventContactBackfill's
// own established "one failure never aborts the rest of the batch" model.

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

type CandidateRow = {
  id: string; first_name: string; last_name: string; email: string | null;
  notes: string | null; classification: string | null;
  linked_order_count: number; event_activity_count: number;
};

// Shared by both preview and execute — the ONE place this candidate
// query is defined, so the two paths cannot silently diverge in what
// counts as evidence. The candidate universe is deliberately broader
// than "NULL classification contacts" — it is every contact in this
// organisation with ANY Events evidence (notes marker OR a live order
// link), regardless of current classification — so an already-
// classified CLIENT/LEAD who also happens to have booked an event is
// visibly reported as ineligible with its own reason, never silently
// absent.
async function fetchClassificationCandidates(organisationId: string): Promise<CandidateRow[]> {
  return (await sql`
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
  `) as CandidateRow[];
}

// Read-only.
export async function previewEventContactClassification(organisationId: string): Promise<ClassificationPreviewResult> {
  const capability = await checkCapability(organisationId, 'crm');
  if (!capability.allowed) return { crmEnabled: false, totalCandidates: 0, eligibleCount: 0, rows: [] };

  const rows = await fetchClassificationCandidates(organisationId);

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

export type ClassificationExecutionOutcome =
  | 'updated'
  | 'skipped_already_classified'
  | 'skipped_no_marker'
  | 'skipped_no_order_link'
  | 'skipped_stale'
  | 'failed';

export interface ClassificationExecutionRow {
  contactId: string;
  name: string;
  outcome: ClassificationExecutionOutcome;
  error?: string;
}

export interface ClassificationExecutionResult {
  crmEnabled: boolean;
  eligibleAtExecution: number;
  updatedCount: number;
  skippedCount: number;
  updated: ClassificationExecutionRow[];
  skipped: ClassificationExecutionRow[];
}

function outcomeForSkipReason(skipReason: string | null): ClassificationExecutionOutcome {
  if (!skipReason) return 'failed'; // unreachable in practice — eligible rows never reach this branch
  if (skipReason.startsWith('already classified')) return 'skipped_already_classified';
  if (skipReason === 'no Events notes marker') return 'skipped_no_marker';
  return 'skipped_no_order_link';
}

// Actually reclassifies eligible contacts. Re-derives eligibility from
// the database itself (fetchClassificationCandidates + the exact same
// computeClassificationEligibility used by preview) — a client-supplied
// candidate list or a previously-fetched preview response is NEVER
// trusted as authority for which rows get touched. organisationId and
// actorUserId must both come from the caller's own authenticated
// session (enforced by the route, not here) — this function accepts no
// other identity input.
export async function executeEventContactClassification(
  organisationId: string,
  actorUserId: string,
): Promise<ClassificationExecutionResult> {
  const capability = await checkCapability(organisationId, 'crm');
  if (!capability.allowed) return { crmEnabled: false, eligibleAtExecution: 0, updatedCount: 0, skippedCount: 0, updated: [], skipped: [] };

  const rows = await fetchClassificationCandidates(organisationId);

  const updated: ClassificationExecutionRow[] = [];
  const skipped: ClassificationExecutionRow[] = [];
  let eligibleAtExecution = 0;

  for (const r of rows) {
    const name = `${r.first_name} ${r.last_name}`.trim();
    const notesMarker = detectEventsNotesMarker(r.notes);
    const { eligible, skipReason } = computeClassificationEligibility({
      currentClassification: r.classification,
      notesMarker,
      linkedEventOrderCount: r.linked_order_count,
    });

    if (!eligible) {
      skipped.push({ contactId: r.id, name, outcome: outcomeForSkipReason(skipReason) });
      continue;
    }
    eligibleAtExecution++;

    try {
      // One compound statement: the UPDATE's own WHERE re-checks
      // classification IS NULL at the moment this actually runs (not
      // at the moment the candidate query above ran) — a contact
      // manually classified, or concurrently classified by another
      // execute run, in that gap causes RETURNING to yield zero rows,
      // which means the audit_logs INSERT (chained FROM that RETURNING)
      // structurally cannot fire either. Never leaves a changed
      // classification without its audit row, and never audits a
      // no-op.
      const result = (await sql`
        WITH upd AS (
          UPDATE crm_contacts
          SET classification = ${EVENT_CONTACT_CLASSIFICATION}
          WHERE id = ${r.id} AND organisation_id = ${organisationId} AND classification IS NULL
          RETURNING id
        ),
        matched_orders AS (
          SELECT COALESCE(json_agg(eo.id), '[]'::json) AS order_ids
          FROM event_orders eo, upd
          WHERE eo.organisation_id = ${organisationId} AND eo.crm_contact_id = upd.id
        ),
        audit AS (
          INSERT INTO audit_logs (organisation_id, user_id, action, resource_type, resource_id, detail)
          SELECT
            ${organisationId}, ${actorUserId}, 'crm_contact.historical_classification_backfill', 'crm_contact', upd.id,
            jsonb_build_object(
              'previous_classification', NULL,
              'new_classification', ${EVENT_CONTACT_CLASSIFICATION},
              'source', 'events_historical_classification_backfill',
              'notes_marker', ${notesMarker},
              'matched_order_ids', (SELECT order_ids FROM matched_orders)
            )
          FROM upd
          RETURNING id
        )
        SELECT (SELECT id FROM upd) AS updated_id
      `) as { updated_id: string | null }[];

      if (result[0]?.updated_id) {
        updated.push({ contactId: r.id, name, outcome: 'updated' });
      } else {
        skipped.push({ contactId: r.id, name, outcome: 'skipped_stale' });
      }
    } catch (err) {
      skipped.push({ contactId: r.id, name, outcome: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    crmEnabled: true,
    eligibleAtExecution,
    updatedCount: updated.length,
    skippedCount: skipped.length,
    updated,
    skipped,
  };
}
