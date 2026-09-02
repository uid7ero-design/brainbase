import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

// Data Hub 5A.2H.3-PRE — real disposable-Postgres integration harness for
// the legacy confirmImport() lineage guard.
//
// Run ONLY via scripts/tests/verify-confirm-import-lineage-guard.sh, which
// starts a disposable postgres:16-alpine Docker container, applies the
// exact scripts/create-import-batches.sql migration against a minimal
// bootstrap schema (organisations/users/uploads — identical to
// verify-inspect-worksheets.sh's own bootstrap), exports DATABASE_URL to
// point at that container, then runs `npx vitest run --config
// vitest.integration.config.ts scripts/tests/confirmImportLineageGuard.integration.test.ts`.
// NEVER run this file directly against any other DATABASE_URL — the guard
// rail below refuses to start if DATABASE_URL is unset or looks like a
// real hosted/Neon/production endpoint.
//
// This suite exercises the REAL, unmodified production
// services/upload.ts confirmImport() against a REAL Postgres instance —
// never a duplicated/parallel copy of its SQL/Prisma calls, and never a
// mocked Prisma client. It seeds a real DATA_HUB Upload row satisfying
// every current DB CHECK constraint (uploads_lineage_coherence_check:
// lineage_kind='DATA_HUB' requires import_batch_id/worksheet_index/
// canonical_status all NOT NULL, backed by a real ImportBatch row and the
// composite tenant-scoped FK), proving the row is genuinely
// schema-consistent rather than a hand-typed shape that merely looks
// right.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "confirmImportLineageGuard.integration.test.ts requires DATABASE_URL to point at a disposable Postgres " +
      "container (see scripts/tests/verify-confirm-import-lineage-guard.sh). Refusing to run without it."
  );
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error(
    "Refusing to run this integration suite against a DATABASE_URL that looks like a real hosted/Production " +
      "database. This suite may ONLY run against a local disposable Docker container."
  );
}
if (!/^(localhost|127\.0\.0\.1)/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, "http://")).hostname)) {
  throw new Error("Refusing to run this integration suite against a non-localhost DATABASE_URL host.");
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

let confirmImport: typeof import("@/services/upload").confirmImport;

beforeAll(async () => {
  ({ confirmImport } = await import("@/services/upload"));

  await prisma.$executeRawUnsafe(`
    INSERT INTO organisations (id, name, slug) VALUES
      ('org-a', 'Org A', 'org-a'),
      ('org-b', 'Org B', 'org-b')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedImportBatch(organisationId: string): Promise<string> {
  const id = randomUUID();
  await prisma.importBatch.create({
    data: {
      id,
      organisation_id: organisationId,
      original_filename: "fixture.csv",
      content_type: "csv",
      size_bytes: 16,
      sha256: "0".repeat(64),
      storage_provider: "vercel-blob-private",
      storage_key: `datahub/${organisationId}/${id}`,
      status: "READY",
    },
  });
  return id;
}

// Mirrors inspectWorksheets.ts's persistFirstTime field-for-field, so this
// fixture is genuinely representative of a real 5A.2H.1-persisted row, not
// a hand-invented shape.
async function seedDataHubUpload(organisationId: string, importBatchId: string) {
  const id = randomUUID();
  await prisma.upload.create({
    data: {
      id,
      organisation_id: organisationId,
      original_name: `fixture.csv :: worksheet[0] "Sheet1"`,
      stored_path: `datahub-worksheet:${importBatchId}:0`,
      mimetype: "text/csv",
      size_bytes: 0,
      import_batch_id: importBatchId,
      worksheet_index: 0,
      worksheet_name: "Sheet1",
      worksheet_visibility: "visible",
      worksheet_is_empty: false,
      lineage_kind: "DATA_HUB",
      canonical_status: "AWAITING_CONFIRMATION",
    },
  });
  return id;
}

async function seedLegacyUpload(organisationId: string, status: "PREVIEW_READY" | "COMPLETE" | "PENDING" = "PREVIEW_READY") {
  const id = randomUUID();
  await prisma.upload.create({
    data: {
      id,
      organisation_id: organisationId,
      original_name: "legacy-fixture.csv",
      stored_path: "/tmp/legacy-fixture.csv",
      mimetype: "text/csv",
      size_bytes: 16,
      status,
      schema_type: "UNKNOWN",
      field_mappings: {},
    },
  });
  return id;
}

async function fullRow(id: string) {
  return prisma.upload.findUniqueOrThrow({ where: { id } });
}

describe("confirmImport — legacy lineage guard (5A.2H.3-PRE)", () => {
  it("a DATA_HUB worksheet Upload id is rejected identically to a nonexistent id", async () => {
    const batchId = await seedImportBatch("org-a");
    const worksheetId = await seedDataHubUpload("org-a", batchId);

    await expect(
      confirmImport({ upload_id: worksheetId, organisation_id: "org-a" })
    ).rejects.toThrow("Upload not found");
  });

  it("a DATA_HUB row is completely unchanged after a rejected confirmImport attempt", async () => {
    const batchId = await seedImportBatch("org-a");
    const worksheetId = await seedDataHubUpload("org-a", batchId);
    const before = await fullRow(worksheetId);

    await expect(confirmImport({ upload_id: worksheetId, organisation_id: "org-a" })).rejects.toThrow();

    const after = await fullRow(worksheetId);
    expect(after).toEqual(before);
    expect(after.status).toBe("PENDING");
    expect(after.canonical_status).toBe("AWAITING_CONFIRMATION");
    expect(after.field_mappings).toEqual({});

    // ImportBatch itself must also be entirely untouched.
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("READY");
  });

  it("a wrong-tenant LEGACY upload id is rejected with the identical message", async () => {
    const legacyId = await seedLegacyUpload("org-b");

    let message: string | undefined;
    try {
      await confirmImport({ upload_id: legacyId, organisation_id: "org-a" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("Upload not found");
  });

  it("a nonexistent upload id is rejected with the identical message", async () => {
    let message: string | undefined;
    try {
      await confirmImport({ upload_id: randomUUID(), organisation_id: "org-a" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("Upload not found");
  });

  it("DATA_HUB, wrong-tenant, and nonexistent all produce byte-identical error messages", async () => {
    const batchId = await seedImportBatch("org-a");
    const dataHubId = await seedDataHubUpload("org-a", batchId);
    const legacyOtherTenantId = await seedLegacyUpload("org-b");
    const nonexistentId = randomUUID();

    const messages = await Promise.all(
      [dataHubId, legacyOtherTenantId, nonexistentId].map(async (id) => {
        try {
          await confirmImport({ upload_id: id, organisation_id: "org-a" });
          return "NO_THROW";
        } catch (err) {
          return (err as Error).message;
        }
      })
    );

    expect(messages).toEqual(["Upload not found", "Upload not found", "Upload not found"]);
  });

  it("a valid LEGACY upload still confirms normally", async () => {
    const legacyId = await seedLegacyUpload("org-a", "PREVIEW_READY");

    const result = await confirmImport({ upload_id: legacyId, organisation_id: "org-a" });

    expect(result).toEqual({ imported_rows: 0 });
    const after = await fullRow(legacyId);
    expect(after.status).toBe("COMPLETE");
  });

  it("existing legacy idempotency behavior is preserved (already-imported rejection)", async () => {
    const legacyId = await seedLegacyUpload("org-a", "PREVIEW_READY");
    await confirmImport({ upload_id: legacyId, organisation_id: "org-a" });

    await expect(
      confirmImport({ upload_id: legacyId, organisation_id: "org-a" })
    ).rejects.toThrow("Upload already imported");
  });
});

// Cheap, optional source-text tripwire (Section 15) — the behavioral tests
// above are the authoritative proof; this only guards against someone
// later removing the predicate without touching this file's assertions.
describe("confirmImport — static lineage-predicate presence (source-text tripwire)", () => {
  it("the upload lookup asserts lineage_kind: \"LEGACY\" directly in the same query as id/organisation_id", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "services", "upload.ts"), "utf8");
    const match = source.match(/const upload = await prisma\.upload\.findFirst\(\{ where: \{([^}]*)\} \}\);/);
    expect(match, "confirmImport's upload lookup query was not found in the expected shape").not.toBeNull();
    const predicate = match![1];
    expect(predicate).toMatch(/\bid:\s*upload_id\b/);
    expect(predicate).toMatch(/\borganisation_id\b/);
    expect(predicate).toMatch(/lineage_kind:\s*"LEGACY"/);
  });
});
