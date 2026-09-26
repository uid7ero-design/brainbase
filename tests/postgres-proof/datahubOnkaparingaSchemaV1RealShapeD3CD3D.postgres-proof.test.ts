// Data Hub 6.2D3E — real disposable-Postgres proof that D3C
// (matchImportBatchSchema.ts) and D3D (establishImportBatchSchemaLineage.ts)
// both behave correctly against the REAL, now-ACTIVATED 14-sheet/295-
// column Onkaparinga v1 governed schema — never Production/Preview.
//
// This closes the gap D3D's own original proof left open: that proof
// used a synthetic 1-sheet/1-column ACTIVE fixture. This file seeds the
// REAL D3B manifest, activates it for real via the REAL 6.2D3E
// activation script (shelled out to psql, same mechanism as
// datahubOnkaparingaSchemaV1Activation.postgres-proof.test.ts), and only
// THEN drives the real matchImportBatchSchema/
// establishImportBatchSchemaLineage TS service functions against it —
// exactly the code path a real caller would exercise.
//
// Requires the disposable container to already have D3A + 6.2D3E
// (immutability) applied. Requires DATAHUB_D3E_PROOF_CONTAINER (the
// container name) in addition to the port-scoped DATABASE_URL check.
//
// Covers:
//   Section 23 — D3C: a structurally exact real 14-sheet test workbook
//     resolves EXACT_MATCH, sourceSchemaStatus=ACTIVE, zero writes.
//   Section 24 — D3D: the same real workbook, on a READY/tenant-correct/
//     hash-valid XLSX batch, pins dataset_type_id + source_schema_version_id.
//     Also: wrong tenant -> BATCH_NOT_FOUND; drift -> cannot pin; RETIRED
//     blocks NEW pinning; historical pinned lineage remains idempotent
//     after retirement.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { buildImportBatchKey } from "../../lib/data-hub/storage/rawFileStore";

if (!process.env.DATABASE_URL?.includes("55560")) {
  throw new Error(
    "Refusing to run: DATABASE_URL does not point at the disposable 6.2D3E real-shape proof container (port 55560). " +
      "This proof must never run against Production/Preview."
  );
}
const CONTAINER = process.env.DATAHUB_D3E_PROOF_CONTAINER;
if (!CONTAINER) {
  throw new Error("DATAHUB_D3E_PROOF_CONTAINER must name the disposable postgres:16-alpine container to exec into (never Production/Preview).");
}

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const MANIFEST = JSON.parse(read("config/data-hub/onkaparinga-monthly-operations-v1.json"));
type ManifestSheet = { ordinal: number; logicalKey: string; name: string; headerRowOneBased: number | null; columns: { header: string; sensitivityClass: string }[] };
const SHEETS: ManifestSheet[] = MANIFEST.worksheets;
const SEED_SQL = read("scripts/seed-datahub-onkaparinga-schema-v1.sql");
const ACTIVATE_SQL = read("scripts/activate-datahub-onkaparinga-schema-v1.sql");

const SV_ID = "dhcfg-onk-mwco-sv1";
const DT_ID = "dhcfg-onk-mwco-dt";
const SS_NAME = "City of Onkaparinga operational export";

class PsqlError extends Error {}
function psql(sql: string, extraArgs: string[] = []): string {
  const result = spawnSync("docker", ["exec", "-i", CONTAINER as string, "psql", "-X", "-q", "-U", "postgres", "-d", "testdb", "-v", "ON_ERROR_STOP=1", ...extraArgs], {
    input: sql,
    encoding: "utf8",
  });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status !== 0) throw new PsqlError(combined || `docker exec psql exited with status ${result.status}`);
  return combined;
}

