import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";

// Data Hub 6.2D4B remediation — real disposable-Postgres, ROUTE-LEVEL
// multi-request continuation integration test for
// app/api/data-hub/worksheets/[id]/stage (the exact seam an independent
// review found a real bug in: POST -> RUNNING -> POST -> SUCCEEDED was
// blocked for up to ~120s because the first worker never yielded its
// lease). This is the "not exercised end-to-end" gap flagged in the
// original D4B implementation report.
//
// Run ONLY via scripts/tests/verify-datahub-stage-worksheet-route.sh.
//
// TEST SEAM (mirrors dataHubInitiateFinalizeRoutes.integration.test.ts
// exactly):
//   - lib/org's requireRole is mocked (auth seam) — controlled per test.
//   - lib/db's tagged-template `sql` (used by every lib/data-hub/staging/*
//     module) is replaced by a Prisma-backed equivalent, so their real,
//     unmodified raw SQL and the real datahub_stage_raw_batch /
//     datahub_complete_raw_staging_run Postgres functions run against the
//     SAME real Postgres container this suite's own Prisma client uses.
//   - lib/data-hub/importBatch/compositionRoot.ts's createImportBatchStorage
//     is overridden to return a shared real InMemoryFileStore instead of
//     the real Vercel Blob adapter.
// The route handlers themselves (POST/GET) are the real, unmodified
// exported functions, invoked directly.
//
// TESTABLE TIME BUDGET: lib/data-hub/staging/stagingConfig.ts's
// resolveMaxDurationMs()/resolveTargetCellsPerBatch() read test-only env
// var overrides, gated on NODE_ENV === "test" (which vitest sets by
// default) — never a client-facing or production-reachable override.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "dataHubStageWorksheetRoute.integration.test.ts requires DATABASE_URL to point at a disposable " +
      "Postgres container (see scripts/tests/verify-datahub-stage-worksheet-route.sh). Refusing to run without it."
  );
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error(
    "Refusing to run against a DATABASE_URL that looks like a real hosted/Production database. " +
      "This suite may ONLY run against a local disposable Docker container."
  );
}
if (!/^(localhost|127\.0\.0\.1)/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, "http://")).hostname)) {
  throw new Error("Refusing to run against a non-localhost DATABASE_URL host.");
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

async function neonCompatibleSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}` + strings[i + 1];
  }
  return prisma.$queryRawUnsafe(text, ...values);
}

vi.doMock("@/lib/db", () => ({ default: neonCompatibleSql }));

let sharedStore: InstanceType<typeof import("@/lib/data-hub/storage/inMemoryFileStore").InMemoryFileStore>;
vi.doMock("@/lib/data-hub/importBatch/compositionRoot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data-hub/importBatch/compositionRoot")>();
  return {
    ...actual,
    createImportBatchStorage: () => sharedStore,
  };
});

type MockSession = { userId: string; organisationId: string; homeOrganisationId: string; role: string; name: string };
let nextSession: MockSession | null = null;

vi.mock("@/lib/org", () => ({
  requireRole: vi.fn(async (min: string) => {
    if (!nextSession) throw new Error("Unauthorized");
    const order = ["viewer", "manager", "admin", "super_admin"];
    if (order.indexOf(nextSession.role) < order.indexOf(min)) throw new Error("Forbidden");
    return nextSession;
  }),
}));

function asSession(overrides: Partial<MockSession> & { organisationId: string; userId: string; role: string }) {
  nextSession = {
    homeOrganisationId: overrides.organisationId,
    name: "Test User",
    ...overrides,
  };
}

let POST_stage: typeof import("@/app/api/data-hub/worksheets/[id]/stage/route").POST;
let buildImportBatchKey: typeof import("@/lib/data-hub/storage/rawFileStore").buildImportBatchKey;

const ORG = "d4b-int-org";
const MANAGER_A = "d4b-int-manager-a";
const MANAGER_B = "d4b-int-manager-b";

function stageRequest(uploadId: string) {
  return {
    req: new NextRequest(`http://localhost/api/data-hub/worksheets/${uploadId}/stage`, { method: "POST" }),
    params: Promise.resolve({ id: uploadId }),
  };
}

