import { prisma } from "../../prisma";
import type { GovernedColumnAddress } from "../workbookParser";

// Data Hub 6.2D4B — staging-eligibility gate. Read-only; no writes.
//
// disposition (WorksheetMappingProfileVersion.disposition) is the
// AUTHORITATIVE staging-eligibility signal: only 'STAGING_DATASET' may ever
// be staged. SourceSchemaWorksheet.role is a fail-closed CROSS-CHECK, never
// collapsed into disposition — a worksheet whose disposition says
// STAGING_DATASET but whose role isn't DATA (or vice versa) is treated as
// ineligible, never silently resolved by picking one field over the other.
//
// REMEDIATION (pinned-profile resume correction): resolveStagingEligibility
// is the gate for STARTING A NEW RUN ONLY. It follows
// WorksheetMappingProfile.active_profile_version_id, which is correct only
// at the moment a fresh run is created and pins that exact version onto the
// run. It must NEVER be called again for an ALREADY-EXISTING run — doing so
// was the bug an independent review found: resuming a run re-resolved
// header/profile semantics from whatever profile version happens to be
// active RIGHT NOW, silently reinterpreting an already-pinned run if the
// active pointer moved between requests. For any existing run, use
// resolvePinnedStagingRunContext (below) instead, which resolves
// EXCLUSIVELY from the run's own immutable pinned IDs and never reads
// active_profile_version_id at all.

export type StagingEligibilityFailureCode = "BATCH_NOT_READY" | "STAGING_INELIGIBLE" | "INVALID_STATE";

export type StagingEligibilityResult =
  | {
      ok: true;
      importBatchId: string;
      sourceSchemaVersionId: string;
      sourceSchemaWorksheetId: string;
      worksheetMappingProfileId: string;
      worksheetMappingProfileVersionId: string;
      headerRowOneBased: number;
      governedColumns: GovernedColumnAddress[];
      sha256: string;
      originalFilename: string;
      worksheetIndex: number;
      worksheetName: string;
    }
  | { ok: false; code: StagingEligibilityFailureCode };

/** undefined = invalid document; null = governed "no tabular header". */
function headerRowFromProfileDocument(doc: unknown): number | null | undefined {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return undefined;
  const keys = Object.keys(doc).sort();
  if (keys.join(",") !== "documentVersion,headerRowOneBased,schemaStatus") return undefined;
  const d = doc as { documentVersion: unknown; headerRowOneBased: unknown; schemaStatus: unknown };
  if (d.documentVersion !== 1 || typeof d.schemaStatus !== "string") return undefined;
  if (d.headerRowOneBased === null) return null;
  if (typeof d.headerRowOneBased !== "number" || !Number.isSafeInteger(d.headerRowOneBased) || d.headerRowOneBased < 1) {
    return undefined;
  }
  return d.headerRowOneBased;
}

