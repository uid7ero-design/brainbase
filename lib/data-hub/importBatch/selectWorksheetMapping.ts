import { prisma } from "../../prisma";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";

// Data Hub 5B.4B — dedicated worksheet mapping-selection service.
//
// AUTH BOUNDARY: exactly the same discipline as confirmWorksheet.ts. This
// function accepts an already-resolved trusted context (organisationId,
// worksheetUploadId) plus one caller-chosen field (sourceMappingId) as
// plain parameters. It never resolves its own session and never imports
// lib/org.ts. The HTTP route wrapping this service is solely responsible
// for requireRole("manager") and for sourcing organisationId exclusively
// from that resolved session — never from request input.
//
// TRUSTED INPUT: the caller supplies exactly {organisationId,
// worksheetUploadId, sourceMappingId}. It never accepts mappingVersionId,
// sourceSystemId, or organisationId as request-shaped input — the server
// resolves the batch's authoritative source_system_id from the worksheet's
// own persisted parent, and resolves the exact active MappingVersion from
// the chosen SourceMapping itself. There is no way for a caller to name a
// MappingVersion directly.
//
// LINEAGE ESTABLISHMENT ONLY: this service freezes an exact, already-
// immutable MappingVersion id onto Upload.mapping_version_id. It performs
// no mapping execution, no Preview integration, no Confirm integration —
// see mappingExecution.ts / previewWorksheet.ts / confirmWorksheet.ts,
// none of which reference this file.
//
// ONE TRANSACTION, NO TOCTOU: every authoritative read (worksheet, parent
// batch, SourceSystem, SourceMapping, MappingVersion) and the eventual
// Upload write all happen inside ONE interactive transaction — mirroring
// activateMappingVersion.ts's own established shape. The active-version
// pointer is read exactly once (from the chosen SourceMapping, inside this
// transaction) and that same resolved id is what gets verified and
// persisted — there is no second, later re-read of the pointer that could
// observe a different value than what was already verified.
//
// FREEZE-ON-WRITE, NOT A LIVE REFERENCE: SourceMapping.active_mapping_version_id
// is resolved at THIS call's own moment, not linked. If an admin activates
// a newer version afterward with no further call to this service, the
// already-persisted Upload.mapping_version_id is untouched — only an
// explicit, later call to this same service (an operator-initiated
// reselection) can move it forward, and it will resolve whatever is
// current AT THAT LATER CALL's own moment, by the same rule.
//
// ATOMIC CONDITIONAL WRITE / FUTURE CONFIRM-RACE SAFETY: the Upload write
// is a conditional UPDATE whose WHERE clause repeats every eligibility
// predicate (id, organisation_id, lineage_kind, canonical_status =
// AWAITING_CONFIRMATION) — never a separate SELECT-then-UPDATE. This is
// the same atomic-conditional-update shape confirmWorksheet.ts's own claim
// already uses for the identical row, under the database's own standard
// read-committed row-level locking — so a concurrent confirmWorksheet.ts
// claim and a concurrent call to this service can never both "win": one
// UPDATE's WHERE clause will see the other's already-committed result and
// affect zero rows. No new locking primitive is introduced.
export interface SelectWorksheetMappingTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  worksheetUploadId: string;
  /** Caller's only real choice — a SourceMapping id, never a MappingVersion id. */
  sourceMappingId: unknown;
}

export type SelectWorksheetMappingOutcome =
  | {
      ok: true;
      worksheetUploadId: string;
      sourceMappingId: string;
      mappingVersionId: string;
      versionNumber: number;
    }
  | { ok: false; code: FailureCode; message: string };

function fail(code: FailureCode): SelectWorksheetMappingOutcome {
  return { ok: false, code, message: getMessageTemplate(code) };
}

