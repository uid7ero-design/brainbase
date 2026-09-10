// 5B.4C — narrow, disposable, real-Postgres proof.
//
// NOT part of the default vitest containment suite (tests/containment/**) —
// invoked explicitly via `npx vitest run tests/postgres-proof/...` against a
// throwaway `postgres:16` Docker container, never Production/Preview.
//
// Scope: proves the frozen-lineage-consumption invariants of
// previewWorksheet.ts against a REAL Postgres schema/FKs/constraints
// (pushed from the actual prisma/schema.prisma), using the REAL, unmodified
// @/lib/prisma Prisma Client — nothing about Prisma or the database layer is
// mocked. Only the Blob storage composition root is mocked (an in-memory
// byte store keyed by import-batch key), because this proof's target is the
// mapping-lineage DB semantics, not the storage provider — the storage
// layer is already exhaustively covered by the mocked-Prisma containment
// suite.
//
// DATABASE_URL/DIRECT_URL must already point at the disposable container
// when this file is invoked (see the runbook in the final report).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildImportBatchKey } from "../../lib/data-hub/storage/rawFileStore";

if (!process.env.DATABASE_URL?.includes("55432")) {
  throw new Error(
    "Refusing to run: DATABASE_URL does not point at the disposable proof container (port 55432). " +
      "This proof must never run against Production/Preview."
  );
}

const inMemoryBlobs = new Map<string, Buffer>();

vi.mock("@/lib/data-hub/importBatch/compositionRoot", () => ({
  createImportBatchStorage: () => ({
    provider: "in-memory-proof-store",
    put: vi.fn(),
    head: vi.fn(),
    get: async (key: string) => {
      const body = inMemoryBlobs.get(key);
      if (!body) throw new Error(`proof store: no blob for key ${key}`);
      return { body };
    },
    delete: vi.fn(),
  }),
}));

const prisma = new PrismaClient();

function buildCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

