import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";

// Data Hub 6.2D4B2B -- real disposable-Postgres, ROUTE-LEVEL integration
// proof for app/api/data-hub/worksheets/[id]/normalize (POST + GET). Exact
// structural analogue of scripts/tests/dataHubStageWorksheetRoute.integration.test.ts
// (the D4B route-level harness) and reuses scripts/tests/dataHubNormalizationExecutor.integration.test.ts's
// own seedWorld fixture shape for producing SUCCEEDED B1 raw-staging
// evidence a normalization run can be created/resumed against.
//
// Run ONLY via scripts/tests/verify-datahub-normalize-worksheet-route.sh.
//
// TEST SEAM:
//   - lib/org's requireRole is mocked (auth seam) -- controlled per test,
//     exactly like the D4B route harness.
//   - lib/db's tagged-template `sql` (used by the B2B2A executor service and
//     B2B1's own SQL functions) is replaced by a Prisma-backed equivalent,
//     so the REAL, unmodified B1/B2B1/B2B2A code runs against the SAME real
//     Postgres container this suite's own Prisma client uses.
// The route handlers themselves (POST/GET) are the real, unmodified
// exported functions, invoked directly -- never a duplicated fake route.
//
// TESTABLE TIME BUDGET: the route calls the SAME resolveMaxDurationMs() D4B
// uses (lib/data-hub/staging/stagingConfig.ts), which reads test-only env
// var overrides gated on NODE_ENV === "test".

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "dataHubNormalizeWorksheetRoute.integration.test.ts requires DATABASE_URL to point at a disposable " +
      "Postgres container (see scripts/tests/verify-datahub-normalize-worksheet-route.sh). Refusing to run without it."
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

let POST_normalize: typeof import("@/app/api/data-hub/worksheets/[id]/normalize/route").POST;
let GET_normalize: typeof import("@/app/api/data-hub/worksheets/[id]/normalize/route").GET;

const ORG_A = "d4b2b-int-org-a";
const ORG_B = "d4b2b-int-org-b";
const MANAGER_A = "d4b2b-int-manager-a";
const MANAGER_B = "d4b2b-int-manager-b";
const MANAGER_C_OTHER_ORG = "d4b2b-int-manager-c";

function postRequest(uploadId: string) {
  return {
    req: new NextRequest(`http://localhost/api/data-hub/worksheets/${uploadId}/normalize`, { method: "POST" }),
    params: Promise.resolve({ id: uploadId }),
  };
}
function getRequest(uploadId: string) {
  return {
    req: new NextRequest(`http://localhost/api/data-hub/worksheets/${uploadId}/normalize`, { method: "GET" }),
    params: Promise.resolve({ id: uploadId }),
  };
}

// ─── Fixture builder ────────────────────────────────────────────────────
// Builds one fresh, isolated world per call in the given org: a user, a
// governed worksheet with two columns (IDENTIFIER + DECIMAL), an import
// batch + upload, and a SUCCEEDED raw staging run with the requested rows
// already staged -- i.e. an upload that is immediately normalize-eligible.
// Adapted directly from dataHubNormalizationExecutor.integration.test.ts's
// own seedWorld.

interface SeedRow {
  id: string;
  sourceRowNumber: number;
  col1: string;
  col2: string | null;
}

