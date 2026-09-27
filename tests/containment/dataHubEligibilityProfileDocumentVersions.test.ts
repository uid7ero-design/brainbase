import { beforeEach, describe, expect, it, vi } from "vitest";

// Data Hub 6.2D4C-A — the PINNED-PROFILE GUARANTEE, proven behaviorally
// (not just via source-text containment): resolveStagingEligibility (the
// new-run-only gate) accepts BOTH historical v1 and new v2 profile
// documents; resolvePinnedStagingRunContext (the existing-run resolver)
// resolves EXCLUSIVELY from its own pinned worksheetMappingProfileVersionId
// and keeps returning that exact version's own header row even after
// WorksheetMappingProfile.active_profile_version_id has moved to a
// different version. Every profile_document fixture below with a
// columnRules unit is a SYNTHETIC test fixture, not an assertion about any
// real Onkaparinga source unit.

const ORG = "org-1";
const UPLOAD_ID = "up-1";
const IMPORT_BATCH_ID = "batch-1";
const SOURCE_SCHEMA_VERSION_ID = "sv-1";
const SOURCE_SCHEMA_WORKSHEET_ID = "ws-1";
const WORKSHEET_MAPPING_PROFILE_ID = "wp-1";
const V1_PROFILE_VERSION_ID = "pv-1";
const V2_PROFILE_VERSION_ID = "pv-2";

const reads = {
  uploadFindFirst: vi.fn(),
  importBatchFindFirst: vi.fn(),
  sourceSchemaWorksheetFindFirst: vi.fn(),
  worksheetMappingProfileFindFirst: vi.fn(),
  worksheetMappingProfileVersionFindFirst: vi.fn(),
  sourceSchemaColumnFindMany: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    upload: { findFirst: (...a: unknown[]) => reads.uploadFindFirst(...a) },
    importBatch: { findFirst: (...a: unknown[]) => reads.importBatchFindFirst(...a) },
    sourceSchemaWorksheet: { findFirst: (...a: unknown[]) => reads.sourceSchemaWorksheetFindFirst(...a) },
    worksheetMappingProfile: { findFirst: (...a: unknown[]) => reads.worksheetMappingProfileFindFirst(...a) },
    worksheetMappingProfileVersion: { findFirst: (...a: unknown[]) => reads.worksheetMappingProfileVersionFindFirst(...a) },
    sourceSchemaColumn: { findMany: (...a: unknown[]) => reads.sourceSchemaColumnFindMany(...a) },
  },
}));

const { resolveStagingEligibility, resolvePinnedStagingRunContext } = await import("@/lib/data-hub/staging/eligibility");

// A profile "row" the mutable `activeProfileVersionId` on this object lets
// tests simulate the active pointer moving between requests, exactly as
// WorksheetMappingProfile.active_profile_version_id can in the real table.
let activeProfileVersionId = V1_PROFILE_VERSION_ID;

const PROFILE_VERSIONS: Record<string, { id: string; disposition: string; profile_document: unknown }> = {
  [V1_PROFILE_VERSION_ID]: {
    id: V1_PROFILE_VERSION_ID,
    disposition: "STAGING_DATASET",
    profile_document: { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 3 },
  },
  [V2_PROFILE_VERSION_ID]: {
    id: V2_PROFILE_VERSION_ID,
    disposition: "STAGING_DATASET",
    profile_document: {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 5,
      columnRules: [{ sourceSchemaColumnId: "col-1", valueKind: "IDENTIFIER", preserveLeadingZeros: true }],
    },
  },
};

function arrangeCommonFixtures() {
  reads.uploadFindFirst.mockImplementation((args: { where: { import_batch_id?: string } }) => {
    if (args.where.import_batch_id && args.where.import_batch_id !== IMPORT_BATCH_ID) return null;
    return {
      import_batch_id: IMPORT_BATCH_ID,
      worksheet_index: 0,
      worksheet_name: "Runs",
      import_batch: {
        status: "READY",
        deleted_at: null,
        sha256: "abc123",
        original_filename: "june.xlsx",
        source_schema_version_id: SOURCE_SCHEMA_VERSION_ID,
      },
    };
  });
  reads.importBatchFindFirst.mockResolvedValue({
    status: "READY",
    deleted_at: null,
    sha256: "abc123",
    original_filename: "june.xlsx",
    source_schema_version_id: SOURCE_SCHEMA_VERSION_ID,
  });
  reads.sourceSchemaWorksheetFindFirst.mockResolvedValue({ id: SOURCE_SCHEMA_WORKSHEET_ID, role: "DATA" });
  reads.worksheetMappingProfileFindFirst.mockImplementation(() => ({
    id: WORKSHEET_MAPPING_PROFILE_ID,
    active_profile_version_id: activeProfileVersionId,
  }));
  reads.worksheetMappingProfileVersionFindFirst.mockImplementation((args: { where: { id: string } }) => PROFILE_VERSIONS[args.where.id] ?? null);
  reads.sourceSchemaColumnFindMany.mockResolvedValue([{ id: "col-1", ordinal: 0, source_header: "Id", sensitivity_class: "CONFIDENTIAL" }]);
}