function buildWorkbook(dataRowCount: number): { bytes: Uint8Array; sha256: string } {
  const rows: unknown[][] = [["Code", "Amount"]];
  for (let i = 1; i <= dataRowCount; i++) rows.push([`R${i}`, i]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const bytes = new Uint8Array(buf);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function seedGovernedWorkbook(opts: { importBatchId: string; uploadId: string; dataRowCount: number }) {
  const { bytes, sha256 } = buildWorkbook(opts.dataRowCount);

  await prisma.sourceSystem.create({ data: { id: `${opts.importBatchId}-ss`, organisation_id: ORG, name: `Int SS ${opts.importBatchId}`, active: true } });
  await prisma.datasetType.create({ data: { id: `${opts.importBatchId}-dt`, organisation_id: ORG, source_system_id: `${opts.importBatchId}-ss`, name: `Int DT ${opts.importBatchId}`, active: true } });
  await prisma.sourceSchemaVersion.create({
    data: { id: `${opts.importBatchId}-sv`, organisation_id: ORG, dataset_type_id: `${opts.importBatchId}-dt`, version_number: 1, label: `Int SV ${opts.importBatchId}`, status: "ACTIVE", activated_at: new Date() },
  });
  await prisma.sourceSchemaWorksheet.create({
    data: { id: `${opts.importBatchId}-ws`, organisation_id: ORG, source_schema_version_id: `${opts.importBatchId}-sv`, logical_key: "data", expected_name: "Data", ordinal_hint: 0, presence: "REQUIRED", role: "DATA" },
  });
  await prisma.sourceSchemaColumn.createMany({
    data: [
      { id: `${opts.importBatchId}-col-0`, organisation_id: ORG, source_schema_worksheet_id: `${opts.importBatchId}-ws`, ordinal: 0, source_header: "Code", presence: "REQUIRED", declared_type: "STRING", sensitivity_class: "PUBLIC" },
      { id: `${opts.importBatchId}-col-1`, organisation_id: ORG, source_schema_worksheet_id: `${opts.importBatchId}-ws`, ordinal: 1, source_header: "Amount", presence: "REQUIRED", declared_type: "DECIMAL", sensitivity_class: "INTERNAL" },
    ],
  });
  await prisma.worksheetMappingProfile.create({
    data: { id: `${opts.importBatchId}-wp`, organisation_id: ORG, source_schema_worksheet_id: `${opts.importBatchId}-ws`, name: "Profile", active: true },
  });
  await prisma.worksheetMappingProfileVersion.create({
    data: { id: `${opts.importBatchId}-wpv`, organisation_id: ORG, worksheet_mapping_profile_id: `${opts.importBatchId}-wp`, version_number: 1, disposition: "STAGING_DATASET", profile_document: { documentVersion: 1, headerRowOneBased: 1, schemaStatus: "ACTIVE" } },
  });
  await prisma.worksheetMappingProfile.update({ where: { id: `${opts.importBatchId}-wp` }, data: { active_profile_version_id: `${opts.importBatchId}-wpv` } });

  await prisma.importBatch.create({
    data: {
      id: opts.importBatchId, organisation_id: ORG, original_filename: "int.xlsx", content_type: "xlsx",
      size_bytes: bytes.byteLength, sha256, storage_provider: "memory", storage_key: buildImportBatchKey(ORG, opts.importBatchId), status: "READY",
      source_system_id: `${opts.importBatchId}-ss`, dataset_type_id: `${opts.importBatchId}-dt`, source_schema_version_id: `${opts.importBatchId}-sv`,
    },
  });
  await prisma.upload.create({
    data: {
      id: opts.uploadId, organisation_id: ORG, original_name: "int.xlsx", stored_path: "n/a",
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: bytes.byteLength,
      lineage_kind: "DATA_HUB", import_batch_id: opts.importBatchId, worksheet_index: 0, worksheet_name: "Data",
      worksheet_visibility: "visible", worksheet_is_empty: false, canonical_status: "AWAITING_CONFIRMATION",
    },
  });

  await sharedStore.put(buildImportBatchKey(ORG, opts.importBatchId), bytes);
}

beforeAll(async () => {
  const { InMemoryFileStore } = await import("@/lib/data-hub/storage/inMemoryFileStore");
  sharedStore = new InMemoryFileStore();

  ({ POST: POST_stage } = await import("@/app/api/data-hub/worksheets/[id]/stage/route"));
  ({ buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore"));

  await prisma.organisation.create({ data: { id: ORG, name: "D4B Int Org", slug: ORG } });
  await prisma.user.createMany({
    data: [
      { id: MANAGER_A, organisation_id: ORG, username: MANAGER_A, name: "Manager A" },
      { id: MANAGER_B, organisation_id: ORG, username: MANAGER_B, name: "Manager B" },
    ],
  });
}, 60_000);

afterAll(async () => {
  delete process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE;
  delete process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE;
  await prisma.$disconnect();
});

beforeEach(() => {
  delete process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE;
  delete process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE;
});

describe("6.2D4B remediation — route-level multi-request continuation integration", () => {
  it("POST #1 processes only part of the workbook and gracefully yields (202 RUNNING); POST #2 immediately (no wait) resumes and completes (200 SUCCEEDED)", async () => {
    const importBatchId = "int-batch-main";
    const uploadId = "int-upload-main";
    await seedGovernedWorkbook({ importBatchId, uploadId, dataRowCount: 10 });

    // Force exactly ONE row per batch, and a budget so small that the
    // "process a batch, then check the budget" loop always yields after
    // that first batch — deterministic regardless of machine speed (see
    // stageWorksheetRows.ts's own remediation comment on loop ordering).
    process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE = "2";
    process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE = "1";

    asSession({ organisationId: ORG, userId: MANAGER_A, role: "manager" });
    const first = stageRequest(uploadId);
    const res1 = await POST_stage(first.req, { params: first.params });
    expect(res1.status).toBe(202);
    const body1 = await res1.json();
    expect(body1.status).toBe("RUNNING");
    // execution_token must never appear in the response body, at any status.
    expect(JSON.stringify(body1)).not.toContain("execution_token");
    expect(JSON.stringify(body1)).not.toMatch(/executionToken/);

    const runsAfterFirst = await prisma.dataHubRawStagingRun.findMany({ where: { organisation_id: ORG, upload_id: uploadId } });
    expect(runsAfterFirst).toHaveLength(1);
    expect(runsAfterFirst[0].status).toBe("RUNNING");
    // The lease was gracefully yielded — already reacquirable right now.
    expect(runsAfterFirst[0].lease_expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 500);
    expect(runsAfterFirst[0].persisted_row_count).toBeGreaterThan(0);
    expect(runsAfterFirst[0].persisted_row_count).toBeLessThan(10);

    const rowsAfterFirst = await prisma.dataHubRawRow.findMany({ where: { staging_run_id: runsAfterFirst[0].id } });
    expect(rowsAfterFirst).toHaveLength(runsAfterFirst[0].persisted_row_count);

    // POST #2, IMMEDIATELY — no wait for lease expiry — as a DIFFERENT
    // manager. Reset the budget so it can finish everything in one go.
    delete process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE;
    delete process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE;
    asSession({ organisationId: ORG, userId: MANAGER_B, role: "manager" });
    const second = stageRequest(uploadId);
    const res2 = await POST_stage(second.req, { params: second.params });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.status).toBe("SUCCEEDED");
    expect(body2.rowCount).toBe(10);
    expect(body2.cellCount).toBe(20);
    expect(JSON.stringify(body2)).not.toContain("execution_token");

    // Only one staging run ever existed for this upload.
    const allRuns = await prisma.dataHubRawStagingRun.findMany({ where: { organisation_id: ORG, upload_id: uploadId } });
    expect(allRuns).toHaveLength(1);
    expect(allRuns[0].status).toBe("SUCCEEDED");
    expect(allRuns[0].persisted_row_count).toBe(10);
    expect(allRuns[0].persisted_cell_count).toBe(20);
    expect(allRuns[0].expected_row_count).toBe(10);
    expect(allRuns[0].expected_cell_count).toBe(20);

    // No duplicate rows, no duplicate cells, no physical row inserted twice.
    const allRows = await prisma.dataHubRawRow.findMany({ where: { staging_run_id: allRuns[0].id } });
    expect(allRows).toHaveLength(10);
    const distinctSourceRowNumbers = new Set(allRows.map((r) => r.source_row_number));
    expect(distinctSourceRowNumbers.size).toBe(10);
    // Physical rows are 2..11 (row 1 is the header).
    expect([...distinctSourceRowNumbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 2)
    );

    const allCells = await prisma.dataHubRawCell.findMany({ where: { raw_row_id: { in: allRows.map((r) => r.id) } } });
    expect(allCells).toHaveLength(20);

    // Upload completion state.
    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(upload.raw_staging_run_id).toBe(allRuns[0].id);
    // The actor completing POST #2, NOT the actor who initiated POST #1.
    expect(upload.raw_staged_by).toBe(MANAGER_B);
    expect(upload.raw_row_count).toBe(10);
    expect(upload.raw_cell_count).toBe(20);

    // Final persisted/actual/expected counts all agree.
    const actualRowCount = await prisma.dataHubRawRow.count({ where: { staging_run_id: allRuns[0].id } });
    const actualCellCount = await prisma.dataHubRawCell.count({ where: { raw_row_id: { in: allRows.map((r) => r.id) } } });
    expect(actualRowCount).toBe(allRuns[0].persisted_row_count);
    expect(actualCellCount).toBe(allRuns[0].persisted_cell_count);
  });

  it("a concurrent POST while another request still holds a live lease returns 409 RUN_ALREADY_IN_PROGRESS", async () => {
    const importBatchId = "int-batch-conc";
    const uploadId = "int-upload-conc";
    await seedGovernedWorkbook({ importBatchId, uploadId, dataRowCount: 3 });

    // Force POST #1 to yield-nothing... actually force it to STAY RUNNING
    // with a LIVE (not-yet-expired) lease by giving it a generous budget
    // (default) so it completes in one shot instead — to hold a live
    // lease deliberately, seed a RUNNING run directly rather than racing
    // two real requests against each other in-process.
    asSession({ organisationId: ORG, userId: MANAGER_A, role: "manager" });
    const eligibility = await (await import("@/lib/data-hub/staging/eligibility")).resolveStagingEligibility({ organisationId: ORG, uploadId });
    if (!eligibility.ok) throw new Error("eligibility setup failed for concurrency test");
    await prisma.dataHubRawStagingRun.create({
      data: {
        id: "int-run-conc-live", organisation_id: ORG, import_batch_id: importBatchId, upload_id: uploadId,
        source_schema_version_id: eligibility.sourceSchemaVersionId, source_schema_worksheet_id: eligibility.sourceSchemaWorksheetId,
        worksheet_mapping_profile_id: eligibility.worksheetMappingProfileId, worksheet_mapping_profile_version_id: eligibility.worksheetMappingProfileVersionId,
        attempt_number: 1, source_sha256: eligibility.sha256, parser_version: "test", status: "RUNNING",
        execution_token: "int-tok-live-holder", lease_expires_at: new Date(Date.now() + 60_000), last_progress_at: new Date(),
        expected_row_count: 3, expected_cell_count: 6, persisted_row_count: 0, persisted_cell_count: 0,
      },
    });

    const req = stageRequest(uploadId);
    const res = await POST_stage(req.req, { params: req.params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("RUN_ALREADY_IN_PROGRESS");

    await prisma.dataHubRawStagingRun.update({ where: { id: "int-run-conc-live" }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
  });

  it("a POST immediately after a graceful yield resumes successfully (no duplicate rows across the boundary)", async () => {
    const importBatchId = "int-batch-resume";
    const uploadId = "int-upload-resume";
    await seedGovernedWorkbook({ importBatchId, uploadId, dataRowCount: 6 });

    process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE = "2";
    process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE = "1";
    asSession({ organisationId: ORG, userId: MANAGER_A, role: "manager" });
    const first = stageRequest(uploadId);
    const res1 = await POST_stage(first.req, { params: first.params });
    expect(res1.status).toBe(202);

    delete process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE;
    delete process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE;
    const second = stageRequest(uploadId);
    const res2 = await POST_stage(second.req, { params: second.params });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.status).toBe("SUCCEEDED");

    const runs = await prisma.dataHubRawStagingRun.findMany({ where: { organisation_id: ORG, upload_id: uploadId } });
    expect(runs).toHaveLength(1);
    const rows = await prisma.dataHubRawRow.findMany({ where: { staging_run_id: runs[0].id } });
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.source_row_number)).size).toBe(6);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Remediation — pinned-profile resume correction (item 4).
  // ─────────────────────────────────────────────────────────────────────

  it("pointer-flip: a run pinned to profile v1 keeps using v1's header semantics even after v2 becomes active mid-run, and only a FUTURE new run would ever see v2", async () => {
    const importBatchId = "int-batch-flip";
    const uploadId = "int-upload-flip";
    await seedGovernedWorkbook({ importBatchId, uploadId, dataRowCount: 10 });

    const profileId = `${importBatchId}-wp`;
    const v1Id = `${importBatchId}-wpv`; // created by seedGovernedWorkbook, headerRowOneBased: 1

    // POST #1: pins v1, stages a partial batch, gracefully yields.
    process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE = "2";
    process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE = "1";
    asSession({ organisationId: ORG, userId: MANAGER_A, role: "manager" });
    const first = stageRequest(uploadId);
    const res1 = await POST_stage(first.req, { params: first.params });
    expect(res1.status).toBe(202);

    const runAfterFirst = await prisma.dataHubRawStagingRun.findFirstOrThrow({ where: { organisation_id: ORG, upload_id: uploadId, status: "RUNNING" } });
    expect(runAfterFirst.worksheet_mapping_profile_version_id).toBe(v1Id);
    const persistedAfterFirst = runAfterFirst.persisted_row_count;
    expect(persistedAfterFirst).toBeGreaterThan(0);
    expect(persistedAfterFirst).toBeLessThan(10);

    // Between requests: create and activate profile v2 for the SAME
    // worksheet, with a DELIBERATELY DIFFERENT headerRowOneBased (2, not
    // 1) — a purely test-fixture-level DB write simulating a real
    // governance activation, not touching any real activation script.
    // If v2 were (incorrectly) used to resume, physical row 2 would be
    // reinterpreted as the header, and only 9 (not 10) data rows would
    // ever be reachable — an observable, unambiguous difference.
    const v2Id = `${importBatchId}-wpv2`;
    await prisma.worksheetMappingProfileVersion.create({
      // headerRowOneBased is deliberately set WELL AHEAD of wherever
      // POST #1 leaves the resume cursor (never just +1) — if this were
      // (incorrectly) used to resume, it would skip several already-
      // reachable rows entirely (Math.max(pinnedHeaderRow, cursor) in
      // readWorksheetDataRows), which the completion gate's own count
      // reconciliation would then reject. A too-small difference (e.g.
      // +1) can coincide with the resume cursor already being past it,
      // masking the bug — this value is chosen specifically to avoid that.
      data: { id: v2Id, organisation_id: ORG, worksheet_mapping_profile_id: profileId, version_number: 2, disposition: "STAGING_DATASET", profile_document: { documentVersion: 1, headerRowOneBased: 6, schemaStatus: "ACTIVE" } },
    });
    await prisma.worksheetMappingProfile.update({ where: { id: profileId }, data: { active_profile_version_id: v2Id } });

    // POST #2, immediately, resuming.
    delete process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE;
    delete process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE;
    asSession({ organisationId: ORG, userId: MANAGER_B, role: "manager" });
    const second = stageRequest(uploadId);
    const res2 = await POST_stage(second.req, { params: second.params });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.status).toBe("SUCCEEDED");

    // Same staging run resumed — never a second run.
    const allRuns = await prisma.dataHubRawStagingRun.findMany({ where: { organisation_id: ORG, upload_id: uploadId } });
    expect(allRuns).toHaveLength(1);
    expect(allRuns[0].id).toBe(runAfterFirst.id);
    // Still pinned to v1 — completely unaffected by v2 becoming active.
    expect(allRuns[0].worksheet_mapping_profile_version_id).toBe(v1Id);
    expect(allRuns[0].status).toBe("SUCCEEDED");

    // Final raw rows/cells are correct FOR v1 (all 10 physical rows,
    // 2..11) — proving v1's headerRowOneBased=1 was used throughout, not
    // v2's headerRowOneBased=6 (which, if used to resume, would have
    // skipped ahead and produced fewer than 10 rows, failing the
    // completion gate's own count reconciliation).
    const allRows = await prisma.dataHubRawRow.findMany({ where: { staging_run_id: allRuns[0].id } });
    expect(allRows).toHaveLength(10);
    expect([...new Set(allRows.map((r) => r.source_row_number))].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 2)
    );
    const allCells = await prisma.dataHubRawCell.findMany({ where: { raw_row_id: { in: allRows.map((r) => r.id) } } });
    expect(allCells).toHaveLength(20);

    // Upload.raw_profile_version_id = v1, never v2.
    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(upload.raw_profile_version_id).toBe(v1Id);
    expect(upload.raw_staging_run_id).toBe(allRuns[0].id);

    // v2 is real, active, and available — but ONLY for a FUTURE new run,
    // never retroactively applied to this one. (Not exercised further
    // here — a future new run for a DIFFERENT upload against the same
    // worksheet is exactly resolveStagingEligibility's own, unchanged,
    // job; this test's scope is proving THIS run never saw it.)
    const profileNow = await prisma.worksheetMappingProfile.findUniqueOrThrow({ where: { id: profileId } });
    expect(profileNow.active_profile_version_id).toBe(v2Id);
  });

  it("pointer-flip (negative form): an existing pinned run can still resume even after the CURRENT active pointer becomes unavailable/ineligible", async () => {
    const importBatchId = "int-batch-neg";
    const uploadId = "int-upload-neg";
    await seedGovernedWorkbook({ importBatchId, uploadId, dataRowCount: 5 });

    const profileId = `${importBatchId}-wp`;
    const v1Id = `${importBatchId}-wpv`;

    process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE = "2";
    process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE = "1";
    asSession({ organisationId: ORG, userId: MANAGER_A, role: "manager" });
    const first = stageRequest(uploadId);
    const res1 = await POST_stage(first.req, { params: first.params });
    expect(res1.status).toBe(202);

    const runAfterFirst = await prisma.dataHubRawStagingRun.findFirstOrThrow({ where: { organisation_id: ORG, upload_id: uploadId, status: "RUNNING" } });
    expect(runAfterFirst.worksheet_mapping_profile_version_id).toBe(v1Id);

    // The CURRENT active pointer becomes unavailable: no active version at
    // all for this worksheet's profile (simulating e.g. a profile
    // deactivation or a pointer cleared pending re-activation). A NEW run
    // attempted right now would fail STAGING_INELIGIBLE — but this run is
    // not new.
    await prisma.worksheetMappingProfile.update({ where: { id: profileId }, data: { active_profile_version_id: null } });

    delete process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE;
    delete process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE;
    asSession({ organisationId: ORG, userId: MANAGER_B, role: "manager" });
    const second = stageRequest(uploadId);
    const res2 = await POST_stage(second.req, { params: second.params });

    // The existing pinned run resumes and completes successfully — its
    // own pinned v1 remains structurally valid regardless of the active
    // pointer's own current state.
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.status).toBe("SUCCEEDED");

    const runAfter = await prisma.dataHubRawStagingRun.findUniqueOrThrow({ where: { id: runAfterFirst.id } });
    expect(runAfter.status).toBe("SUCCEEDED");
    expect(runAfter.worksheet_mapping_profile_version_id).toBe(v1Id);

    // Confirm a genuinely NEW run's own eligibility gate WOULD reject this
    // worksheet right now — proving the negative form's premise is real,
    // not vacuous (resolveStagingEligibility is the exact function a new
    // run would be gated by; this run's own successful resume above never
    // called it).
    const { resolveStagingEligibility } = await import("@/lib/data-hub/staging/eligibility");
    const freshEligibility = await resolveStagingEligibility({ organisationId: ORG, uploadId });
    expect(freshEligibility.ok).toBe(false);
    if (!freshEligibility.ok) expect(freshEligibility.code).toBe("STAGING_INELIGIBLE");
  });
});