describe("5B.4C previewWorksheet — real disposable Postgres proof", () => {
  let organisationId: string;
  let sourceSystemS1: string;
  let sourceSystemS2: string;
  let sourceMappingId: string;
  let mappingVersionV3: string;
  let mappingVersionV4: string;
  let importBatchId: string;
  let worksheetId: string;

  beforeAll(async () => {
    const org = await prisma.organisation.create({
      data: { name: "5B4C Proof Org", slug: `proof-org-${Date.now()}` },
    });
    organisationId = org.id;

    const s1 = await prisma.sourceSystem.create({
      data: { organisation_id: organisationId, name: "S1", active: true },
    });
    sourceSystemS1 = s1.id;

    const s2 = await prisma.sourceSystem.create({
      data: { organisation_id: organisationId, name: "S2 (foreign)", active: true },
    });
    sourceSystemS2 = s2.id;

    const sourceMapping = await prisma.sourceMapping.create({
      data: { organisation_id: organisationId, source_system_id: sourceSystemS1, name: "SM1", active: true },
    });
    sourceMappingId = sourceMapping.id;

    const document = { fields: { report_date: "Reported At", location: "Site", waste_type: "Type" } };

    const v3 = await prisma.mappingVersion.create({
      data: {
        organisation_id: organisationId,
        source_mapping_id: sourceMappingId,
        version_number: 3,
        mapping_document: document,
      },
    });
    mappingVersionV3 = v3.id;

    const v4 = await prisma.mappingVersion.create({
      data: {
        organisation_id: organisationId,
        source_mapping_id: sourceMappingId,
        version_number: 4,
        mapping_document: document,
      },
    });
    mappingVersionV4 = v4.id;

    const csv = buildCsv(["Reported At", "Site", "Type"], [["2024-01-01", "Kerbside", "Dumped Rubbish"]]);
    const body = Buffer.from(csv, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");

    const batch = await prisma.importBatch.create({
      data: {
        organisation_id: organisationId,
        source_system_id: sourceSystemS1,
        original_filename: "s1-export.csv",
        content_type: "csv",
        size_bytes: body.byteLength,
        sha256,
        storage_provider: "in-memory-proof-store",
        storage_key: `proof-key-${Date.now()}`,
        status: "READY",
      },
    });
    importBatchId = batch.id;
    inMemoryBlobs.set(buildImportBatchKey(organisationId, importBatchId), body);

    const worksheet = await prisma.upload.create({
      data: {
        organisation_id: organisationId,
        original_name: "s1-export.csv",
        stored_path: "n/a",
        mimetype: "text/csv",
        size_bytes: body.byteLength,
        lineage_kind: "DATA_HUB",
        import_batch_id: importBatchId,
        worksheet_index: 0,
        canonical_status: "AWAITING_CONFIRMATION",
        mapping_version_id: mappingVersionV3,
      },
    });
    worksheetId = worksheet.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("A. persisted S1/v3 lineage -> Preview resolves and uses v3", async () => {
    vi.resetModules();
    const { previewWorksheet } = await import("../../lib/data-hub/importBatch/previewWorksheet");
    const result = await previewWorksheet({ organisationId, worksheetId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.mappingVersionId).toBe(mappingVersionV3);
    expect(result.preview.mapping?.versionNumber).toBe(3);
    expect(result.preview.mapping?.structurallyValid).toBe(true);
    expect(result.preview.mapping?.domainRowsValid).toBe(true);
  });

  it("B. activating v4 on the SAME SourceMapping WITHOUT reselection -> Preview still reports v3", async () => {
    await prisma.sourceMapping.update({
      where: { id: sourceMappingId },
      data: { active_mapping_version_id: mappingVersionV4 },
    });

    const freshWorksheet = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(freshWorksheet.mapping_version_id).toBe(mappingVersionV3);

    vi.resetModules();
    const { previewWorksheet } = await import("../../lib/data-hub/importBatch/previewWorksheet");
    const result = await previewWorksheet({ organisationId, worksheetId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.mappingVersionId).toBe(mappingVersionV3);
    expect(result.preview.mapping?.versionNumber).toBe(3);
  });

  it("C. deactivating SourceMapping and SourceSystem -> v3 remains consumable (frozen lineage survives deactivation)", async () => {
    await prisma.sourceMapping.update({ where: { id: sourceMappingId }, data: { active: false } });
    await prisma.sourceSystem.update({ where: { id: sourceSystemS1 }, data: { active: false } });

    vi.resetModules();
    const { previewWorksheet } = await import("../../lib/data-hub/importBatch/previewWorksheet");
    const result = await previewWorksheet({ organisationId, worksheetId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mapping?.mappingVersionId).toBe(mappingVersionV3);
    expect(result.preview.mapping?.versionNumber).toBe(3);
  });

  it("D. corrupting cross-source lineage (SourceMapping repointed to a DIFFERENT SourceSystem than the batch) -> safe MAPPING_LINEAGE_UNAVAILABLE failure, no crash", async () => {
    await prisma.sourceMapping.update({
      where: { id: sourceMappingId },
      data: { source_system_id: sourceSystemS2 },
    });

    vi.resetModules();
    const { previewWorksheet } = await import("../../lib/data-hub/importBatch/previewWorksheet");
    const result = await previewWorksheet({ organisationId, worksheetId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MAPPING_LINEAGE_UNAVAILABLE");

    // restore for subsequent tests
    await prisma.sourceMapping.update({
      where: { id: sourceMappingId },
      data: { source_system_id: sourceSystemS1 },
    });
  });

  it("E. a full Preview call performs zero database writes (row counts and the worksheet row itself are unchanged before/after)", async () => {
    const before = {
      uploads: await prisma.upload.count(),
      batches: await prisma.importBatch.count(),
      illegalDumping: await prisma.illegalDumping.count(),
      mappingVersions: await prisma.mappingVersion.count(),
      sourceMappings: await prisma.sourceMapping.count(),
      sourceSystems: await prisma.sourceSystem.count(),
    };
    const worksheetBefore = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });

    vi.resetModules();
    const { previewWorksheet } = await import("../../lib/data-hub/importBatch/previewWorksheet");
    const result = await previewWorksheet({ organisationId, worksheetId });
    expect(result.ok).toBe(true);

    const after = {
      uploads: await prisma.upload.count(),
      batches: await prisma.importBatch.count(),
      illegalDumping: await prisma.illegalDumping.count(),
      mappingVersions: await prisma.mappingVersion.count(),
      sourceMappings: await prisma.sourceMapping.count(),
      sourceSystems: await prisma.sourceSystem.count(),
    };
    expect(after).toEqual(before);

    const worksheetAfter = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(worksheetAfter).toEqual(worksheetBefore);
  });
});
