// Data Hub 6.2D3D — real disposable-Postgres proof for
// establishImportBatchSchemaLineage.ts (governed schema eligibility and
// lineage pinning).
//
// NOT part of the default vitest containment suite (tests/containment/**)
// — invoked explicitly via `npx vitest run --config
// tests/postgres-proof/vitest.proof.config.ts
// tests/postgres-proof/establishImportBatchSchemaLineage.postgres-proof.test.ts`
// against a throwaway `postgres:16-alpine` Docker container, never
// Production/Preview. Only the Blob storage composition root is mocked (an
// in-memory byte store keyed by import-batch key), exactly matching
// selectWorksheetPeriod.postgres-proof.test.ts's own established pattern.
//
// SCOPE — this file deliberately does NOT re-derive the full mocked
// containment matrix (dataHubSchemaSelectionService.test.ts already proves
// every validation branch — DRAFT/RETIRED, match outcomes, integrity,
// defensive states — exhaustively and far faster as pure unit tests). This
// file proves ONLY the claims a mock cannot: real Postgres row-locking
// concurrency safety, and the real composite-FK/CHECK-constraint
// enforcement backing the atomic conditional write.
//
// GOVERNED SCHEMA IS A SINGLETON BY DESIGN (see governedSchema.ts):
// GOVERNED_DATASET_TYPE_ID and GOVERNED_SOURCE_SCHEMA_VERSION_ID are
// fixed, globally-unique-by-PK literal ids — there can only ever be ONE
// qualifying (DatasetType, SourceSchemaVersion) pair in the whole database
// at a time. This proof therefore seeds exactly one organisation with one
// ACTIVE governed schema fixture (a synthetic single-sheet/single-column
// schema — never the real Onkaparinga DRAFT config, never mutated) and
// scopes every scenario to batches under that one fixture.
//
// Scope — the 5 scenarios (P1-P5):
//   P1. two REAL concurrent identical schema-selection calls against the
//       SAME batch (two independent PrismaClient connections, Promise.all)
//       converge to exactly one durable lineage pair — one caller
//       alreadySelected:false, the other alreadySelected:true, never a
//       partial/null pair, never two different pairs
//   P2. idempotent replay after a real successful pin performs zero
//       additional writes (updated_at unchanged)
//   P3. tenant isolation against the real DB — a wrong-organisation batch
//       id resolves BATCH_NOT_FOUND, never leaks existence
//   P4. the real composite FK backing the atomic write structurally
//       rejects a cross-tenant lineage pin at the DB level (a raw SQL
//       UPDATE attempting to point one organisation's batch at another
//       organisation's DatasetType/SourceSchemaVersion is rejected by
//       Postgres itself, never merely by application code)
//   P5. the real pair/implication CHECK constraints reject a partial
//       lineage pair (schema version set without dataset type) at the raw
//       DB level, backing this service's own "defensive state" contract
//   P6. [R2 remediation] a batch pinned while the schema was ACTIVE keeps
//       returning idempotent success against REAL Postgres after the
//       schema is retired, with zero additional writes — proves the R2
//       historical-idempotency fix under a real DB, not just a mock

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { buildImportBatchKey } from "../../lib/data-hub/storage/rawFileStore";
import { GOVERNED_DATASET_TYPE_ID, GOVERNED_DATASET_TYPE_NAME, GOVERNED_SOURCE_SCHEMA_VERSION_ID, GOVERNED_SOURCE_SCHEMA_VERSION_NUMBER } from "../../lib/data-hub/schemaMatch/governedSchema";

if (!process.env.DATABASE_URL?.includes("55555")) {
  throw new Error(
    "Refusing to run: DATABASE_URL does not point at the disposable 6.2D3D proof container (port 55555). " +
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

// Same AsyncLocalStorage-routed prisma singleton mock as
// selectWorksheetPeriod.postgres-proof.test.ts — see that file's own
// header comment for the full rationale.
const activeClientStorage = new AsyncLocalStorage<PrismaClient>();
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        const client = activeClientStorage.getStore();
        if (!client) {
          throw new Error("establishImportBatchSchemaLineage proof: no active PrismaClient bound for this call");
        }
        return Reflect.get(client, prop, client);
      },
    }
  ),
}));

