// 5B.4D — narrow, disposable, real-Postgres proof.
//
// NOT part of the default vitest containment suite (tests/containment/**) —
// invoked explicitly via `npx vitest run --config
// tests/postgres-proof/vitest.proof.config.ts` against a throwaway
// `postgres:16-alpine` Docker container, never Production/Preview.
//
// Scope: proves the frozen-lineage-consumption + version-bound-atomic-claim
// invariants of confirmWorksheet.ts's MAPPED path against a REAL Postgres
// schema/FKs/constraints (pushed from the actual prisma/schema.prisma),
// using the REAL, unmodified @/lib/prisma Prisma Client — nothing about
// Prisma or the database layer is mocked. Only the Blob storage composition
// root is mocked (an in-memory byte store keyed by import-batch key),
// mirroring previewWorksheet.postgres-proof.test.ts's own established
// pattern exactly.
//
// The selection-vs-confirm MID-FLIGHT race (Section 12/13/14) is NOT
// reproduced here — that exact interleaving (a second transaction
// committing between this transaction's own read and write) is not
// deterministically reproducible against a real, single-threaded test
// process without an artificial delay/second connection race, which Section
// 13 explicitly permits substituting with a deterministic mocked
// write-boundary proof instead (see tests/containment/confirmWorksheet.test.ts's
// own "DETERMINISTIC selection-vs-confirm write-boundary race proof" block,
// including the required M1 mutation). What IS proven here in real Postgres
// is that a genuinely CHANGED mapping_version_id (persisted before Confirm
// ever runs, not mid-flight) is correctly reflected in the claim's own
// WHERE clause via a real UPDATE — see scenario B below.
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

const MAPPED_HEADERS = ["Reported At", "Site", "Type"];
const MAPPING_DOCUMENT = { fields: { report_date: "Reported At", location: "Site", waste_type: "Type" } };

