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
// This is called once, at run-creation time, per the 6.2D4B architecture
// decision that disposition/role are immutable governed facts once ACTIVE
// and are never re-checked at completion (only the run's own pinned
// worksheet_mapping_profile_version_id matters at completion — see
// completionGate.ts).

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