function runWithClient<T>(client: PrismaClient, fn: () => Promise<T>): Promise<T> {
  return activeClientStorage.run(client, fn);
}

// Fixture setup/assertions use their own separate, ordinary PrismaClient.
const prisma = new PrismaClient();

const SHEET_NAME = "Sheet1";
const HEADER = "id";

function workbookBytes(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[HEADER]]), SHEET_NAME);
  wb.Workbook = { Sheets: [{ Hidden: 0 }] };
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function freshService() {
  vi.resetModules();
  return import("../../lib/data-hub/schemaMatch/establishImportBatchSchemaLineage");
}

describe("6.2D3D governed schema lineage pinning — real disposable Postgres proof", () => {
  let organisationId: string;
  let otherOrganisationId: string;
  let sourceSystemId: string;
  let actorUserId: string;
  const bytes = workbookBytes();
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  beforeAll(async () => {
    const org = await prisma.organisation.create({ data: { name: "6.2D3D Proof Org", slug: `proof-org-6-2d3d-${Date.now()}` } });
    organisationId = org.id;
    const otherOrg = await prisma.organisation.create({ data: { name: "6.2D3D Proof Org (other tenant)", slug: `proof-org-6-2d3d-other-${Date.now()}` } });
    otherOrganisationId = otherOrg.id;

    const u = await prisma.user.create({ data: { organisation_id: organisationId, username: `actor-${Date.now()}`, name: "Proof Actor" } });
    actorUserId = u.id;

    const ss = await prisma.sourceSystem.create({ data: { organisation_id: organisationId, name: "6.2D3D Proof SourceSystem", active: true } });
    sourceSystemId = ss.id;

    // Synthetic ACTIVE governed schema fixture, pinned to the fixed
    // singleton ids the real loader (governedSchema.ts) requires — never
    // the real Onkaparinga DRAFT config, never mutated by this file.
    await prisma.datasetType.create({
      data: { id: GOVERNED_DATASET_TYPE_ID, organisation_id: organisationId, source_system_id: sourceSystemId, name: GOVERNED_DATASET_TYPE_NAME, active: true },
    });
    await prisma.sourceSchemaVersion.create({
      data: {
        id: GOVERNED_SOURCE_SCHEMA_VERSION_ID,
        organisation_id: organisationId,
        dataset_type_id: GOVERNED_DATASET_TYPE_ID,
        version_number: GOVERNED_SOURCE_SCHEMA_VERSION_NUMBER,
        label: "6.2D3D proof v1",
        status: "ACTIVE",
        activated_at: new Date(),
      },
    });
    const worksheet = await prisma.sourceSchemaWorksheet.create({
      data: {
        organisation_id: organisationId,
        source_schema_version_id: GOVERNED_SOURCE_SCHEMA_VERSION_ID,
        logical_key: "sheet1",
        expected_name: SHEET_NAME,
        ordinal_hint: 0,
        presence: "REQUIRED",
        role: "DATA",
      },
    });
    await prisma.sourceSchemaColumn.create({
      data: {
        organisation_id: organisationId,
        source_schema_worksheet_id: worksheet.id,
        ordinal: 0,
        source_header: HEADER,
        presence: "REQUIRED",
        declared_type: "STRING",
        sensitivity_class: "PUBLIC",
      },
    });
    const profile = await prisma.worksheetMappingProfile.create({
      data: { organisation_id: organisationId, source_schema_worksheet_id: worksheet.id, name: "6.2D3D proof profile", active: true },
    });
    await prisma.worksheetMappingProfileVersion.create({
      data: {
        organisation_id: organisationId,
        worksheet_mapping_profile_id: profile.id,
        version_number: 1,
        disposition: "STAGING_DATASET",
        profile_document: { documentVersion: 1, schemaStatus: "ACTIVE", headerRowOneBased: 1 },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Creates a fresh, eligible READY XLSX ImportBatch + its DATA_HUB
   * worksheet descriptor row, structurally matching the governed schema
   * exactly (an EXACT_MATCH structural comparison). */
  async function createBatch(label: string, org = organisationId, ss = sourceSystemId) {
    const batch = await prisma.importBatch.create({
      data: {
        organisation_id: org,
        source_system_id: ss,
        original_filename: `${label}.xlsx`,
        content_type: "xlsx",
        size_bytes: bytes.byteLength,
        sha256,
        storage_provider: "in-memory-proof-store",
        storage_key: `proof-key-${label}-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
        status: "READY",
      },
    });
    // The service derives the storage key from organisationId +
    // importBatchId — key the in-memory blob under the batch's real id.
    inMemoryBlobs.set(buildImportBatchKey(org, batch.id), bytes);

    await prisma.upload.create({
      data: {
        organisation_id: org,
        original_name: `${label}.xlsx`,
        stored_path: "n/a",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size_bytes: bytes.byteLength,
        lineage_kind: "DATA_HUB",
        import_batch_id: batch.id,
        worksheet_index: 0,
        worksheet_name: SHEET_NAME,
        worksheet_visibility: "visible",
        worksheet_is_empty: false,
        canonical_status: "AWAITING_CONFIRMATION",
        mapping_version_id: null,
      },
    });
    return batch.id;
  }

  it("P1. two REAL concurrent identical schema-selection calls converge to exactly one durable lineage pair", async () => {
    const batchId = await createBatch("p1");

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage: serviceA } = await freshService();
      const { establishImportBatchSchemaLineage: serviceB } = await freshService();
      const [resultA, resultB] = await Promise.all([
        runWithClient(clientA, () => serviceA({ organisationId, importBatchId: batchId, actorUserId })),
        runWithClient(clientB, () => serviceB({ organisationId, importBatchId: batchId, actorUserId })),
      ]);

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (!resultA.ok || !resultB.ok) return;

      expect(resultA.datasetTypeId).toBe(GOVERNED_DATASET_TYPE_ID);
      expect(resultA.sourceSchemaVersionId).toBe(GOVERNED_SOURCE_SCHEMA_VERSION_ID);
      expect(resultB.datasetTypeId).toBe(GOVERNED_DATASET_TYPE_ID);
      expect(resultB.sourceSchemaVersionId).toBe(GOVERNED_SOURCE_SCHEMA_VERSION_ID);

      // Real Postgres row-locking guarantees exactly one caller performed
      // the actual write and the other converged via the reread branch —
      // never both false (double-write) and never both true (neither
      // wrote, meaning nothing was ever actually pinned).
      const alreadySelectedFlags = [resultA.alreadySelected, resultB.alreadySelected].sort();
      expect(alreadySelectedFlags).toEqual([false, true]);
    } finally {
      await clientA.$disconnect();
      await clientB.$disconnect();
    }

    const row = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(row.dataset_type_id).toBe(GOVERNED_DATASET_TYPE_ID);
    expect(row.source_schema_version_id).toBe(GOVERNED_SOURCE_SCHEMA_VERSION_ID);
  });

  it("P2. idempotent replay after a real successful pin performs zero additional writes (updated_at unchanged)", async () => {
    const batchId = await createBatch("p2");
    const client = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage } = await freshService();
      const first = await runWithClient(client, () => establishImportBatchSchemaLineage({ organisationId, importBatchId: batchId, actorUserId }));
      expect(first).toMatchObject({ ok: true, alreadySelected: false });
    } finally {
      await client.$disconnect();
    }

    const afterFirst = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });

    // A real wall-clock gap so a spurious updated_at bump (a real bug)
    // would be observable, not masked by same-millisecond timestamps.
    await new Promise((r) => setTimeout(r, 50));

    const replayClient = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage } = await freshService();
      const second = await runWithClient(replayClient, () => establishImportBatchSchemaLineage({ organisationId, importBatchId: batchId, actorUserId }));
      expect(second).toMatchObject({ ok: true, alreadySelected: true, datasetTypeId: GOVERNED_DATASET_TYPE_ID, sourceSchemaVersionId: GOVERNED_SOURCE_SCHEMA_VERSION_ID });
    } finally {
      await replayClient.$disconnect();
    }

    const afterSecond = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(afterSecond.updated_at.getTime()).toBe(afterFirst.updated_at.getTime());
  });

  it("P3. tenant isolation against the real DB — a wrong-organisation batch id resolves BATCH_NOT_FOUND", async () => {
    const batchId = await createBatch("p3");
    const client = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage } = await freshService();
      const result = await runWithClient(client, () =>
        establishImportBatchSchemaLineage({ organisationId: otherOrganisationId, importBatchId: batchId, actorUserId })
      );
      expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
    } finally {
      await client.$disconnect();
    }

    const row = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(row.dataset_type_id).toBeNull();
    expect(row.source_schema_version_id).toBeNull();
  });

  it("P4. the real composite FK rejects a cross-tenant lineage pin at the DB level, never merely by application code", async () => {
    const foreignBatch = await prisma.importBatch.create({
      data: {
        organisation_id: otherOrganisationId,
        original_filename: "foreign.xlsx",
        content_type: "xlsx",
        size_bytes: 1,
        sha256: "0".repeat(64),
        storage_provider: "in-memory-proof-store",
        storage_key: `proof-key-foreign-${Date.now()}`,
        status: "READY",
      },
    });

    // This organisation (otherOrganisationId) owns no DatasetType/
    // SourceSchemaVersion row at all — the composite FK (id,
    // source_system_id/dataset_type_id, organisation_id) must reject
    // pointing its batch at the OTHER organisation's governed schema,
    // regardless of application-level checks.
    await expect(
      prisma.$executeRaw`UPDATE import_batches SET dataset_type_id = ${GOVERNED_DATASET_TYPE_ID}, source_schema_version_id = ${GOVERNED_SOURCE_SCHEMA_VERSION_ID} WHERE id = ${foreignBatch.id}`
    ).rejects.toThrow();

    const row = await prisma.importBatch.findUniqueOrThrow({ where: { id: foreignBatch.id } });
    expect(row.dataset_type_id).toBeNull();
    expect(row.source_schema_version_id).toBeNull();
  });

  it("P5. the real pair/implication CHECK constraints reject a partial lineage pair at the raw DB level", async () => {
    const batchId = await createBatch("p5");

    // schema_version set without dataset_type — the exact anomalous state
    // this service's own defensive INVALID_STATE branch assumes the DB
    // makes unreachable through ordinary application writes.
    await expect(
      prisma.$executeRaw`UPDATE import_batches SET source_schema_version_id = ${GOVERNED_SOURCE_SCHEMA_VERSION_ID} WHERE id = ${batchId}`
    ).rejects.toThrow();

    const row = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(row.dataset_type_id).toBeNull();
    expect(row.source_schema_version_id).toBeNull();
  });

  it("P6 [R2] — a batch pinned while the schema was ACTIVE keeps returning idempotent success against real Postgres after the schema is retired, with zero additional writes", async () => {
    const batchId = await createBatch("p6");

    const pinClient = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage } = await freshService();
      const pinned = await runWithClient(pinClient, () => establishImportBatchSchemaLineage({ organisationId, importBatchId: batchId, actorUserId }));
      expect(pinned).toMatchObject({ ok: true, alreadySelected: false });
    } finally {
      await pinClient.$disconnect();
    }

    const afterPin = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });

    // Retire the real, singleton governed schema row directly (never via
    // this service — schema retirement has no runtime/admin writer
    // anywhere in the repo; this raw UPDATE simulates a future governance
    // action strictly for this proof).
    await prisma.sourceSchemaVersion.update({ where: { id: GOVERNED_SOURCE_SCHEMA_VERSION_ID }, data: { status: "RETIRED" } });

    await new Promise((r) => setTimeout(r, 50));

    const replayClient = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage } = await freshService();
      const replayed = await runWithClient(replayClient, () => establishImportBatchSchemaLineage({ organisationId, importBatchId: batchId, actorUserId }));
      expect(replayed).toMatchObject({ ok: true, alreadySelected: true, datasetTypeId: GOVERNED_DATASET_TYPE_ID, sourceSchemaVersionId: GOVERNED_SOURCE_SCHEMA_VERSION_ID });
    } finally {
      await replayClient.$disconnect();
    }

    const afterReplay = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(afterReplay.updated_at.getTime()).toBe(afterPin.updated_at.getTime());

    // Restore ACTIVE so this fixture stays coherent for any later test in
    // this file that might run after this one (defensive; this is
    // currently the last scenario in the file).
    await prisma.sourceSchemaVersion.update({ where: { id: GOVERNED_SOURCE_SCHEMA_VERSION_ID }, data: { status: "ACTIVE" } });
  });
});
