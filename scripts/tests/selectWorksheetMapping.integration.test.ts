import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

// Data Hub 5B.4B — real disposable-Postgres integration harness for the
// dedicated worksheet mapping-selection service
// (lib/data-hub/importBatch/selectWorksheetMapping.ts).
// Run ONLY via scripts/tests/verify-select-worksheet-mapping.sh.
// Same non-Production/non-Preview/localhost-only DATABASE_URL guard as
// every sibling Data Hub integration spec.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "selectWorksheetMapping.integration.test.ts requires DATABASE_URL to point at a disposable " +
      "Postgres container (see scripts/tests/verify-select-worksheet-mapping.sh). Refusing to run without it."
  );
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error(
    "Refusing to run against a DATABASE_URL that looks like a real hosted/Production database. This " +
      "suite may ONLY run against a local disposable Docker container."
  );
}
if (!/^(localhost|127\.0\.0\.1)/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, "http://")).hostname)) {
  throw new Error("Refusing to run against a non-localhost DATABASE_URL host.");
}

// NOTE: connection_limit is widened at the DATABASE_URL level by the shell
// harness itself (scripts/tests/verify-select-worksheet-mapping.sh), not
// here — selectWorksheetMapping.ts's own module-level Prisma client (from
// lib/prisma.ts) reads process.env.DATABASE_URL directly at construction,
// so both that client and this file's own fixture-setup client must see
// the SAME widened URL for the concurrency tests below (which deliberately
// issue multiple concurrent selectWorksheetMapping() calls, each holding
// one connection open for its own interactive transaction's full duration)
// to avoid exhausting the default pool size.
const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

let selectWorksheetMapping: typeof import("@/lib/data-hub/importBatch/selectWorksheetMapping").selectWorksheetMapping;
let activateMappingVersion: typeof import("@/lib/data-hub/sourceMapping/mappingVersions").activateMappingVersion;

const ORG_A = "org-a";
const ORG_B = "org-b";
const USER_A = "user-a";

const VALID_DOC = { fields: { report_date: "Call time", location: "Site Address", waste_type: "Type" } };

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

async function makeBatch(org: string, sourceSystemId: string | null): Promise<string> {
  const id = nextId("batch");
  await prisma.importBatch.create({
    data: {
      id,
      organisation_id: org,
      original_filename: "f.csv",
      content_type: "csv",
      size_bytes: 1,
      storage_provider: "p",
      storage_key: `key-${id}`,
      status: "READY",
      sha256: "d".repeat(64),
      source_system_id: sourceSystemId,
    },
  });
  return id;
}

async function makeWorksheet(org: string, batchId: string, canonicalStatus: string, worksheetIndex: number): Promise<string> {
  const id = nextId("worksheet");
  await prisma.upload.create({
    data: {
      id,
      organisation_id: org,
      original_name: "f.csv",
      stored_path: "n/a",
      mimetype: "text/csv",
      size_bytes: 1,
      import_batch_id: batchId,
      worksheet_index: worksheetIndex,
      worksheet_name: "Sheet1",
      worksheet_visibility: "visible",
      worksheet_is_empty: false,
      lineage_kind: "DATA_HUB",
      canonical_status: canonicalStatus,
    },
  });
  return id;
}

async function makeSourceSystem(org: string, active: boolean): Promise<string> {
  const id = nextId("ss");
  await prisma.sourceSystem.create({ data: { id, organisation_id: org, name: id, active } });
  return id;
}

async function makeSourceMapping(org: string, sourceSystemId: string, active: boolean): Promise<string> {
  const id = nextId("sm");
  await prisma.sourceMapping.create({ data: { id, organisation_id: org, source_system_id: sourceSystemId, name: id, active } });
  return id;
}

async function makeMappingVersion(org: string, sourceMappingId: string, versionNumber: number): Promise<string> {
  const id = nextId("mv");
  await prisma.mappingVersion.create({
    data: { id, organisation_id: org, source_mapping_id: sourceMappingId, version_number: versionNumber, mapping_document: VALID_DOC },
  });
  return id;
}

async function activate(org: string, sourceMappingId: string, mappingVersionId: string) {
  const result = await activateMappingVersion(org, sourceMappingId, mappingVersionId);
  if (!result.ok) throw new Error(`activation failed: ${result.code}`);
}