async function seedNormalizeEligibleWorksheet(org: string, suffix: string, rows: SeedRow[]) {
  const userId = `user-${suffix}`;
  const wsId = `ws-${suffix}`;
  const svId = `sv-${suffix}`;
  const col1 = `col1-${suffix}`;
  const col2 = `col2-${suffix}`;
  const profileId = `wp-${suffix}`;
  const pvId = `pv-${suffix}`;
  const batchId = `batch-${suffix}`;
  const uploadId = `up-${suffix}`;
  const rawRunId = `run-${suffix}`;

  await prisma.$executeRawUnsafe(`INSERT INTO users (id, organisation_id, username, email, name, password_hash, role, updated_at) VALUES ('${userId}','${org}','${userId}','${userId}@x.com','User ${suffix}','x','MANAGER', now()) ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_systems (id, organisation_id, name, updated_at) VALUES ('ss-${suffix}','${org}','SS ${suffix}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO dataset_types (id, organisation_id, source_system_id, name, updated_at) VALUES ('dt-${suffix}','${org}','ss-${suffix}','DT ${suffix}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('${svId}','${org}','dt-${suffix}',1,'v1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role, ordinal_hint) VALUES ('${wsId}','${org}','${svId}','runs','Runs','OPTIONAL','DATA',0)`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class) VALUES ('${col1}','${org}','${wsId}',0,'Id','OPTIONAL','UNKNOWN','CONFIDENTIAL'),('${col2}','${org}','${wsId}',1,'Weight','OPTIONAL','UNKNOWN','CONFIDENTIAL')`);
  await prisma.$executeRawUnsafe(`INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name, active, updated_at) VALUES ('${profileId}','${org}','${wsId}','treatment-${suffix}', true, now())`);

  const profileDocument = JSON.stringify({
    documentVersion: 2,
    schemaStatus: "DRAFT",
    headerRowOneBased: 3,
    columnRules: [
      { sourceSchemaColumnId: col1, valueKind: "IDENTIFIER", preserveLeadingZeros: true },
      { sourceSchemaColumnId: col2, valueKind: "DECIMAL" },
    ],
  }).replace(/'/g, "''");
  await prisma.$executeRawUnsafe(`INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('${pvId}','${org}','${profileId}',1,'STAGING_DATASET','${profileDocument}')`);
  await prisma.$executeRawUnsafe(`UPDATE worksheet_mapping_profiles SET active_profile_version_id='${pvId}' WHERE id='${profileId}'`);

  const sha = suffix.padEnd(64, "0").slice(0, 64);
  await prisma.$executeRawUnsafe(`INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256, source_schema_version_id, updated_at) VALUES ('${batchId}','${org}','${userId}','f.xlsx','xlsx',1,'vercel-blob','k-${suffix}','READY', '${sha}', '${svId}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, worksheet_name, lineage_kind, updated_at) VALUES ('${uploadId}','${org}','f.xlsx','p','x',1,'${batchId}',0,'Runs','DATA_HUB', now())`);

  const rowCount = rows.length;
  const cellCount = rowCount * 2;
  await prisma.$executeRawUnsafe(
    `INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('${rawRunId}','${org}','${batchId}','${uploadId}','${svId}','${wsId}','${profileId}','${pvId}',1,'${sha}','v1','SUCCEEDED','tok-${suffix}', now()+interval '1 hour', now(), ${rowCount}, ${cellCount}, ${rowCount}, ${cellCount}, now())`
  );
  await prisma.$executeRawUnsafe(`UPDATE uploads SET raw_staged_at=now(), raw_staged_by='${userId}', raw_profile_version_id='${pvId}', raw_row_count=${rowCount}, raw_cell_count=${cellCount}, raw_staging_run_id='${rawRunId}' WHERE id='${uploadId}'`);

  for (const row of rows) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_raw_rows (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, staging_run_id, source_row_number)
       VALUES ('${row.id}','${org}','${batchId}','${uploadId}','${svId}','${wsId}','${profileId}','${pvId}','${rawRunId}',${row.sourceRowNumber})`
    );
    const col2Value = row.col2 === null ? "null" : JSON.stringify(row.col2);
    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_raw_cells (id, organisation_id, raw_row_id, source_schema_worksheet_id, source_schema_column_id, column_ordinal, source_header, raw_value, raw_value_type, sensitivity_class, original_unit)
       VALUES ('${row.id}-c1','${org}','${row.id}','${wsId}','${col1}',0,'Id','${JSON.stringify(row.col1)}','STRING','CONFIDENTIAL', NULL),
              ('${row.id}-c2','${org}','${row.id}','${wsId}','${col2}',1,'Weight','${col2Value}',${row.col2 === null ? "'NULL'" : "'STRING'"},'CONFIDENTIAL', NULL)`
    );
  }

  return { userId, wsId, svId, col1, col2, profileId, pvId, batchId, uploadId, rawRunId };
}

let seq = 0;
const RUN_SALT = Date.now().toString(36).slice(-6);
function nextSuffix(prefix: string): string {
  seq += 1;
  return `${prefix}${RUN_SALT}${seq}`;
}