/**
 * Selects (or reselects) the SourceMapping/MappingVersion lineage for one
 * DATA_HUB worksheet.
 *
 * Flow (all inside one transaction): tenant+lineage-scoped worksheet
 * lookup -> AWAITING_CONFIRMATION precondition -> tenant-scoped parent
 * ImportBatch lookup via the worksheet's own persisted import_batch_id
 * (never caller input) -> NULL source_system_id blocks selection entirely
 * (SOURCE_LINEAGE_REQUIRED) -> parent SourceSystem must be active for a
 * NEW selection (deactivation after an EXISTING selection does not
 * invalidate it — this check only gates NEW/RE selection) ->
 * tenant-scoped SourceMapping lookup, must be active, and its
 * source_system_id must equal the batch's own authoritative
 * source_system_id (the one application-level invariant the DB itself
 * cannot express as an FK) -> SourceMapping must carry a non-null
 * active_mapping_version_id -> that exact MappingVersion is resolved and
 * application-verified to belong to this same SourceMapping and tenant
 * (never trusted merely because the composite FK exists) -> an atomic
 * conditional UPDATE persists that exact MappingVersion id onto
 * Upload.mapping_version_id, gated on the worksheet still being
 * AWAITING_CONFIRMATION at write time.
 *
 * Every rejection reason for the SourceMapping (foreign, nonexistent,
 * inactive, wrong-source, no active version, corrupt/unresolvable active
 * pointer) collapses into the single SOURCE_MAPPING_UNAVAILABLE code —
 * deliberately not distinguished, to avoid leaking foreign-tenant
 * existence or internal mapping state to an unauthorized caller.
 */