// ── Synthetic-but-real-shaped workbook builder — mirrors
// dataHubSchemaMatchService.test.ts's own juneLikeSheets/workbookBytes
// exactly, since both need the SAME real manifest structure. ──
type SheetSpec = { name: string; aoa: unknown[][] };
function juneLikeSheets(edit: (name: string, headers: string[]) => string[] = (_n, h) => h): SheetSpec[] {
  return SHEETS.map((s) => ({
    name: s.name,
    aoa:
      s.columns.length === 0
        ? [["Trend chart placeholder"]]
        : [[`Title ${s.name}`], ["Reporting period text"], edit(s.name, s.columns.map((c) => c.header)), s.columns.map((_, i) => `V-${i}`)],
  }));
}
function workbookBytes(sheets: SheetSpec[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name);
  wb.Workbook = { Sheets: sheets.map(() => ({ Hidden: 0 })) };
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
function descriptorsFor(sheets: SheetSpec[]) {
  return sheets.map((s, i) => ({ worksheet_index: i, worksheet_name: s.name, worksheet_visibility: "visible" as const, worksheet_is_empty: false }));
}

const inMemoryBlobs = new Map<string, Buffer>();
vi.mock("@/lib/data-hub/importBatch/compositionRoot", () => ({
  createImportBatchStorage: () => ({
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

const activeClientStorage = new AsyncLocalStorage<PrismaClient>();
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        const client = activeClientStorage.getStore();
        if (!client) throw new Error("real-shape proof: no active PrismaClient bound for this call");
        return Reflect.get(client, prop, client);
      },
    }
  ),
}));
function runWithClient<T>(client: PrismaClient, fn: () => Promise<T>): Promise<T> {
  return activeClientStorage.run(client, fn);
}
async function freshMatch() {
  vi.resetModules();
  return import("../../lib/data-hub/schemaMatch/matchImportBatchSchema");
}
async function freshEstablish() {
  vi.resetModules();
  return import("../../lib/data-hub/schemaMatch/establishImportBatchSchemaLineage");
}

const prisma = new PrismaClient();