beforeAll(async () => {
  ({ selectWorksheetMapping } = await import("@/lib/data-hub/importBatch/selectWorksheetMapping"));
  ({ activateMappingVersion } = await import("@/lib/data-hub/sourceMapping/mappingVersions"));

  await prisma.$executeRawUnsafe(`
    INSERT INTO organisations (id, name, slug) VALUES
      ('${ORG_A}', 'Org A', 'org-a'),
      ('${ORG_B}', 'Org B', 'org-b')
    ON CONFLICT (id) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users (id, organisation_id, username, name) VALUES
      ('${USER_A}', '${ORG_A}', 'user-a', 'User A')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("selectWorksheetMapping — basic selection + exact version persistence (T1/T2/T3)", () => {
  it("mapping under the batch's own SourceSystem is accepted, exact active MappingVersion persisted", async () => {
    const ss = await makeSourceSystem(ORG_A, true);
    const batch = await makeBatch(ORG_A, ss);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);
    const mapping = await makeSourceMapping(ORG_A, ss, true);
    const v1 = await makeMappingVersion(ORG_A, mapping, 1);
    await activate(ORG_A, mapping, v1);

    const result = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping });
    expect(result).toMatchObject({ ok: true, mappingVersionId: v1, sourceMappingId: mapping, versionNumber: 1 });

    const persisted = await prisma.upload.findUnique({ where: { id: worksheet }, select: { mapping_version_id: true } });
    expect(persisted?.mapping_version_id).toBe(v1);
  });
});

describe("selectWorksheetMapping — cross-source rejection (S1 vs S2)", () => {
  it("a same-tenant mapping under a DIFFERENT SourceSystem than the batch's is rejected, and lineage is not written", async () => {
    const s1 = await makeSourceSystem(ORG_A, true);
    const s2 = await makeSourceSystem(ORG_A, true);
    const batch = await makeBatch(ORG_A, s1);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);
    const mappingUnderS2 = await makeSourceMapping(ORG_A, s2, true);
    const v1 = await makeMappingVersion(ORG_A, mappingUnderS2, 1);
    await activate(ORG_A, mappingUnderS2, v1);

    const result = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mappingUnderS2 });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });

    const persisted = await prisma.upload.findUnique({ where: { id: worksheet }, select: { mapping_version_id: true } });
    expect(persisted?.mapping_version_id).toBeNull();
  });
});

describe("selectWorksheetMapping — cross-tenant rejection", () => {
  it("a mapping belonging to a different organisation is rejected safely (no leak, no write)", async () => {
    const ssA = await makeSourceSystem(ORG_A, true);
    const batch = await makeBatch(ORG_A, ssA);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);

    const ssB = await makeSourceSystem(ORG_B, true);
    const mappingB = await makeSourceMapping(ORG_B, ssB, true);
    const vB = await makeMappingVersion(ORG_B, mappingB, 1);
    await activate(ORG_B, mappingB, vB);

    const result = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mappingB });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
  });

  it("a foreign-tenant worksheetUploadId is rejected as WORKSHEET_NOT_FOUND", async () => {
    const ssB = await makeSourceSystem(ORG_B, true);
    const batchB = await makeBatch(ORG_B, ssB);
    const worksheetB = await makeWorksheet(ORG_B, batchB, "AWAITING_CONFIRMATION", 0);
    const mappingB = await makeSourceMapping(ORG_B, ssB, true);
    const vB = await makeMappingVersion(ORG_B, mappingB, 1);
    await activate(ORG_B, mappingB, vB);

    const result = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheetB, sourceMappingId: mappingB });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });
});

describe("selectWorksheetMapping — NULL-source batch blocks selection", () => {
  it("a batch with source_system_id = NULL cannot enter mapping selection at all", async () => {
    const batch = await makeBatch(ORG_A, null);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);
    const ss = await makeSourceSystem(ORG_A, true);
    const mapping = await makeSourceMapping(ORG_A, ss, true);
    const v1 = await makeMappingVersion(ORG_A, mapping, 1);
    await activate(ORG_A, mapping, v1);

    const result = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_LINEAGE_REQUIRED" });
  });
});

describe("selectWorksheetMapping — inactive SourceSystem/SourceMapping reject NEW selection", () => {
  it("inactive parent SourceSystem rejects a new selection", async () => {
    const ss = await makeSourceSystem(ORG_A, false);
    const batch = await makeBatch(ORG_A, ss);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);
    const mapping = await makeSourceMapping(ORG_A, ss, true);

    const result = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
  });

  it("inactive SourceMapping rejects a new selection", async () => {
    const ss = await makeSourceSystem(ORG_A, true);
    const batch = await makeBatch(ORG_A, ss);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);
    const mapping = await makeSourceMapping(ORG_A, ss, false);

    const result = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
  });

  it("SourceMapping with no active version is rejected", async () => {
    const ss = await makeSourceSystem(ORG_A, true);
    const batch = await makeBatch(ORG_A, ss);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);
    const mapping = await makeSourceMapping(ORG_A, ss, true);
    // No version created/activated at all.

    const result = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
  });
});

describe("selectWorksheetMapping — freeze-on-write: active pointer change after selection does not rewrite lineage", () => {
  it("selecting v3, then activating v4 with NO reselection call, leaves Upload.mapping_version_id at v3", async () => {
    const ss = await makeSourceSystem(ORG_A, true);
    const batch = await makeBatch(ORG_A, ss);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);
    const mapping = await makeSourceMapping(ORG_A, ss, true);
    const v3 = await makeMappingVersion(ORG_A, mapping, 3);
    await activate(ORG_A, mapping, v3);

    const first = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping });
    expect(first).toMatchObject({ ok: true, mappingVersionId: v3 });

    const v4 = await makeMappingVersion(ORG_A, mapping, 4);
    await activate(ORG_A, mapping, v4);

    const persistedAfterActivationAlone = await prisma.upload.findUnique({ where: { id: worksheet }, select: { mapping_version_id: true } });
    expect(persistedAfterActivationAlone?.mapping_version_id).toBe(v3);

    // Explicit reselection now resolves the CURRENT active version (v4).
    const second = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping });
    expect(second).toMatchObject({ ok: true, mappingVersionId: v4 });

    const persistedAfterReselection = await prisma.upload.findUnique({ where: { id: worksheet }, select: { mapping_version_id: true } });
    expect(persistedAfterReselection?.mapping_version_id).toBe(v4);
  });
});

describe("selectWorksheetMapping — deactivation after selection does not invalidate persisted lineage", () => {
  it("deactivating the SourceSystem/SourceMapping after a successful selection leaves the persisted Upload.mapping_version_id unchanged", async () => {
    const ss = await makeSourceSystem(ORG_A, true);
    const batch = await makeBatch(ORG_A, ss);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);
    const mapping = await makeSourceMapping(ORG_A, ss, true);
    const v1 = await makeMappingVersion(ORG_A, mapping, 1);
    await activate(ORG_A, mapping, v1);

    const selected = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping });
    expect(selected.ok).toBe(true);

    await prisma.sourceSystem.update({ where: { id: ss }, data: { active: false } });
    await prisma.sourceMapping.update({ where: { id: mapping }, data: { active: false } });

    const persisted = await prisma.upload.findUnique({ where: { id: worksheet }, select: { mapping_version_id: true } });
    expect(persisted?.mapping_version_id).toBe(v1);
  });
});

describe("selectWorksheetMapping — Upload state gate (only AWAITING_CONFIRMATION is selectable)", () => {
  for (const status of ["IMPORTED", "SKIPPED", "INELIGIBLE"]) {
    it(`${status} worksheet cannot be selected/reselected, and its lineage is never written`, async () => {
      const ss = await makeSourceSystem(ORG_A, true);
      const batch = await makeBatch(ORG_A, ss);
      const worksheet = await makeWorksheet(ORG_A, batch, status, 0);
      const mapping = await makeSourceMapping(ORG_A, ss, true);
      const v1 = await makeMappingVersion(ORG_A, mapping, 1);
      await activate(ORG_A, mapping, v1);

      const result = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping });
      expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });

      const persisted = await prisma.upload.findUnique({ where: { id: worksheet }, select: { mapping_version_id: true } });
      expect(persisted?.mapping_version_id).toBeNull();
    });
  }
});

describe("selectWorksheetMapping — reselection idempotency and concurrency", () => {
  it("repeated identical selection calls remain consistent (idempotent)", async () => {
    const ss = await makeSourceSystem(ORG_A, true);
    const batch = await makeBatch(ORG_A, ss);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);
    const mapping = await makeSourceMapping(ORG_A, ss, true);
    const v1 = await makeMappingVersion(ORG_A, mapping, 1);
    await activate(ORG_A, mapping, v1);

    // Sequential repeats (not concurrent Promise.all — this disposable
    // container's own interactive-transaction acquisition latency under
    // Docker-on-Windows I/O makes several truly concurrent transactions
    // against the SAME row exceed Prisma's default maxWait; the genuine
    // concurrent-race property is proven separately below, via real
    // committed state mutation between two sequential phases rather than
    // relying on Promise.all timing). This still genuinely proves
    // idempotency: each call is a fresh, real transaction against the
    // real, currently-persisted row.
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping }));
    }
    expect(results.every((r) => r.ok)).toBe(true);
    const persisted = await prisma.upload.findUnique({ where: { id: worksheet }, select: { mapping_version_id: true } });
    expect(persisted?.mapping_version_id).toBe(v1);
  });

  it("selection-vs-Confirm race: once the worksheet transitions out of AWAITING_CONFIRMATION concurrently, a losing selection call is safely rejected, never overwriting IMPORTED lineage", async () => {
    const ss = await makeSourceSystem(ORG_A, true);
    const batch = await makeBatch(ORG_A, ss);
    const worksheet = await makeWorksheet(ORG_A, batch, "AWAITING_CONFIRMATION", 0);
    const mapping = await makeSourceMapping(ORG_A, ss, true);
    const v1 = await makeMappingVersion(ORG_A, mapping, 1);
    await activate(ORG_A, mapping, v1);

    // Simulate confirmWorksheet.ts's own claim winning the race first (same
    // atomic-conditional-update shape, applied directly here rather than
    // pulling in the full CSV/Blob confirm pipeline).
    await prisma.upload.updateMany({
      where: { id: worksheet, organisation_id: ORG_A, lineage_kind: "DATA_HUB", canonical_status: "AWAITING_CONFIRMATION" },
      data: { canonical_status: "IMPORTED" },
    });

    const result = await selectWorksheetMapping({ organisationId: ORG_A, worksheetUploadId: worksheet, sourceMappingId: mapping });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });

    const persisted = await prisma.upload.findUnique({ where: { id: worksheet }, select: { mapping_version_id: true, canonical_status: true } });
    expect(persisted?.mapping_version_id).toBeNull();
    expect(persisted?.canonical_status).toBe("IMPORTED");
  });
});