export async function selectWorksheetMapping(
  context: SelectWorksheetMappingTrustedContext
): Promise<SelectWorksheetMappingOutcome> {
  const { organisationId, worksheetUploadId } = context;

  if (typeof context.sourceMappingId !== "string" || context.sourceMappingId.length === 0) {
    return fail("INVALID_REQUEST");
  }
  const sourceMappingId = context.sourceMappingId;

  return prisma.$transaction(async (tx) => {
    // ---- Step 1 — tenant + DATA_HUB lineage-scoped worksheet lookup, the
    // SAME predicate as confirmWorksheet.ts's own Step 1. Nonexistent,
    // wrong-tenant, and LEGACY-lineage all collapse into WORKSHEET_NOT_FOUND. ----
    const worksheet = await tx.upload.findFirst({
      where: { id: worksheetUploadId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
      select: { id: true, import_batch_id: true, canonical_status: true },
    });
    if (!worksheet || worksheet.import_batch_id === null) {
      return fail("WORKSHEET_NOT_FOUND");
    }

    // ---- Step 2 — state precondition. Mapping selection/reselection is
    // allowed ONLY while AWAITING_CONFIRMATION. IMPORTED/SKIPPED/INELIGIBLE/
    // any other value are all rejected identically, mirroring
    // WORKSHEET_NOT_ELIGIBLE's existing non-distinguishing discipline —
    // there is no "unlock" path back to selectability from any of them. ----
    if (worksheet.canonical_status !== "AWAITING_CONFIRMATION") {
      return fail("WORKSHEET_NOT_ELIGIBLE");
    }

    // ---- Step 3 — parent ImportBatch lookup via the worksheet's OWN
    // persisted import_batch_id (never caller input), tenant-scoped via the
    // compound id_organisation_id key. This batch's source_system_id is the
    // sole authoritative source lineage for every worksheet under it. ----
    const batch = await tx.importBatch.findUnique({
      where: { id_organisation_id: { id: worksheet.import_batch_id, organisation_id: organisationId } },
      select: { source_system_id: true },
    });
    if (!batch) {
      return fail("WORKSHEET_NOT_FOUND");
    }

    // ---- Step 4 — NULL-source policy (5B.4 architecture decision, not an
    // oversight): a batch with no SourceSystem lineage cannot enter the
    // mapping-selection pipeline at all. No inference, no backfill, no
    // silent permission. ----
    if (batch.source_system_id === null) {
      return fail("SOURCE_LINEAGE_REQUIRED");
    }
    const authoritativeSourceSystemId = batch.source_system_id;

    // ---- Step 5 — parent SourceSystem must be active for a NEW/RE
    // selection. This id is the batch's own trusted, already-tenant-scoped
    // value — never caller input — so there is no foreign-tenant existence
    // question to hide here; still collapsed into the same public
    // SOURCE_MAPPING_UNAVAILABLE class for a uniform "this selection is not
    // currently possible" surface. Later deactivation does NOT run this
    // check again for an already-persisted Upload — this function is only
    // ever invoked for a new/re selection. ----
    const system = await tx.sourceSystem.findUnique({
      where: { id_organisation_id: { id: authoritativeSourceSystemId, organisation_id: organisationId } },
      select: { active: true },
    });
    if (!system || !system.active) {
      return fail("SOURCE_MAPPING_UNAVAILABLE");
    }

    // ---- Step 6 — tenant-scoped SourceMapping lookup. Must be active, and
    // — the critical application-level invariant the DB cannot express as
    // an FK — its source_system_id must equal the batch's own authoritative
    // source_system_id. A same-tenant mapping under the WRONG SourceSystem
    // is rejected exactly like a foreign/nonexistent/inactive one. ----
    const mapping = await tx.sourceMapping.findUnique({
      where: { id_organisation_id: { id: sourceMappingId, organisation_id: organisationId } },
      select: { id: true, active: true, source_system_id: true, active_mapping_version_id: true },
    });
    if (!mapping || !mapping.active || mapping.source_system_id !== authoritativeSourceSystemId) {
      return fail("SOURCE_MAPPING_UNAVAILABLE");
    }

    // ---- Step 7 — active-version resolution. No fallback to "latest"
    // (MAX(version_number)) if the pointer is absent — a mapping with no
    // active version simply cannot be selected yet. ----
    if (mapping.active_mapping_version_id === null) {
      return fail("SOURCE_MAPPING_UNAVAILABLE");
    }

    // ---- Step 8 — application-verify the resolved MappingVersion actually
    // belongs to THIS mapping and THIS tenant — never trust the pointer
    // merely because the composite FK exists. A corrupt/unresolvable
    // pointer fails safely here, identically to every other rejection in
    // this domain — never a raw exception, never a guessed fallback. ----
    const version = await tx.mappingVersion.findUnique({
      where: { id_organisation_id: { id: mapping.active_mapping_version_id, organisation_id: organisationId } },
      select: { id: true, source_mapping_id: true, version_number: true },
    });
    if (!version || version.source_mapping_id !== mapping.id) {
      return fail("SOURCE_MAPPING_UNAVAILABLE");
    }

    // ---- Step 9 — the atomic conditional write. This exact, already-
    // resolved-and-verified MappingVersion id is what gets persisted — the
    // pointer is never re-read here. The WHERE clause repeats every
    // eligibility predicate so a concurrent state transition (a
    // confirmWorksheet.ts claim, or another selection call) can never be
    // silently overwritten: if this affects zero rows, something else won
    // a race between Step 1's read and this write, and this call makes no
    // change. Idempotent by construction: an identical repeat call while
    // still AWAITING_CONFIRMATION always re-satisfies this same predicate
    // and persists the same (or, after an explicit admin reactivation,
    // deliberately different) resolved value. ----
    const claim = await tx.upload.updateMany({
      where: {
        id: worksheetUploadId,
        organisation_id: organisationId,
        lineage_kind: "DATA_HUB",
        canonical_status: "AWAITING_CONFIRMATION",
      },
      data: { mapping_version_id: version.id },
    });

    if (claim.count === 0) {
      // Lost a race against a concurrent state transition (most likely a
      // confirmWorksheet.ts claim) between Step 1's read and this write.
      // No fallback distinction is made — the worksheet is simply no
      // longer eligible for selection, exactly mirroring
      // confirmWorksheet.ts's own "lost the claim" handling shape.
      return fail("WORKSHEET_NOT_ELIGIBLE");
    }

    return {
      ok: true,
      worksheetUploadId,
      sourceMappingId: mapping.id,
      mappingVersionId: version.id,
      versionNumber: version.version_number,
    };
  });
}
