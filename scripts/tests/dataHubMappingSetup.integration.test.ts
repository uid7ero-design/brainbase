import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import manifest from "@/config/data-hub/onkaparinga-monthly-operations-v1.json";
import { createRunsPilotReview } from "@/lib/data-hub/schemaProfiles/runsPilotReview";

const url = process.env.DATABASE_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname) || process.env.DATAHUB_MAPPING_PROOF !== "1") throw new Error("OWNED_LOCAL_MAPPING_HARNESS_REQUIRED");
const db = new PrismaClient({ datasourceUrl: url });
vi.mock("@/lib/prisma", () => ({ get prisma() { return db; } }));
vi.doMock("@/lib/db", () => ({ default: async (parts: TemplateStringsArray, ...values: unknown[]) => {
  let statement = parts[0]; values.forEach((_, i) => { statement += `$${i + 1}${parts[i + 1]}`; });
  return db.$queryRawUnsafe(statement, ...values);
} }));
let token: string | undefined;
process.env.SESSION_SECRET = "owned-local-mapping-proof-key-only";
vi.doMock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "session" && token ? { value: token } : undefined }) }));
let store: InstanceType<typeof import("@/lib/data-hub/storage/inMemoryFileStore").InMemoryFileStore>;
vi.doMock("@/lib/data-hub/importBatch/compositionRoot", async original => ({
  ...await original<typeof import("@/lib/data-hub/importBatch/compositionRoot")>(), createImportBatchStorage: () => store,
}));
const org = "mapping-proof-org", foreign = "mapping-proof-foreign", source = "mapping-proof-source";
const schema = "dhcfg-onk-mwco-sv1", worksheet = `${schema}-ws-runs`, profile = `${worksheet}-profile`;
let route: typeof import("@/app/api/data-hub/worksheets/[id]/mapping-setup/route");
let first: string, second: string, negative: string;
let savedFingerprint: string;
async function sign(userId = "mapping-admin", organisationId = org) {
  const { SignJWT } = await import("jose");
  token = await new SignJWT({ userId, organisationId, role: "super_admin", name: "Synthetic actor" }).setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
}
async function api(uploadId: string, body?: unknown) {
  const request = new Request(`http://localhost/api/data-hub/worksheets/${uploadId}/mapping-setup`, {
    method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const response = body === undefined ? await route.GET(request, { params: Promise.resolve({ id: uploadId }) }) :
    await route.POST(request, { params: Promise.resolve({ id: uploadId }) });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return { status: response.status, data: await response.json() };
}
function complete() {
  const review = createRunsPilotReview(); review.missingPolicy = "NULL_ONLY";
  review.fields.forEach((field, i) => { field.confirmed = true; field.unit ??= i === 12 ? "kg" : "km";
    if (field.representation === "WHOLE_NUMBER") field.negativePolicy = "FORBID"; });
  return review;
}
async function workbook(suffix: string, negativeCount = false) {
  const wb = XLSX.utils.book_new();
  for (const sheet of manifest.worksheets) {
    const rows: unknown[][] = [["Synthetic operational report"], [], sheet.columns.map(c => c.header)];
    if (sheet.logicalKey === "runs") rows.push(
      ["0001", "2026-10-01", "007", "TRUCK-A", "Synthetic collection", "Synthetic driver", negativeCount ? -1 : 0, 2, null, null, 0, 1.25, 8, 10, 0.5, 1.5, 2, 0.5, 10, 12, 22],
      ["0002", "2026-10-02", "008", "TRUCK-B", "Synthetic collection", "Synthetic driver", 1, 3, 0, null, 0, 0, 0, 12, 0, 2, 3, 1, 8, 11, 19]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet.name);
  }
  const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const batchId = `mapping-batch-${suffix}`;
  const { buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore");

  await store.put(buildImportBatchKey(org, batchId), bytes);
  await db.importBatch.create({ data: { id: batchId, organisation_id: org, source_system_id: source,
    original_filename: `synthetic-${suffix}.xlsx`, content_type: "xlsx", size_bytes: bytes.length, storage_provider: "memory",
    status: "READY", storage_key: buildImportBatchKey(org, batchId), sha256: createHash("sha256").update(bytes).digest("hex"), uploaded_by: "mapping-admin" } });
  const inspected = await (await import("@/lib/data-hub/importBatch/inspectImportBatch")).inspectImportBatch({ organisationId: org, importBatchId: batchId });
  expect(inspected.ok).toBe(true);
  // Real fixed-pilot schema matcher/selector; no setup-only schema lineage injection.
  const selected = await (await import("@/lib/data-hub/schemaMatch/establishImportBatchSchemaLineage")).establishImportBatchSchemaLineage({ organisationId: org, importBatchId: batchId, actorUserId: "mapping-admin" });
  expect(selected).toMatchObject({ ok: true, sourceSchemaVersionId: schema });
  return (await db.upload.findFirstOrThrow({ where: { import_batch_id: batchId, worksheet_name: "Runs", organisation_id: org } })).id;
}
beforeAll(async () => {
  const { InMemoryFileStore } = await import("@/lib/data-hub/storage/inMemoryFileStore"); store = new InMemoryFileStore();
  for (const id of [org, foreign]) await db.organisation.create({ data: { id, name: "Synthetic mapping proof", slug: id } });
  for (const [id, role, organisation_id] of [["mapping-admin", "ADMIN", org], ["mapping-manager", "MANAGER", org], ["mapping-viewer", "VIEWER", org], ["mapping-foreign", "ADMIN", foreign]] as const)
    await db.user.create({ data: { id, name: "Synthetic actor", username: id, password_hash: "not-a-login-credential", organisation_id, role, status: "ACTIVE" } });
  await db.sourceSystem.create({ data: { id: source, organisation_id: org, name: manifest.sourceSystemName } });
  await db.datasetType.create({ data: { id: "dhcfg-onk-mwco-dt", organisation_id: org, source_system_id: source, name: manifest.datasetType.name } });
  await db.sourceSchemaVersion.create({ data: { id: schema, organisation_id: org, dataset_type_id: "dhcfg-onk-mwco-dt", version_number: 1, label: manifest.schemaVersion.label, status: "DRAFT" } });
  for (const sheet of manifest.worksheets) {
    const ws = `${schema}-ws-${sheet.logicalKey}`, p = `${ws}-profile`, v = `${p}-v1`;
    await db.sourceSchemaWorksheet.create({ data: { id: ws, organisation_id: org, source_schema_version_id: schema, logical_key: sheet.logicalKey, expected_name: sheet.name, ordinal_hint: sheet.ordinal, presence: "OPTIONAL", role: sheet.role } });
    await db.sourceSchemaColumn.createMany({ data: sheet.columns.map((c, ordinal) => ({ id: `${ws}-c${String(ordinal).padStart(3, "0")}`, organisation_id: org,
      source_schema_worksheet_id: ws, ordinal, source_header: c.header, presence: "OPTIONAL", declared_type: "UNKNOWN", sensitivity_class: c.sensitivityClass })) });
    await db.worksheetMappingProfile.create({ data: { id: p, organisation_id: org, source_schema_worksheet_id: ws, name: manifest.mappingProfile.name, active: false } });
    await db.worksheetMappingProfileVersion.create({ data: { id: v, organisation_id: org, worksheet_mapping_profile_id: p, version_number: 1,
      disposition: sheet.disposition, profile_document: { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: sheet.headerRowOneBased } } });
  }
  await db.sourceSchemaVersion.update({ where: { id: schema }, data: { status: "ACTIVE", activated_at: new Date() } });
  for (const sheet of manifest.worksheets) { const p = `${schema}-ws-${sheet.logicalKey}-profile`;
    await db.worksheetMappingProfile.update({ where: { id: p }, data: { active: true, active_profile_version_id: `${p}-v1` } }); }
  route = await import("@/app/api/data-hub/worksheets/[id]/mapping-setup/route"); await sign();
  first = await workbook("first"); second = await workbook("second"); negative = await workbook("negative", true);
}, 60000);
afterAll(async () => { await db.$disconnect(); });

describe.sequential("saved Runs mappings and first-use confirmation with real Postgres", () => {
  it("rejects foreign origins, unexpected queries and oversized or non-JSON bodies", async () => {
    await sign();
    for (const [query, headers, body, expected] of [
      ["", { "Content-Type": "application/json", Origin: "https://foreign.invalid" }, "{}", 403],
      ["?profileId=caller", { "Content-Type": "application/json" }, "{}", 400],
      ["", { "Content-Type": "text/plain" }, "{}", 400],
      ["", { "Content-Type": "application/json" }, "x".repeat(32769), 400],
      ["", { "Content-Type": "application/json" }, "{", 400],
    ] as const) {
      const response = await route.POST(new Request(`http://localhost/api/data-hub/worksheets/${first}/mapping-setup${query}`,
        { method: "POST", headers, body }), { params: Promise.resolve({ id: first }) });
      expect(response.status).toBe(expected);
    }
    // Framework-normalized request URL must still accept the actual browser Host.
    const response = await route.POST(new Request(`http://localhost:3000/api/data-hub/worksheets/${first}/mapping-setup`,
      { method: "POST", headers: { "Content-Type": "application/json", Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" }, body: "{}" }),
      { params: Promise.resolve({ id: first }) });
    expect(response.status).toBe(400); // closed body validation, not origin denial
  });
  it("fails closed without a session, for viewers, and for a foreign tenant", async () => {
    token = undefined; expect((await api(first)).status).toBe(401);
    await sign("mapping-viewer"); expect((await api(first)).status).toBe(403);
    await sign("mapping-foreign", foreign); expect((await api(first)).status).toBe(404); await sign();
  });
  it("requires all 21 confirmations, admin authority and a current fingerprint", async () => {
    const current = await api(first); expect(current.data).toMatchObject({ saved: false, confirmed: false, version: 1 });
    expect((await api(first, { action: "SAVE", fingerprint: current.data.fingerprint, review: createRunsPilotReview() })).status).toBe(400);
    expect((await api(first, { action: "SAVE", fingerprint: "0".repeat(64), review: complete() })).status).toBe(409);
    await sign("mapping-manager"); expect((await api(first, { action: "SAVE", fingerprint: current.data.fingerprint, review: complete() })).status).toBe(403); await sign();
  });
  it("blocks source staging before a reviewed mapping and workbook confirmation exist", async () => {
    const gate = await (await import("@/lib/data-hub/staging/eligibility")).resolveStagingEligibility({ organisationId: org, uploadId: first });
    expect(gate).toEqual({ ok: false, code: "MAPPING_CONFIRMATION_REQUIRED" });
  });
  it("atomically saves v2, retains v1, records the real actor and rejects stale replay", async () => {
    const current = await api(first), saved = await api(first, { action: "SAVE", fingerprint: current.data.fingerprint, review: complete() });
    expect(saved.status).toBe(200); expect(saved.data).toMatchObject({ saved: true, confirmed: false, version: 2 }); savedFingerprint = saved.data.fingerprint;
    expect((await api(first, { action: "SAVE", fingerprint: current.data.fingerprint, review: complete() })).status).toBe(409);
    expect(await db.worksheetMappingProfileVersion.count({ where: { worksheet_mapping_profile_id: profile } })).toBe(2);
    expect((await db.worksheetMappingProfileVersion.findFirstOrThrow({ where: { worksheet_mapping_profile_id: profile, version_number: 1 } })).profile_document).toMatchObject({ documentVersion: 1 });
    expect(await db.$queryRaw`SELECT approved_by FROM data_hub_mapping_approvals`).toEqual([{ approved_by: "mapping-admin" }]);
  });
  it("reuses the saved mapping for later workbooks without confirming them automatically", async () => {
    expect((await api(second)).data).toMatchObject({ saved: true, confirmed: false, version: 2 });
    await sign("mapping-manager");
    expect((await api(first, { action: "CONFIRM", fingerprint: savedFingerprint })).data.confirmed).toBe(true);
    expect((await api(first, { action: "CONFIRM", fingerprint: savedFingerprint })).data.confirmed).toBe(true);
    expect((await api(second)).data.confirmed).toBe(false);
    expect(await db.$queryRaw`SELECT count(*)::int AS count FROM data_hub_mapping_use_confirmations`).toEqual([{ count: 1 }]); await sign();
  });
  it("enforces immutable approval and confirmation evidence at the database boundary", async () => {
    await expect(db.$executeRaw`UPDATE data_hub_mapping_approvals SET approved_by='mapping-manager'`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM data_hub_mapping_use_confirmations`).rejects.toThrow();
    await expect(db.worksheetMappingProfileVersion.updateMany({ where: { worksheet_mapping_profile_id: profile, version_number: 1 }, data: { profile_document: {} } })).rejects.toThrow();
  });
  it("stages, normalizes and profiles all 21 fields through actual services, preserving units, zero, null and leading zeros", async () => {
    const { POST } = await import("@/app/api/data-hub/worksheets/[id]/stage/route");
    expect((await POST(new Request("http://localhost/stage") as never, { params: Promise.resolve({ id: first }) })).status).toBe(200);
    const normalize = await import("@/app/api/data-hub/worksheets/[id]/normalize/route");
    expect((await normalize.POST(new Request("http://localhost/normalize") as never, { params: Promise.resolve({ id: first }) })).status).toBe(200);
    const { profileUploadDataset } = await import("@/lib/data-hub/profileExecution/profileUploadDataset");
    expect(await profileUploadDataset({ organisationId: org, uploadId: first, actorId: "mapping-admin" })).toMatchObject({ ok: true });
    const cells = await db.dataHubNormalizedCell.findMany({ where: { organisation_id: org, normalized_row: { normalization_run: { upload_id: first } } }, orderBy: [{ normalized_row: { source_row_number: "asc" } }, { source_schema_column_id: "asc" }] });
    expect(cells).toHaveLength(42); expect(cells[0].normalized_value).toBe("0001");
    expect(cells[6].normalized_value).toBe("0"); expect(cells[8].normalized_value).toBeNull();
    expect(cells[13].normalized_unit).toBe("bins/h"); expect(cells[14].normalized_unit).toBe("t/h");
    expect(cells[17]).toMatchObject({ normalized_value: "0.5", normalized_unit: "d" });
    expect((await api(first)).data.kind).toBe("PINNED");
    expect((await api(first, { action: "SAVE", fingerprint: savedFingerprint, review: complete() })).status).toBe(409);
  });
  it("keeps negative-count violations blocking and stores the new finding code", async () => {
    const current = await api(negative); await api(negative, { action: "CONFIRM", fingerprint: current.data.fingerprint });
    const stage = await import("@/app/api/data-hub/worksheets/[id]/stage/route");
    expect((await stage.POST(new Request("http://localhost/stage") as never, { params: Promise.resolve({ id: negative }) })).status).toBe(200);
    const normalize = await import("@/app/api/data-hub/worksheets/[id]/normalize/route");
    expect((await normalize.POST(new Request("http://localhost/normalize") as never, { params: Promise.resolve({ id: negative }) })).status).toBe(422);
    expect(await db.$queryRaw`SELECT finding_code FROM data_hub_normalization_findings WHERE organisation_id=${org}`).toContainEqual({ finding_code: "NUMERIC_VALUE_BELOW_MINIMUM" });
  });
  it("reviews held/corrected quality, counts zero separately from null and retains both revisions", async () => {
    const upload = await db.upload.findUniqueOrThrow({ where: { id: first } });
    const plan = await import("@/app/api/data-hub/worksheets/[id]/analysis-review/plan/route");
    const review = await import("@/app/api/data-hub/worksheets/[id]/analysis-review/route");
    const count = await import("@/app/api/data-hub/worksheets/[id]/analysis-count/route");
    const history = await import("@/app/api/data-hub/worksheets/[id]/analysis-review/history/route");
    const ctx = { params: Promise.resolve({ id: first }) };
    const post = (body: unknown) => new Request("http://localhost/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const initial = await plan.GET(new Request("http://localhost/plan"), ctx); expect(initial.status).toBe(200);
    const clarification = (await initial.json()).clarification.columns as { sourceSchemaColumnId: string; resolutionState: string; candidateRoles: string[] }[];
    const semanticChoices = clarification.filter(c => c.resolutionState === "CLARIFICATION_REQUIRED").map(c => ({
      sourceSchemaColumnId: c.sourceSchemaColumnId, role: c.sourceSchemaColumnId.endsWith("c000") && c.candidateRoles.includes("RECORD_KEY") ? "RECORD_KEY" :
        c.candidateRoles.includes("MEASURE") ? "MEASURE" : c.candidateRoles[0] }));
    const input = { reviewVersion: "v1", datasetProfileRunId: upload.dataset_profile_run_id, semanticChoices, qualityDecisions: [] as unknown[] };
    const planned = await plan.POST(post(input), ctx); const preview = await planned.json(); expect(planned.status, JSON.stringify(preview)).toBe(200);
    expect(preview.quality.items.some((item: { code: string }) => item.code === "COLUMN_ALL_NULL")).toBe(true);
    for (const hold of [true, false]) {
      input.qualityDecisions = preview.quality.items.map((item: { code: string; scope: string; sourceSchemaColumnId?: string; action: string }) => ({
        code: item.code, scope: item.scope, ...(item.sourceSchemaColumnId ? { sourceSchemaColumnId: item.sourceSchemaColumnId } : {}),
        decision: item.action === "ACKNOWLEDGE_NOTICE" ? "ACKNOWLEDGE" : hold ? "HOLD" : "CONTINUE" }));
      expect((await review.POST(post(input), ctx)).status).toBe(201);
      const result = await count.POST(post({ requestVersion: "v1", kind: "AGGREGATE", operator: "COUNT_PRESENT", sourceSchemaColumnId: `${worksheet}-c008` }), ctx);
      expect(result.status).toBe(hold ? 422 : 200);
      if (!hold) expect(await result.json()).toMatchObject({ ok: true, reviewRevision: 2, result: { count: 1 } });
    }
    const query = new URLSearchParams({ historyVersion: "v1", datasetProfileRunId: upload.dataset_profile_run_id!, expectedReviewRevision: "2" });
    expect((await history.GET(new Request(`http://localhost/history?${query}`), ctx)).status).toBe(200);
    expect(await db.dataHubAnalysisReview.count({ where: { upload_id: first, organisation_id: org } })).toBe(2);
  });
  it("the SQL gate also rejects a direct run insert for an unconfirmed workbook", async () => {
    const upload = await db.upload.findUniqueOrThrow({ where: { id: second } });
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: upload.import_batch_id! } });
    const active = await db.worksheetMappingProfile.findUniqueOrThrow({ where: { id: profile } });
    await expect(db.$executeRaw`INSERT INTO data_hub_raw_staging_runs
      (id,organisation_id,import_batch_id,upload_id,source_schema_version_id,source_schema_worksheet_id,worksheet_mapping_profile_id,
       worksheet_mapping_profile_version_id,attempt_number,source_sha256,parser_version,status,execution_token,lease_expires_at,last_progress_at,created_by)
      VALUES('mapping-unconfirmed-run',${org},${batch.id},${second},${schema},${worksheet},${profile},${active.active_profile_version_id},1,
        ${batch.sha256},'6.2D4B-1','RUNNING','local-test-token',now()+interval '1 minute',now(),'mapping-admin')`).rejects.toThrow(/MAPPING_CONFIRMATION_REQUIRED/);
  });
  it("serializes concurrent edits, invalidates first-use confirmation and preserves historical pins", async () => {
    const current = await api(second), review = complete(); review.fields[11].unit = "kg";
    const before = await db.upload.findUniqueOrThrow({ where: { id: first } });
    const attempts = await Promise.all([api(second, { action: "SAVE", fingerprint: current.data.fingerprint, review }),
      api(second, { action: "SAVE", fingerprint: current.data.fingerprint, review })]);
    expect(attempts.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await api(second)).data).toMatchObject({ version: 3, saved: true, confirmed: false });
    expect((await db.upload.findUniqueOrThrow({ where: { id: first } })).raw_profile_version_id).toBe(before.raw_profile_version_id);
    expect(await db.worksheetMappingProfileVersion.count({ where: { worksheet_mapping_profile_id: profile } })).toBe(3);
    const old = await db.$queryRaw`SELECT profile_version_id FROM data_hub_mapping_use_confirmations WHERE upload_id=${first}`;
    expect(old).toEqual([{ profile_version_id: before.raw_profile_version_id }]);
  });
  it.runIf(process.env.DATAHUB_MAPPING_BROWSER_PROOF === "1")("saves and confirms through the built authenticated browser", async () => {
    const { randomBytes } = await import("node:crypto"), { hash } = await import("bcryptjs"), { spawn } = await import("node:child_process");
    const uploadId = await workbook("browser"), password = randomBytes(24).toString("hex");
    await db.user.update({ where: { id: "mapping-admin" }, data: { password_hash: await hash(password, 4) } });
    const child = spawn(process.execPath, ["scripts/tests/verify-datahub-mapping-browser.mjs"], { windowsHide: true, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    child.stdin.end(JSON.stringify({ uploadId, username: "mapping-admin", password }));
    const code = await new Promise(resolve => { child.on("exit", resolve); child.on("error", () => resolve(1)); });
    expect(code, output).toBe(0);
  }, 180000);
});