export async function resolveStagingEligibility(context: {
  organisationId: string;
  uploadId: string;
}): Promise<StagingEligibilityResult> {
  const { organisationId, uploadId } = context;

  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: {
      import_batch_id: true,
      worksheet_index: true,
      worksheet_name: true,
      import_batch: {
        select: {
          status: true,
          deleted_at: true,
          sha256: true,
          original_filename: true,
          source_schema_version_id: true,
        },
      },
    },
  });
  if (
    !upload ||
    upload.import_batch_id === null ||
    upload.worksheet_index === null ||
    upload.worksheet_name === null ||
    !upload.import_batch
  ) {
    return { ok: false, code: "INVALID_STATE" };
  }
  const batch = upload.import_batch;
  if (batch.deleted_at !== null || batch.status !== "READY" || !batch.sha256 || !batch.source_schema_version_id) {
    return { ok: false, code: "BATCH_NOT_READY" };
  }

  // Upload carries no direct source_schema_worksheet_id column — D3D's own
  // lineage pinning proved worksheet identity via ordinal_hint/expected_name
  // agreement (matchImportBatchSchema's EXACT_MATCH), so resolving the
  // governed worksheet the same way here is consistent with that proof,
  // not a new/independent identity claim.
  const worksheet = await prisma.sourceSchemaWorksheet.findFirst({
    where: {
      organisation_id: organisationId,
      source_schema_version_id: batch.source_schema_version_id,
      ordinal_hint: upload.worksheet_index,
      expected_name: upload.worksheet_name,
    },
    select: { id: true, role: true },
  });
  if (!worksheet) return { ok: false, code: "INVALID_STATE" };

  const profile = await prisma.worksheetMappingProfile.findFirst({
    where: { organisation_id: organisationId, source_schema_worksheet_id: worksheet.id, active: true },
    select: { id: true, active_profile_version_id: true },
  });
  if (!profile || !profile.active_profile_version_id) return { ok: false, code: "STAGING_INELIGIBLE" };

  const profileVersion = await prisma.worksheetMappingProfileVersion.findFirst({
    where: { id: profile.active_profile_version_id, organisation_id: organisationId, worksheet_mapping_profile_id: profile.id },
    select: { id: true, disposition: true, profile_document: true },
  });
  if (!profileVersion) return { ok: false, code: "STAGING_INELIGIBLE" };

  // Fail-closed cross-check (correction 4): disposition and role are never
  // collapsed. Both must independently agree this worksheet is a staging
  // dataset.
  if (profileVersion.disposition !== "STAGING_DATASET" || worksheet.role !== "DATA") {
    return { ok: false, code: "STAGING_INELIGIBLE" };
  }

  const headerRowOneBased = headerRowFromProfileDocument(profileVersion.profile_document);
  if (headerRowOneBased === undefined || headerRowOneBased === null) {
    return { ok: false, code: "STAGING_INELIGIBLE" };
  }

  const columns = await prisma.sourceSchemaColumn.findMany({
    where: { organisation_id: organisationId, source_schema_worksheet_id: worksheet.id },
    orderBy: { ordinal: "asc" },
    select: { id: true, ordinal: true, source_header: true, sensitivity_class: true },
  });
  if (columns.length === 0) return { ok: false, code: "STAGING_INELIGIBLE" };

  const governedColumns: GovernedColumnAddress[] = columns.map((c) => ({
    id: c.id,
    ordinal: c.ordinal,
    sourceHeader: c.source_header,
    sensitivityClass: c.sensitivity_class,
  }));

  return {
    ok: true,
    importBatchId: upload.import_batch_id,
    sourceSchemaVersionId: batch.source_schema_version_id,
    sourceSchemaWorksheetId: worksheet.id,
    worksheetMappingProfileId: profile.id,
    worksheetMappingProfileVersionId: profileVersion.id,
    headerRowOneBased,
    governedColumns,
    sha256: batch.sha256,
    originalFilename: batch.original_filename,
    worksheetIndex: upload.worksheet_index,
    worksheetName: upload.worksheet_name,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// REMEDIATION — pinned-run execution-context resolver.
//
// The ONLY function an already-existing DataHubRawStagingRun may use to
// resolve its own execution semantics (header row, governed columns,
// storage identity). Resolves EXCLUSIVELY from the six immutable IDs
// already pinned onto the run at its creation:
//   import_batch_id, upload_id, source_schema_version_id,
//   source_schema_worksheet_id, worksheet_mapping_profile_id,
//   worksheet_mapping_profile_version_id
//
// This function DELIBERATELY NEVER reads
// WorksheetMappingProfile.active_profile_version_id, and DELIBERATELY
// NEVER re-checks disposition/role — those are policy-eligibility
// decisions that belong ONLY to resolveStagingEligibility, made once, at
// run creation, and frozen onto the run forever (a governed schema
// version and its WorksheetMappingProfileVersion rows are immutable once
// ACTIVE — see D3E — so nothing about a PINNED version's own header/
// column shape can legitimately change out from under a run; only the
// ACTIVE POINTER can move, and that must never retroactively reinterpret
// an already-pinned run). tests/containment/dataHubRawStagingRunFoundation
// .test.ts asserts this function's own source text never contains the
// literal "active_profile_version_id".
//
// Every check below is a STRUCTURAL COHERENCE check (does the pinned
// state still make sense / still exist), never a POLICY check.
// ═══════════════════════════════════════════════════════════════════════

export type PinnedStagingRunContextFailureCode = "INVALID_STATE" | "BATCH_NOT_READY";

export type PinnedStagingRunContextResult =
  | {
      ok: true;
      importBatchId: string;
      sourceSchemaVersionId: string;
      sourceSchemaWorksheetId: string;
      worksheetMappingProfileId: string;
      worksheetMappingProfileVersionId: string;
      headerRowOneBased: number;
      governedColumns: GovernedColumnAddress[];
      sha256: string;
      originalFilename: string;
      worksheetIndex: number;
      worksheetName: string;
    }
  | { ok: false; code: PinnedStagingRunContextFailureCode };

export async function resolvePinnedStagingRunContext(context: {
  organisationId: string;
  uploadId: string;
  importBatchId: string;
  sourceSchemaVersionId: string;
  sourceSchemaWorksheetId: string;
  worksheetMappingProfileId: string;
  worksheetMappingProfileVersionId: string;
}): Promise<PinnedStagingRunContextResult> {
  const { organisationId, uploadId, importBatchId, sourceSchemaVersionId, sourceSchemaWorksheetId, worksheetMappingProfileId, worksheetMappingProfileVersionId } = context;

  // Verify Upload still belongs to run/import batch/org.
  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, organisation_id: organisationId, lineage_kind: "DATA_HUB", import_batch_id: importBatchId },
    select: { worksheet_index: true, worksheet_name: true },
  });
  if (!upload || upload.worksheet_index === null || upload.worksheet_name === null) {
    return { ok: false, code: "INVALID_STATE" };
  }

  // Verify ImportBatch is READY, nondeleted, and still carries the SAME
  // pinned schema version the run itself was pinned against (D3D's own
  // lineage pinning already makes this immutable once set — this is a
  // defensive re-confirmation, not a new identity claim).
  const batch = await prisma.importBatch.findFirst({
    where: { id: importBatchId, organisation_id: organisationId },
    select: { status: true, deleted_at: true, sha256: true, original_filename: true, source_schema_version_id: true },
  });
  if (!batch || batch.deleted_at !== null) return { ok: false, code: "INVALID_STATE" };
  if (batch.status !== "READY" || !batch.sha256) return { ok: false, code: "BATCH_NOT_READY" };
  if (batch.source_schema_version_id !== sourceSchemaVersionId) return { ok: false, code: "INVALID_STATE" };

  // Load the EXACT pinned WorksheetMappingProfileVersion by the run's own
  // id — never today's active_profile_version_id — and verify it still
  // belongs to the run's own pinned profile/org.
  const profileVersion = await prisma.worksheetMappingProfileVersion.findFirst({
    where: { id: worksheetMappingProfileVersionId, organisation_id: organisationId, worksheet_mapping_profile_id: worksheetMappingProfileId },
    select: { id: true, profile_document: true },
  });
  if (!profileVersion) return { ok: false, code: "INVALID_STATE" };

  // Header row comes from THIS pinned version's own document — never
  // re-derived from whatever version is active today.
  const headerRowOneBased = headerRowFromProfileDocument(profileVersion.profile_document);
  if (headerRowOneBased === undefined || headerRowOneBased === null) {
    return { ok: false, code: "INVALID_STATE" };
  }

  // Verify worksheet/schema/org coherence.
  const worksheet = await prisma.sourceSchemaWorksheet.findFirst({
    where: { id: sourceSchemaWorksheetId, organisation_id: organisationId, source_schema_version_id: sourceSchemaVersionId },
    select: { id: true },
  });
  if (!worksheet) return { ok: false, code: "INVALID_STATE" };

  const columns = await prisma.sourceSchemaColumn.findMany({
    where: { organisation_id: organisationId, source_schema_worksheet_id: sourceSchemaWorksheetId },
    orderBy: { ordinal: "asc" },
    select: { id: true, ordinal: true, source_header: true, sensitivity_class: true },
  });
  if (columns.length === 0) return { ok: false, code: "INVALID_STATE" };

  const governedColumns: GovernedColumnAddress[] = columns.map((c) => ({
    id: c.id,
    ordinal: c.ordinal,
    sourceHeader: c.source_header,
    sensitivityClass: c.sensitivity_class,
  }));

  return {
    ok: true,
    importBatchId,
    sourceSchemaVersionId,
    sourceSchemaWorksheetId,
    worksheetMappingProfileId,
    worksheetMappingProfileVersionId,
    headerRowOneBased,
    governedColumns,
    // Source hash metadata needed for storage revalidation — read fresh
    // from ImportBatch (immutable post-finalization; never from the
    // profile/active-pointer chain).
    sha256: batch.sha256,
    originalFilename: batch.original_filename,
    worksheetIndex: upload.worksheet_index,
    worksheetName: upload.worksheet_name,
  };
}