describe("6.2D3E D3C/D3D real-shape proof — real, activated 14-sheet Onkaparinga v1", () => {
  let organisationId: string;
  let otherOrganisationId: string;
  let sourceSystemId: string;
  let actorUserId: string;
  const exactBytes = workbookBytes(juneLikeSheets());
  const exactSha256 = createHash("sha256").update(exactBytes).digest("hex");
  const exactDescriptors = descriptorsFor(juneLikeSheets());

  beforeAll(async () => {
    const org = await prisma.organisation.create({ data: { name: "6.2D3E Real-Shape Proof Org", slug: `proof-org-6-2d3e-shape-${Date.now()}` } });
    organisationId = org.id;
    const otherOrg = await prisma.organisation.create({ data: { name: "6.2D3E Real-Shape Proof Org (other)", slug: `proof-org-6-2d3e-shape-other-${Date.now()}` } });
    otherOrganisationId = otherOrg.id;
    const user = await prisma.user.create({ data: { organisation_id: organisationId, username: `actor-${Date.now()}`, name: "D3E Real-Shape Proof Actor" } });
    actorUserId = user.id;
    const ss = await prisma.sourceSystem.create({ data: { organisation_id: organisationId, name: SS_NAME, active: true } });
    sourceSystemId = ss.id;

    // Real D3B seed, then real 6.2D3E activation — the actual scripts,
    // never re-typed logic.
    psql(SEED_SQL);
    psql(ACTIVATE_SQL, ["-v", `actor_user_id=${actorUserId}`]);
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createBatch(label: string, bytes: Buffer, sha256: string, descriptors: ReturnType<typeof descriptorsFor>) {
    const batch = await prisma.importBatch.create({
      data: {
        organisation_id: organisationId,
        source_system_id: sourceSystemId,
        original_filename: `${label}.xlsx`,
        content_type: "xlsx",
        size_bytes: bytes.byteLength,
        sha256,
        storage_provider: "in-memory-proof-store",
        storage_key: `proof-key-${label}-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
        status: "READY",
      },
    });
    inMemoryBlobs.set(buildImportBatchKey(organisationId, batch.id), bytes);
    for (const d of descriptors) {
      await prisma.upload.create({
        data: {
          organisation_id: organisationId,
          original_name: `${label}.xlsx`,
          stored_path: "n/a",
          mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size_bytes: bytes.byteLength,
          lineage_kind: "DATA_HUB",
          import_batch_id: batch.id,
          worksheet_index: d.worksheet_index,
          worksheet_name: d.worksheet_name,
          worksheet_visibility: d.worksheet_visibility,
          worksheet_is_empty: d.worksheet_is_empty,
          canonical_status: "AWAITING_CONFIRMATION",
        },
      });
    }
    return batch.id;
  }

  it("Section 23 — D3C: a structurally exact real 14-sheet workbook resolves EXACT_MATCH against the real ACTIVE schema, zero writes", async () => {
    const batchId = await createBatch("d3c-exact", exactBytes, exactSha256, exactDescriptors);
    const client = new PrismaClient();
    try {
      const { matchImportBatchSchema } = await freshMatch();
      const result = await runWithClient(client, () => matchImportBatchSchema({ organisationId, importBatchId: batchId }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.result).toBe("EXACT_MATCH");
      expect(result.report.sourceSchemaStatus).toBe("ACTIVE");
      expect(result.report.governedWorksheetCount).toBe(14);
    } finally {
      await client.$disconnect();
    }
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.dataset_type_id).toBeNull();
    expect(batch.source_schema_version_id).toBeNull();
  });

  it("Section 24 — D3D: the same real exact workbook, on a READY tenant-correct hash-valid batch, pins dataset_type_id + source_schema_version_id", async () => {
    const batchId = await createBatch("d3d-exact", exactBytes, exactSha256, exactDescriptors);
    const client = new PrismaClient();
    let result: Awaited<ReturnType<(typeof import("../../lib/data-hub/schemaMatch/establishImportBatchSchemaLineage"))["establishImportBatchSchemaLineage"]>>;
    try {
      const { establishImportBatchSchemaLineage } = await freshEstablish();
      result = await runWithClient(client, () => establishImportBatchSchemaLineage({ organisationId, importBatchId: batchId, actorUserId }));
    } finally {
      await client.$disconnect();
    }
    expect(result).toMatchObject({ ok: true, alreadySelected: false, datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID });
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.dataset_type_id).toBe(DT_ID);
    expect(batch.source_schema_version_id).toBe(SV_ID);
  });

  it("Section 24 — wrong tenant still resolves BATCH_NOT_FOUND against the real activated schema", async () => {
    const batchId = await createBatch("d3d-wrong-tenant", exactBytes, exactSha256, exactDescriptors);
    const client = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage } = await freshEstablish();
      const result = await runWithClient(client, () => establishImportBatchSchemaLineage({ organisationId: otherOrganisationId, importBatchId: batchId, actorUserId }));
      expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
    } finally {
      await client.$disconnect();
    }
  });

  it("Section 24 — drift against the real activated schema still cannot pin (structural drift is now BLOCKING once ACTIVE, not merely a DRAFT warning)", async () => {
    const driftedSheets = juneLikeSheets((name, headers) => (name === "Overview" ? [...headers.slice(0, -1), "Renamed Last Column"] : headers));
    const driftedBytes = workbookBytes(driftedSheets);
    const driftedSha256 = createHash("sha256").update(driftedBytes).digest("hex");
    const batchId = await createBatch("d3d-drift", driftedBytes, driftedSha256, descriptorsFor(driftedSheets));
    const client = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage } = await freshEstablish();
      const result = await runWithClient(client, () => establishImportBatchSchemaLineage({ organisationId, importBatchId: batchId, actorUserId }));
      expect(result).toMatchObject({ ok: false, code: "SCHEMA_EXACT_MATCH_REQUIRED" });
    } finally {
      await client.$disconnect();
    }
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.dataset_type_id).toBeNull();
  });

  it("Section 24 — RETIRED blocks NEW pinning, but historical pinned lineage remains idempotent after retirement", async () => {
    // Establish one legitimate pin BEFORE retiring.
    const pinnedBatchId = await createBatch("d3d-pinned-before-retire", exactBytes, exactSha256, exactDescriptors);
    const pinClient = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage } = await freshEstablish();
      const pinned = await runWithClient(pinClient, () => establishImportBatchSchemaLineage({ organisationId, importBatchId: pinnedBatchId, actorUserId }));
      expect(pinned).toMatchObject({ ok: true, alreadySelected: false });
    } finally {
      await pinClient.$disconnect();
    }

    // Retire the real, now-ACTIVE schema directly (no runtime/admin
    // retirement writer exists yet — this simulates a future governance
    // action strictly for this proof, exactly as the sibling activation
    // proof simulates activation via the real script).
    psql(`UPDATE source_schema_versions SET status = 'RETIRED' WHERE id = '${SV_ID}'`);

    // A NEW, unpinned batch must now be blocked.
    const newBatchId = await createBatch("d3d-new-after-retire", exactBytes, exactSha256, exactDescriptors);
    const newClient = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage } = await freshEstablish();
      const result = await runWithClient(newClient, () => establishImportBatchSchemaLineage({ organisationId, importBatchId: newBatchId, actorUserId }));
      expect(result).toMatchObject({ ok: false, code: "GOVERNED_SCHEMA_NOT_ACTIVE" });
    } finally {
      await newClient.$disconnect();
    }

    // The batch pinned BEFORE retirement remains idempotently successful.
    const replayClient = new PrismaClient();
    try {
      const { establishImportBatchSchemaLineage } = await freshEstablish();
      const replay = await runWithClient(replayClient, () => establishImportBatchSchemaLineage({ organisationId, importBatchId: pinnedBatchId, actorUserId }));
      expect(replay).toMatchObject({ ok: true, alreadySelected: true, datasetTypeId: DT_ID, sourceSchemaVersionId: SV_ID });
    } finally {
      await replayClient.$disconnect();
    }
  });
});