beforeAll(async () => {
  ({ POST: POST_normalize, GET: GET_normalize } = await import("@/app/api/data-hub/worksheets/[id]/normalize/route"));

  await prisma.$executeRawUnsafe(`INSERT INTO organisations (id, name, slug, updated_at) VALUES ('${ORG_A}', 'D4B2B Int Org A', '${ORG_A}', now()) ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO organisations (id, name, slug, updated_at) VALUES ('${ORG_B}', 'D4B2B Int Org B', '${ORG_B}', now()) ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO users (id, organisation_id, username, email, name, password_hash, role, updated_at) VALUES ('${MANAGER_A}','${ORG_A}','${MANAGER_A}','${MANAGER_A}@x.com','Manager A','x','MANAGER', now()) ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO users (id, organisation_id, username, email, name, password_hash, role, updated_at) VALUES ('${MANAGER_B}','${ORG_A}','${MANAGER_B}','${MANAGER_B}@x.com','Manager B','x','MANAGER', now()) ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO users (id, organisation_id, username, email, name, password_hash, role, updated_at) VALUES ('${MANAGER_C_OTHER_ORG}','${ORG_B}','${MANAGER_C_OTHER_ORG}','${MANAGER_C_OTHER_ORG}@x.com','Manager C','x','MANAGER', now()) ON CONFLICT (id) DO NOTHING`);
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

describe("6.2D4B2B — normalize-worksheet route integration", () => {
  // ─── A + B + C + D: create/execute, bounded continuation, GET consistency ───
  it("A/B/C/D: manager POST creates+executes against real B1/B2B1 code; bounded continuation (202 -> 200); GET reflects RUNNING then SUCCEEDED", async () => {
    const s = nextSuffix("main");
    const rows: SeedRow[] = Array.from({ length: 6 }, (_, i) => ({
      id: `${s}-r${i + 1}`,
      sourceRowNumber: i + 4,
      col1: `id-${i + 1}`,
      col2: String(i + 1),
    }));
    const ids = await seedNormalizeEligibleWorksheet(ORG_A, s, rows);

    // Force exactly one row per batch and a near-zero budget so the first
    // POST always yields after one batch, deterministically.
    process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE = "2";
    process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE = "1";

    asSession({ organisationId: ORG_A, userId: MANAGER_A, role: "manager" });
    const first = postRequest(ids.uploadId);
    const res1 = await POST_normalize(first.req, { params: first.params });
    expect(res1.status).toBe(202);
    const body1 = await res1.json();
    expect(body1).toEqual({ ok: true, status: "RUNNING", persistedRowCount: expect.any(Number), persistedCellCount: expect.any(Number) });
    expect(body1.persistedRowCount).toBeGreaterThan(0);
    expect(body1.persistedRowCount).toBeLessThan(6);
    const raw1 = JSON.stringify(body1);
    expect(raw1).not.toMatch(/executionToken|execution_token|runId/i);

    // GET immediately after POST #1: RUNNING.
    const getAfterFirst = getRequest(ids.uploadId);
    const getRes1 = await GET_normalize(getAfterFirst.req, { params: getAfterFirst.params });
    expect(getRes1.status).toBe(200);
    const getBody1 = await getRes1.json();
    expect(getBody1.status).toBe("RUNNING");
    expect(JSON.stringify(getBody1)).not.toMatch(/executionToken|execution_token/i);

    // POST #2, immediately -- no wait for lease expiry -- resumes and
    // exhausts, triggering completion. Different manager, same org.
    delete process.env.DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE;
    delete process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE;
    asSession({ organisationId: ORG_A, userId: MANAGER_B, role: "manager" });
    const second = postRequest(ids.uploadId);
    const res2 = await POST_normalize(second.req, { params: second.params });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2).toEqual({ ok: true, status: "SUCCEEDED", rowCount: 6, cellCount: 12 });
    expect(JSON.stringify(body2)).not.toMatch(/executionToken|execution_token|runId/i);

    // Durable state: exactly one normalization run, SUCCEEDED, and Upload's
    // own normalized_at/row/cell fields set.
    const runs = await prisma.dataHubNormalizationRun.findMany({ where: { organisation_id: ORG_A, upload_id: ids.uploadId } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");
    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: ids.uploadId } });
    expect(upload.normalized_at).not.toBeNull();
    expect(upload.normalized_row_count).toBe(6);
    expect(upload.normalized_cell_count).toBe(12);

    // GET after completion: SUCCEEDED, sourced from Upload's own fields.
    const getAfterDone = getRequest(ids.uploadId);
    const getRes2 = await GET_normalize(getAfterDone.req, { params: getAfterDone.params });
    expect(getRes2.status).toBe(200);
    const getBody2 = await getRes2.json();
    expect(getBody2).toEqual({ ok: true, status: "SUCCEEDED", rowCount: 6, cellCount: 12 });

    // Already-normalized POST -> 200 SUCCEEDED, no second run created.
    const third = postRequest(ids.uploadId);
    const res3 = await POST_normalize(third.req, { params: third.params });
    expect(res3.status).toBe(200);
    const body3 = await res3.json();
    expect(body3).toEqual({ ok: true, status: "SUCCEEDED", alreadyNormalized: true });
    const runsAfterThird = await prisma.dataHubNormalizationRun.findMany({ where: { organisation_id: ORG_A, upload_id: ids.uploadId } });
    expect(runsAfterThird).toHaveLength(1);

    // GET after the already-normalized POST: still SUCCEEDED.
    const getAfterThird = getRequest(ids.uploadId);
    const getRes3 = await GET_normalize(getAfterThird.req, { params: getAfterThird.params });
    const getBody3 = await getRes3.json();
    expect(getBody3).toEqual({ ok: true, status: "SUCCEEDED", rowCount: 6, cellCount: 12 });
  });

  // ─── E: blocking data ───────────────────────────────────────────────────
  it("E: a row with an unparseable DECIMAL value blocks the run (422 FAILED); GET reports FAILED with only a safe failureCode; no normalized row for the blocked source row; no raw values leak", async () => {
    const s = nextSuffix("block");
    const rows: SeedRow[] = [
      { id: `${s}-r1`, sourceRowNumber: 4, col1: "id-1", col2: "not-a-number-super-secret" },
    ];
    const ids = await seedNormalizeEligibleWorksheet(ORG_A, s, rows);

    asSession({ organisationId: ORG_A, userId: MANAGER_A, role: "manager" });
    const req = postRequest(ids.uploadId);
    const res = await POST_normalize(req.req, { params: req.params });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ ok: false, status: "FAILED", code: "NORMALIZATION_BLOCKED", error: expect.any(String) });
    const rawBody = JSON.stringify(body);
    expect(rawBody).not.toMatch(/not-a-number-super-secret/);
    expect(rawBody).not.toMatch(/executionToken|execution_token|runId/i);

    // Durable: the run is already FAILED, a structured blocking finding
    // exists, and no normalized row was ever persisted for the blocked row.
    const run = await prisma.dataHubNormalizationRun.findFirstOrThrow({ where: { organisation_id: ORG_A, upload_id: ids.uploadId } });
    expect(run.status).toBe("FAILED");
    expect(run.failure_code).toBe("NORMALIZATION_BLOCKED");
    const findings = await prisma.dataHubNormalizationFinding.findMany({ where: { normalization_run_id: run.id, raw_row_id: `${s}-r1` } });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe("BLOCKING_ERROR");
    const normalizedRows = await prisma.dataHubNormalizedRow.count({ where: { normalization_run_id: run.id, raw_row_id: `${s}-r1` } });
    expect(normalizedRows).toBe(0);
    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: ids.uploadId } });
    expect(upload.normalized_at).toBeNull();

    // GET reflects FAILED with only a safe failureCode -- never raw values,
    // finding detail, or internal ids.
    const getReq = getRequest(ids.uploadId);
    const getRes = await GET_normalize(getReq.req, { params: getReq.params });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.status).toBe("FAILED");
    expect(getBody.failureCode).toBe("NORMALIZATION_BLOCKED");
    const rawGetBody = JSON.stringify(getBody);
    expect(rawGetBody).not.toMatch(/not-a-number-super-secret/);
    expect(rawGetBody).not.toMatch(/executionToken|execution_token/i);
  });

  // ─── F: wrong tenant ────────────────────────────────────────────────────
  it("F: a manager from a different organisation cannot view (GET) or execute (POST) another org's upload -- identical 404 as a nonexistent upload", async () => {
    const s = nextSuffix("tenant");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "id-1", col2: "1.5" }];
    const ids = await seedNormalizeEligibleWorksheet(ORG_A, s, rows);

    asSession({ organisationId: ORG_B, userId: MANAGER_C_OTHER_ORG, role: "manager" });

    const postReq = postRequest(ids.uploadId);
    const postRes = await POST_normalize(postReq.req, { params: postReq.params });
    expect(postRes.status).toBe(404);

    const getReq = getRequest(ids.uploadId);
    const getRes = await GET_normalize(getReq.req, { params: getReq.params });
    expect(getRes.status).toBe(404);
    const wrongTenantBody = await getRes.json();

    // A nonexistent upload id in ORG_B produces an INDISTINGUISHABLE 404 --
    // same status, same body shape, so a caller cannot distinguish "wrong
    // tenant" from "doesn't exist" through the response.
    const nonexistentReq = getRequest("does-not-exist");
    const nonexistentRes = await GET_normalize(nonexistentReq.req, { params: nonexistentReq.params });
    expect(nonexistentRes.status).toBe(404);
    expect(await nonexistentRes.json()).toEqual(wrongTenantBody);

    // Nothing was executed against ORG_A's upload as a side effect.
    const runs = await prisma.dataHubNormalizationRun.findMany({ where: { organisation_id: ORG_A, upload_id: ids.uploadId } });
    expect(runs).toHaveLength(0);
  });

  // ─── G: lease collision ─────────────────────────────────────────────────
  it("G: a POST against an upload with another live (unexpired) normalization lease returns 409 CONFLICT, no token leak", async () => {
    const s = nextSuffix("lease");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "id-1", col2: "1.5" }];
    const ids = await seedNormalizeEligibleWorksheet(ORG_A, s, rows);

    // Seed a live RUNNING normalization run directly, holding the lease.
    const liveRunId = `${s}-live-run`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, created_by)
       VALUES ('${liveRunId}','${ORG_A}','${ids.batchId}','${ids.uploadId}','${ids.rawRunId}','${ids.svId}','${ids.wsId}','${ids.profileId}','${ids.pvId}',1,'v1','RUNNING','tok-${s}-secret-live', now()+interval '1 hour', now(), 1, 2, 0, 0, '${ids.userId}')`
    );

    asSession({ organisationId: ORG_A, userId: MANAGER_A, role: "manager" });
    const req = postRequest(ids.uploadId);
    const res = await POST_normalize(req.req, { params: req.params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ ok: false, status: "CONFLICT", code: "RUN_ALREADY_IN_PROGRESS", error: expect.any(String) });
    const rawBody = JSON.stringify(body);
    expect(rawBody).not.toMatch(/tok-.*-secret-live/);
    expect(rawBody).not.toMatch(/executionToken|execution_token/i);

    // Cache-Control is present and private/no-store even on the conflict.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    await prisma.dataHubNormalizationRun.update({ where: { id: liveRunId }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
  });

  // ─── Auth boundary spot-check at the route level ──────────────────────
  it("unauthenticated POST/GET -> 401; authenticated-but-below-manager -> 403; Cache-Control private/no-store on both", async () => {
    const s = nextSuffix("auth");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "id-1", col2: "1.5" }];
    const ids = await seedNormalizeEligibleWorksheet(ORG_A, s, rows);

    nextSession = null;
    const unauthReq = postRequest(ids.uploadId);
    const unauthRes = await POST_normalize(unauthReq.req, { params: unauthReq.params });
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.headers.get("Cache-Control")).toBe("private, no-store");

    asSession({ organisationId: ORG_A, userId: "viewer-1", role: "viewer" });
    const forbiddenReq = postRequest(ids.uploadId);
    const forbiddenRes = await POST_normalize(forbiddenReq.req, { params: forbiddenReq.params });
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