describe("5B.4D confirmWorksheet — real disposable Postgres proof", () => {
  let organisationId: string;
  let sourceSystemS1: string;
  let sourceSystemS2: string;
  let sourceMappingId: string;
  let mappingVersionV3: string;
  let mappingVersionV4: string;
  let actor1: string;
  let actor2: string;

  beforeAll(async () => {
    const org = await prisma.organisation.create({
      data: { name: "5B4D Proof Org", slug: `proof-org-5b4d-${Date.now()}` },
    });
    organisationId = org.id;

    // confirmed_by is a real FK to User.id (uploads_confirmed_by_fkey) —
    // real user rows are required, not arbitrary strings.
    const u1 = await prisma.user.create({
      data: { organisation_id: organisationId, username: `actor1-${Date.now()}`, name: "Actor One" },
    });
    actor1 = u1.id;
    const u2 = await prisma.user.create({
      data: { organisation_id: organisationId, username: `actor2-${Date.now()}`, name: "Actor Two" },
    });
    actor2 = u2.id;

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

    const v3 = await prisma.mappingVersion.create({
      data: { organisation_id: organisationId, source_mapping_id: sourceMappingId, version_number: 3, mapping_document: MAPPING_DOCUMENT },
    });
    mappingVersionV3 = v3.id;

    const v4 = await prisma.mappingVersion.create({
      data: { organisation_id: organisationId, source_mapping_id: sourceMappingId, version_number: 4, mapping_document: MAPPING_DOCUMENT },
    });
    mappingVersionV4 = v4.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Creates a fresh batch+worksheet (each Confirm scenario needs its own,
   * since Confirm mutates state — unlike Preview's read-only proof, which
   * could safely reuse one fixture across scenarios). */
  async function createMappedWorksheet(opts: {
    mappingVersionId: string | null;
    sourceSystemId?: string;
    rows: string[][];
  }) {
    const csv = buildCsv(MAPPED_HEADERS, opts.rows);
    const body = Buffer.from(csv, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");

    const batch = await prisma.importBatch.create({
      data: {
        organisation_id: organisationId,
        source_system_id: opts.sourceSystemId ?? sourceSystemS1,
        original_filename: "s1-export.csv",
        content_type: "csv",
        size_bytes: body.byteLength,
        sha256,
        storage_provider: "in-memory-proof-store",
        storage_key: `proof-key-${Date.now()}-${Math.random()}`,
        status: "READY",
      },
    });
    inMemoryBlobs.set(buildImportBatchKey(organisationId, batch.id), body);

    const worksheet = await prisma.upload.create({
      data: {
        organisation_id: organisationId,
        original_name: "s1-export.csv",
        stored_path: "n/a",
        mimetype: "text/csv",
        size_bytes: body.byteLength,
        lineage_kind: "DATA_HUB",
        import_batch_id: batch.id,
        worksheet_index: 0,
        canonical_status: "AWAITING_CONFIRMATION",
        mapping_version_id: opts.mappingVersionId,
      },
    });
    return { batchId: batch.id, worksheetId: worksheet.id };
  }

  it("A/G. persisted S1/v3 lineage + mapped source headers -> full Confirm imports expected domain rows, worksheet becomes IMPORTED, confirmed_by/at set", async () => {
    const { worksheetId } = await createMappedWorksheet({
      mappingVersionId: mappingVersionV3,
      rows: [
        ["2024-01-01", "Kerbside A", "Dumped Rubbish"],
        ["2024-01-02", "Kerbside B", "Tyres"],
      ],
    });

    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("../../lib/data-hub/importBatch/confirmWorksheet");
    const result = await confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 });

    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 2 });

    const worksheetAfter = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(worksheetAfter.canonical_status).toBe("IMPORTED");
    expect(worksheetAfter.confirmed_by).toBe(actor1);
    expect(worksheetAfter.confirmed_at).not.toBeNull();
    expect(worksheetAfter.mapping_version_id).toBe(mappingVersionV3);

    const rows = await prisma.illegalDumping.findMany({ where: { upload_id: worksheetId } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.location).sort()).toEqual(["Kerbside A", "Kerbside B"]);
    expect(rows.every((r) => r.organisation_id === organisationId)).toBe(true);
  });

  it("B. activating v4 on the SAME SourceMapping WITHOUT reselection, THEN Confirm -> Confirm still uses (and claims against) v3, not v4", async () => {
    const { worksheetId } = await createMappedWorksheet({
      mappingVersionId: mappingVersionV3,
      rows: [["2024-02-01", "Kerbside C", "Green Waste"]],
    });

    await prisma.sourceMapping.update({ where: { id: sourceMappingId }, data: { active_mapping_version_id: mappingVersionV4 } });

    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("../../lib/data-hub/importBatch/confirmWorksheet");
    const result = await confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 });

    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });
    const worksheetAfter = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(worksheetAfter.mapping_version_id).toBe(mappingVersionV3);
    expect(worksheetAfter.canonical_status).toBe("IMPORTED");

    // restore for subsequent scenarios
    await prisma.sourceMapping.update({ where: { id: sourceMappingId }, data: { active_mapping_version_id: null } });
  });

  it("C. deactivating SourceMapping and SourceSystem BEFORE Confirm -> frozen v3 still imports (frozen lineage survives deactivation)", async () => {
    const { worksheetId } = await createMappedWorksheet({
      mappingVersionId: mappingVersionV3,
      rows: [["2024-03-01", "Kerbside D", "Furniture"]],
    });

    await prisma.sourceMapping.update({ where: { id: sourceMappingId }, data: { active: false } });
    await prisma.sourceSystem.update({ where: { id: sourceSystemS1 }, data: { active: false } });

    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("../../lib/data-hub/importBatch/confirmWorksheet");
    const result = await confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 });

    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });
    const rows = await prisma.illegalDumping.findMany({ where: { upload_id: worksheetId } });
    expect(rows).toHaveLength(1);

    // restore for subsequent scenarios
    await prisma.sourceMapping.update({ where: { id: sourceMappingId }, data: { active: true } });
    await prisma.sourceSystem.update({ where: { id: sourceSystemS1 }, data: { active: true } });
  });

  it("D. corrupted cross-source lineage (SourceMapping repointed to a DIFFERENT SourceSystem than the batch) -> safe MAPPING_LINEAGE_UNAVAILABLE, zero domain rows, worksheet stays AWAITING_CONFIRMATION", async () => {
    const { worksheetId } = await createMappedWorksheet({
      mappingVersionId: mappingVersionV3,
      rows: [["2024-04-01", "Kerbside E", "Mattress"]],
    });

    await prisma.sourceMapping.update({ where: { id: sourceMappingId }, data: { source_system_id: sourceSystemS2 } });

    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("../../lib/data-hub/importBatch/confirmWorksheet");
    const result = await confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 });

    expect(result).toMatchObject({ ok: false, code: "MAPPING_LINEAGE_UNAVAILABLE" });
    const rows = await prisma.illegalDumping.findMany({ where: { upload_id: worksheetId } });
    expect(rows).toHaveLength(0);
    const worksheetAfter = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(worksheetAfter.canonical_status).toBe("AWAITING_CONFIRMATION");

    // restore for subsequent scenarios
    await prisma.sourceMapping.update({ where: { id: sourceMappingId }, data: { source_system_id: sourceSystemS1 } });
  });

  it("E. invalid stored MappingDocument -> safe MAPPING_DOCUMENT_INVALID, zero domain rows, worksheet stays AWAITING_CONFIRMATION", async () => {
    const badVersion = await prisma.mappingVersion.create({
      data: {
        organisation_id: organisationId,
        source_mapping_id: sourceMappingId,
        version_number: 99,
        mapping_document: { not_a_valid_shape: true },
      },
    });
    const { worksheetId } = await createMappedWorksheet({
      mappingVersionId: badVersion.id,
      rows: [["2024-05-01", "Kerbside F", "Whitegoods"]],
    });

    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("../../lib/data-hub/importBatch/confirmWorksheet");
    const result = await confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 });

    expect(result).toMatchObject({ ok: false, code: "MAPPING_DOCUMENT_INVALID" });
    const rows = await prisma.illegalDumping.findMany({ where: { upload_id: worksheetId } });
    expect(rows).toHaveLength(0);
    const worksheetAfter = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(worksheetAfter.canonical_status).toBe("AWAITING_CONFIRMATION");
  });

  it("H. replay after IMPORTED -> existing idempotency semantics (ok:true, alreadyImported:true), no duplicate domain rows, no re-write of confirmed_by/at", async () => {
    const { worksheetId } = await createMappedWorksheet({
      mappingVersionId: mappingVersionV3,
      rows: [["2024-06-01", "Kerbside G", "Tyres"]],
    });

    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("../../lib/data-hub/importBatch/confirmWorksheet");
    const first = await confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 });
    expect(first).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });

    const worksheetAfterFirst = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });

    const second = await confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor2 });
    expect(second).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: worksheetId });

    const rows = await prisma.illegalDumping.findMany({ where: { upload_id: worksheetId } });
    expect(rows).toHaveLength(1);

    const worksheetAfterSecond = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    // confirmed_by/at from the FIRST (winning) call are never overwritten by
    // the replay's own different confirmedBy actor.
    expect(worksheetAfterSecond.confirmed_by).toBe(worksheetAfterFirst.confirmed_by);
    expect(worksheetAfterSecond.confirmed_at).toEqual(worksheetAfterFirst.confirmed_at);
  });

  it("legacy (NULL mapping_version_id) Confirm continues to work unchanged alongside mapped worksheets in the same real database", async () => {
    const csv = "report_date,location,waste_type\n2024-07-01,Legacy Site,Legacy Type\n";
    const body = Buffer.from(csv, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const batch = await prisma.importBatch.create({
      data: {
        organisation_id: organisationId,
        original_filename: "legacy.csv",
        content_type: "csv",
        size_bytes: body.byteLength,
        sha256,
        storage_provider: "in-memory-proof-store",
        storage_key: `proof-key-legacy-${Date.now()}`,
        status: "READY",
      },
    });
    inMemoryBlobs.set(buildImportBatchKey(organisationId, batch.id), body);
    const worksheet = await prisma.upload.create({
      data: {
        organisation_id: organisationId,
        original_name: "legacy.csv",
        stored_path: "n/a",
        mimetype: "text/csv",
        size_bytes: body.byteLength,
        lineage_kind: "DATA_HUB",
        import_batch_id: batch.id,
        worksheet_index: 0,
        canonical_status: "AWAITING_CONFIRMATION",
        mapping_version_id: null,
      },
    });

    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("../../lib/data-hub/importBatch/confirmWorksheet");
    const result = await confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheet.id, confirmedBy: actor1 });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });
    const rows = await prisma.illegalDumping.findMany({ where: { upload_id: worksheet.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].location).toBe("Legacy Site");
  });
});