beforeEach(() => {
  for (const fn of Object.values(reads)) fn.mockReset();
  activeProfileVersionId = V1_PROFILE_VERSION_ID;
  arrangeCommonFixtures();
});

describe("6.2D4C-A — resolveStagingEligibility (new-run gate) accepts both document versions", () => {
  it("12. accepts a v1 profile document when it is active", async () => {
    activeProfileVersionId = V1_PROFILE_VERSION_ID;
    const r = await resolveStagingEligibility({ organisationId: ORG, uploadId: UPLOAD_ID });
    expect(r).toMatchObject({ ok: true, headerRowOneBased: 3, worksheetMappingProfileVersionId: V1_PROFILE_VERSION_ID });
  });

  it("13. accepts a v2 profile document when it is active, using only headerRowOneBased (never columnRules)", async () => {
    activeProfileVersionId = V2_PROFILE_VERSION_ID;
    const r = await resolveStagingEligibility({ organisationId: ORG, uploadId: UPLOAD_ID });
    expect(r).toMatchObject({ ok: true, headerRowOneBased: 5, worksheetMappingProfileVersionId: V2_PROFILE_VERSION_ID });
    expect(r).not.toHaveProperty("columnRules");
  });
});

describe("6.2D4C-A — resolvePinnedStagingRunContext (resume path) — the pinned-profile guarantee", () => {
  it("14. a run pinned to v1 keeps reading its own v1 header after the active pointer flips to v2", async () => {
    activeProfileVersionId = V1_PROFILE_VERSION_ID;
    const created = await resolveStagingEligibility({ organisationId: ORG, uploadId: UPLOAD_ID });
    if (!created.ok) throw new Error("expected ok");
    expect(created.worksheetMappingProfileVersionId).toBe(V1_PROFILE_VERSION_ID);

    // Active pointer moves to v2 AFTER the run pinned itself to v1.
    activeProfileVersionId = V2_PROFILE_VERSION_ID;
    reads.worksheetMappingProfileFindFirst.mockClear();

    const resumed = await resolvePinnedStagingRunContext({
      organisationId: ORG,
      uploadId: UPLOAD_ID,
      importBatchId: created.importBatchId,
      sourceSchemaVersionId: created.sourceSchemaVersionId,
      sourceSchemaWorksheetId: created.sourceSchemaWorksheetId,
      worksheetMappingProfileId: created.worksheetMappingProfileId,
      worksheetMappingProfileVersionId: created.worksheetMappingProfileVersionId,
    });
    expect(resumed).toMatchObject({ ok: true, headerRowOneBased: 3 });
    // The resume path never even queries worksheetMappingProfile (no active-pointer lookup at all).
    expect(reads.worksheetMappingProfileFindFirst).not.toHaveBeenCalled();
  });

  it("15. a run pinned to v2 keeps reading its own v2 header if the active pointer changes back to v1", async () => {
    activeProfileVersionId = V2_PROFILE_VERSION_ID;
    const created = await resolveStagingEligibility({ organisationId: ORG, uploadId: UPLOAD_ID });
    if (!created.ok) throw new Error("expected ok");
    expect(created.worksheetMappingProfileVersionId).toBe(V2_PROFILE_VERSION_ID);

    activeProfileVersionId = V1_PROFILE_VERSION_ID;
    reads.worksheetMappingProfileFindFirst.mockClear();

    const resumed = await resolvePinnedStagingRunContext({
      organisationId: ORG,
      uploadId: UPLOAD_ID,
      importBatchId: created.importBatchId,
      sourceSchemaVersionId: created.sourceSchemaVersionId,
      sourceSchemaWorksheetId: created.sourceSchemaWorksheetId,
      worksheetMappingProfileId: created.worksheetMappingProfileId,
      worksheetMappingProfileVersionId: created.worksheetMappingProfileVersionId,
    });
    expect(resumed).toMatchObject({ ok: true, headerRowOneBased: 5 });
    expect(reads.worksheetMappingProfileFindFirst).not.toHaveBeenCalled();
  });

  it("17. resolvePinnedStagingRunContext never reads worksheetMappingProfile at all, for either document version", async () => {
    for (const pinnedId of [V1_PROFILE_VERSION_ID, V2_PROFILE_VERSION_ID]) {
      reads.worksheetMappingProfileFindFirst.mockClear();
      const resumed = await resolvePinnedStagingRunContext({
        organisationId: ORG,
        uploadId: UPLOAD_ID,
        importBatchId: IMPORT_BATCH_ID,
        sourceSchemaVersionId: SOURCE_SCHEMA_VERSION_ID,
        sourceSchemaWorksheetId: SOURCE_SCHEMA_WORKSHEET_ID,
        worksheetMappingProfileId: WORKSHEET_MAPPING_PROFILE_ID,
        worksheetMappingProfileVersionId: pinnedId,
      });
      expect(resumed.ok, pinnedId).toBe(true);
      expect(reads.worksheetMappingProfileFindFirst).not.toHaveBeenCalled();
    }
  });
});
