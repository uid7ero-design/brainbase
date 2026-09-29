import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Data Hub 6.2D4B2A -- real disposable-Postgres proof for the resumable
// normalization executor service (createOrResumeNormalizationRun,
// normalizeBatches, completeNormalizationRun). Exact structural analogue of
// scripts/tests/purchaseReceiptConcurrency.integration.test.ts /
// scripts/tests/organiserConfirmationReplay.integration.test.ts's own
// established "no route, no auth seam, only the lib/db sql-client seam"
// pattern -- this service takes already-trusted {organisationId, uploadId,
// actorUserId} directly, exactly like D4B's own createOrResumeStagingRun.
//
// WHY REAL POSTGRES: lease takeover, cross-request lease-expiry races, and
// B2B1's own atomic batch/completion functions are enforced by real
// Postgres row locking and transaction semantics -- a mocked sql client
// can simulate the RESULT of a race but cannot prove the race itself is
// actually safe.
//
// Run ONLY via scripts/tests/verify-datahub-normalization-executor.sh,
// which creates the disposable postgres:16-alpine container, applies the
// real D4A -> D4B -> D4C-B1 -> D4C-B2B1 migration chain (unmodified), and
// exports DATABASE_URL before this file is ever imported.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("dataHubNormalizationExecutor.integration.test.ts requires DATABASE_URL to point at a disposable Postgres container (see scripts/tests/verify-datahub-normalization-executor.sh). Refusing to run without it.");
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error("Refusing to run against a DATABASE_URL that looks like a real hosted/Production database. This suite may ONLY run against a local disposable Docker container.");
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

let createOrResumeNormalizationRun: typeof import("@/lib/data-hub/normalization/dataHubNormalizationRun").createOrResumeNormalizationRun;
let markNormalizationRunFailed: typeof import("@/lib/data-hub/normalization/dataHubNormalizationRun").markNormalizationRunFailed;
let normalizeBatches: typeof import("@/lib/data-hub/normalization/normalizeWorksheetRows").normalizeBatches;
let completeNormalizationRun: typeof import("@/lib/data-hub/normalization/completeNormalizationRun").completeNormalizationRun;

const ORG = "org-a";
let batchSeq = 0;
// Process-run salt: the harness re-runs this same file's suite twice
// against the SAME persistent disposable-Postgres database (once before,
// once after its mutation-proof phase) without resetting it -- this salt
// keeps every seeded id unique across separate process invocations, since
// batchSeq itself always restarts at 0 in a fresh process.
const RUN_SALT = Date.now().toString(36).slice(-6);

beforeAll(async () => {
  ({ createOrResumeNormalizationRun, markNormalizationRunFailed } = await import("@/lib/data-hub/normalization/dataHubNormalizationRun"));
  ({ normalizeBatches } = await import("@/lib/data-hub/normalization/normalizeWorksheetRows"));
  ({ completeNormalizationRun } = await import("@/lib/data-hub/normalization/completeNormalizationRun"));

  await prisma.$executeRawUnsafe(`INSERT INTO organisations (id, name, slug, updated_at) VALUES ('${ORG}', 'Org A', '${ORG}', now()) ON CONFLICT (id) DO NOTHING`);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Fixture builder ────────────────────────────────────────────────────
// Builds one fresh, isolated world per call: a user, a governed worksheet
// with two columns (col-1 IDENTIFIER, col-2 DECIMAL), an import batch +
// upload, and (unless overridden) a SUCCEEDED raw staging run with the
// requested rows already staged, with Upload's own raw-staging completion
// metadata set. Returns every id the tests need.

interface SeedOptions {
  rows: { id: string; sourceRowNumber: number; col1: string; col2: string | null }[];
  profileDocumentVersion?: 1 | 2;
  malformedProfile?: boolean;
  foreignRule?: boolean;
  missingRule?: boolean;
  skipRawRun?: boolean;
}

async function seedWorld(suffix: string, opts: SeedOptions) {
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

  await prisma.$executeRawUnsafe(`INSERT INTO users (id, organisation_id, username, email, name, password_hash, role, updated_at) VALUES ('${userId}','${ORG}','${userId}','${userId}@x.com','User ${suffix}','x','MANAGER', now()) ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_systems (id, organisation_id, name, updated_at) VALUES ('ss-${suffix}','${ORG}','SS ${suffix}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO dataset_types (id, organisation_id, source_system_id, name, updated_at) VALUES ('dt-${suffix}','${ORG}','ss-${suffix}','DT ${suffix}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('${svId}','${ORG}','dt-${suffix}',1,'v1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role, ordinal_hint) VALUES ('${wsId}','${ORG}','${svId}','runs','Runs','OPTIONAL','DATA',0)`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class) VALUES ('${col1}','${ORG}','${wsId}',0,'Id','OPTIONAL','UNKNOWN','CONFIDENTIAL'),('${col2}','${ORG}','${wsId}',1,'Weight','OPTIONAL','UNKNOWN','CONFIDENTIAL')`);
  await prisma.$executeRawUnsafe(`INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name, active, updated_at) VALUES ('${profileId}','${ORG}','${wsId}','treatment-${suffix}', true, now())`);

  const documentVersion = opts.profileDocumentVersion ?? 2;
  let profileDocument: string;
  if (documentVersion === 1) {
    profileDocument = JSON.stringify({ documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 3 });
  } else if (opts.malformedProfile) {
    profileDocument = JSON.stringify({ documentVersion: 2, schemaStatus: "DRAFT", headerRowOneBased: 3, columnRules: "not-an-array" });
  } else if (opts.missingRule) {
    // Only rules col1 -- col2 is governed but has no rule.
    profileDocument = JSON.stringify({
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [{ sourceSchemaColumnId: col1, valueKind: "IDENTIFIER", preserveLeadingZeros: true }],
    });
  } else if (opts.foreignRule) {
    profileDocument = JSON.stringify({
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [
        { sourceSchemaColumnId: col1, valueKind: "IDENTIFIER", preserveLeadingZeros: true },
        { sourceSchemaColumnId: col2, valueKind: "DECIMAL" },
        { sourceSchemaColumnId: "col-does-not-exist", valueKind: "STRING" },
      ],
    });
  } else {
    profileDocument = JSON.stringify({
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [
        { sourceSchemaColumnId: col1, valueKind: "IDENTIFIER", preserveLeadingZeros: true },
        { sourceSchemaColumnId: col2, valueKind: "DECIMAL" },
      ],
    });
  }

  await prisma.$executeRawUnsafe(`INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('${pvId}','${ORG}','${profileId}',1,'STAGING_DATASET','${profileDocument.replace(/'/g, "''")}')`);
  await prisma.$executeRawUnsafe(`UPDATE worksheet_mapping_profiles SET active_profile_version_id='${pvId}' WHERE id='${profileId}'`);

  const sha = suffix.padEnd(64, "0").slice(0, 64);
  await prisma.$executeRawUnsafe(`INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256, source_schema_version_id, updated_at) VALUES ('${batchId}','${ORG}','${userId}','f.xlsx','xlsx',1,'vercel-blob','k-${suffix}','READY', '${sha}', '${svId}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, worksheet_name, lineage_kind, updated_at) VALUES ('${uploadId}','${ORG}','f.xlsx','p','x',1,'${batchId}',0,'Runs','DATA_HUB', now())`);

  const ids = { userId, wsId, svId, col1, col2, profileId, pvId, batchId, uploadId, rawRunId };

  if (opts.skipRawRun) return ids;

  const rowCount = opts.rows.length;
  const cellCount = rowCount * 2;
  await prisma.$executeRawUnsafe(
    `INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('${rawRunId}','${ORG}','${batchId}','${uploadId}','${svId}','${wsId}','${profileId}','${pvId}',1,'${sha}','v1','SUCCEEDED','tok-${suffix}', now()+interval '1 hour', now(), ${rowCount}, ${cellCount}, ${rowCount}, ${cellCount}, now())`
  );
  await prisma.$executeRawUnsafe(`UPDATE uploads SET raw_staged_at=now(), raw_staged_by='${userId}', raw_profile_version_id='${pvId}', raw_row_count=${rowCount}, raw_cell_count=${cellCount}, raw_staging_run_id='${rawRunId}' WHERE id='${uploadId}'`);

  for (const row of opts.rows) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_raw_rows (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, staging_run_id, source_row_number)
       VALUES ('${row.id}','${ORG}','${batchId}','${uploadId}','${svId}','${wsId}','${profileId}','${pvId}','${rawRunId}',${row.sourceRowNumber})`
    );
    const col2Value = row.col2 === null ? "null" : JSON.stringify(row.col2);
    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_raw_cells (id, organisation_id, raw_row_id, source_schema_worksheet_id, source_schema_column_id, column_ordinal, source_header, raw_value, raw_value_type, sensitivity_class, original_unit)
       VALUES ('${row.id}-c1','${ORG}','${row.id}','${wsId}','${col1}',0,'Id','${JSON.stringify(row.col1)}','STRING','CONFIDENTIAL', NULL),
              ('${row.id}-c2','${ORG}','${row.id}','${wsId}','${col2}',1,'Weight','${col2Value}',${row.col2 === null ? "'NULL'" : "'STRING'"},'CONFIDENTIAL', NULL)`
    );
  }

  return ids;
}

function nextSuffix(prefix: string): string {
  batchSeq += 1;
  return `${prefix}${RUN_SALT}${batchSeq}`;
}

// ═══════════════════════════════════════════════════════════════════════
// CREATE / RESUME + PINNING
// ═══════════════════════════════════════════════════════════════════════

describe("create/resume: new-run eligibility", () => {
  it("creates a RUNNING run pinned to the exact raw run's lineage IDs", async () => {
    const s = nextSuffix("elig");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "12.5" }] });
    const result = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(result.ok).toBe(true);
    if (!result.ok || result.alreadyNormalized) throw new Error("expected a fresh run");
    expect(result.run.rawStagingRunId).toBe(ids.rawRunId);
    expect(result.run.worksheetMappingProfileVersionId).toBe(ids.pvId);
    expect(result.run.expectedRowCount).toBe(1);
    expect(result.run.expectedCellCount).toBe(2);
    expect(result.run.normalizerVersion).toBe("v1");
  });

  it("RAW_STAGING_NOT_COMPLETE when the upload has no raw_staging_run_id yet", async () => {
    const s = nextSuffix("nostage");
    const ids = await seedWorld(s, { rows: [], skipRawRun: true });
    const result = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(result).toEqual({ ok: false, code: "RAW_STAGING_NOT_COMPLETE" });
  });

  it("alreadyNormalized short-circuit when Upload.normalized_at is already set -- creates no SECOND run", async () => {
    const s = nextSuffix("done");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1.5" }] });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    await normalizeBatches(created.run, 5000);
    const completion = await completeNormalizationRun({ organisationId: ORG, runId: created.run.id, executionToken: created.run.executionToken, completedByUserId: ids.userId });
    expect(completion.ok).toBe(true);

    const result = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(result).toEqual({ ok: true, alreadyNormalized: true });
    const count = await prisma.dataHubNormalizationRun.count({ where: { upload_id: ids.uploadId } });
    expect(count).toBe(1); // only the one real run created by createOrResumeNormalizationRun
  });
});

describe("pinning: profile eligibility gates", () => {
  it("a pinned v1 profile is rejected as NORMALIZATION_INELIGIBLE", async () => {
    const s = nextSuffix("v1prof");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1" }], profileDocumentVersion: 1 });
    const result = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(result).toEqual({ ok: false, code: "NORMALIZATION_INELIGIBLE" });
  });

  it("a malformed v2 profile document is rejected as PROFILE_DOCUMENT_INVALID", async () => {
    const s = nextSuffix("malform");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1" }], malformedProfile: true });
    const result = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(result).toEqual({ ok: false, code: "PROFILE_DOCUMENT_INVALID" });
  });

  it("a missing governed rule is rejected as NORMALIZATION_PLAN_INVALID", async () => {
    const s = nextSuffix("missrule");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1" }], missingRule: true });
    const result = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(result).toEqual({ ok: false, code: "NORMALIZATION_PLAN_INVALID" });
  });

  it("a foreign (unknown-column) rule is rejected as NORMALIZATION_PLAN_INVALID", async () => {
    const s = nextSuffix("foreign");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1" }], foreignRule: true });
    const result = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(result).toEqual({ ok: false, code: "NORMALIZATION_PLAN_INVALID" });
  });
});

describe("pinning: active-pointer immunity across resume", () => {
  it("moving the active profile version AFTER run creation does not alter resume's execution context", async () => {
    const s = nextSuffix("pin");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "12.5" }] });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    const originalPinnedVersion = created.run.worksheetMappingProfileVersionId;

    // Create a SECOND, DIFFERENT profile version and move the active
    // pointer to it -- simulating an operator editing the mapping while
    // this run is in flight.
    const newPvId = `${ids.pvId}-v2`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('${newPvId}','${ORG}','${ids.profileId}',2,'STAGING_DATASET','${JSON.stringify({ documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 3 }).replace(/'/g, "''")}')`
    );
    await prisma.$executeRawUnsafe(`UPDATE worksheet_mapping_profiles SET active_profile_version_id='${newPvId}' WHERE id='${ids.profileId}'`);

    // Force the lease expired so a resume can take over.
    await prisma.$executeRawUnsafe(`UPDATE data_hub_normalization_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = '${created.run.id}'`);

    const resumed = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.alreadyNormalized) throw new Error("expected a resumed run");
    // Still pinned to the ORIGINAL version, not the new "active" v1 one
    // (which would have made the plan NORMALIZATION_INELIGIBLE if it had
    // been consulted).
    expect(resumed.run.worksheetMappingProfileVersionId).toBe(originalPinnedVersion);
    expect(resumed.run.worksheetMappingProfileVersionId).not.toBe(newPvId);
  });

  it("resume rejects when the run's OWN pinned version has since become malformed, even though a DIFFERENT version is now active", async () => {
    const s = nextSuffix("pinbad");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "12.5" }] });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");

    // Corrupt the run's OWN pinned version document directly (immutability
    // is a D3E policy, not a DB constraint this test needs to respect).
    await prisma.$executeRawUnsafe(`UPDATE worksheet_mapping_profile_versions SET profile_document = '{"documentVersion":2,"schemaStatus":"DRAFT","headerRowOneBased":3,"columnRules":"not-an-array"}' WHERE id = '${ids.pvId}'`);
    await prisma.$executeRawUnsafe(`UPDATE data_hub_normalization_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = '${created.run.id}'`);

    const resumed = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(resumed).toEqual({ ok: false, code: "PROFILE_DOCUMENT_INVALID" });
  });

  it("resume rejects when the pinned raw run is no longer SUCCEEDED", async () => {
    const s = nextSuffix("rawgone");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "12.5" }] });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");

    await prisma.$executeRawUnsafe(`ALTER TABLE data_hub_raw_staging_runs DISABLE TRIGGER data_hub_raw_staging_runs_lifecycle_guard`);
    await prisma.$executeRawUnsafe(`UPDATE data_hub_raw_staging_runs SET status='FAILED', failed_at=now(), failure_code='X', completed_at=NULL WHERE id='${ids.rawRunId}'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE data_hub_raw_staging_runs ENABLE TRIGGER data_hub_raw_staging_runs_lifecycle_guard`);
    await prisma.$executeRawUnsafe(`UPDATE data_hub_normalization_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = '${created.run.id}'`);

    const resumed = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(resumed).toEqual({ ok: false, code: "RAW_RUN_NOT_SUCCEEDED" });
  });

  it("resume rejects an unsupported normalizer_version", async () => {
    const s = nextSuffix("verbad");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "12.5" }] });
    // normalizer_version is an immutable identity/pin column (the DB
    // lifecycle trigger rejects any UPDATE to it) -- so an "old version"
    // run is seeded directly with a RUNNING+expired lease, bypassing the
    // service's own create path, exactly as a run created by a PRIOR
    // deployment of this code (before a hypothetical v2 normalizer
    // shipped) would durably look today.
    const runId = `${s}-oldrun`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, created_by)
       VALUES ('${runId}','${ORG}','${ids.batchId}','${ids.uploadId}','${ids.rawRunId}','${ids.svId}','${ids.wsId}','${ids.profileId}','${ids.pvId}',1,'v999','RUNNING','tok-old-${s}', now() - interval '1 minute', now(), 1, 2, 0, 0, '${ids.userId}')`
    );
    const resumed = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(resumed).toEqual({ ok: false, code: "NORMALIZER_VERSION_UNSUPPORTED" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CONCURRENCY
// ═══════════════════════════════════════════════════════════════════════

describe("concurrency: lease takeover races", () => {
  it("two simultaneous new-run creators: exactly one wins, no duplicate RUNNING run", async () => {
    const s = nextSuffix("race");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1" }] });
    const [a, b] = await Promise.all([createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId }), createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId })]);
    const outcomes = [a, b];
    const succeeded = outcomes.filter((r) => r.ok && !r.alreadyNormalized);
    // DB-level one-RUNNING-per-upload partial unique index means at most
    // one create() can win; the other's create() throws (unique violation)
    // -- both branches count as "the loser" here, so we only assert AT
    // MOST one logical run exists, and exactly one successful creation
    // took the RUNNING slot.
    const runningCount = await prisma.dataHubNormalizationRun.count({ where: { upload_id: ids.uploadId, status: "RUNNING" } });
    expect(runningCount).toBe(1);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
  });

  it("a live (unexpired) lease prevents takeover -- RUN_ALREADY_IN_PROGRESS", async () => {
    const s = nextSuffix("live");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1" }] });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    const second = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(second).toEqual({ ok: false, code: "RUN_ALREADY_IN_PROGRESS" });
  });

  it("an expired lease allows takeover with a fresh token", async () => {
    const s = nextSuffix("expired");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1" }] });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    await prisma.$executeRawUnsafe(`UPDATE data_hub_normalization_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = '${created.run.id}'`);
    const resumed = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.alreadyNormalized) throw new Error("expected a resumed run");
    expect(resumed.run.id).toBe(created.run.id);
    expect(resumed.run.executionToken).not.toBe(created.run.executionToken);
  });

  it("the OLD token cannot persist a batch after takeover -- LEASE_LOST", async () => {
    const s = nextSuffix("oldpersist");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "12.5" }] });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    await prisma.$executeRawUnsafe(`UPDATE data_hub_normalization_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = '${created.run.id}'`);
    await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId }); // takeover

    const staleResult = await normalizeBatches(created.run, 5000);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.code).toBe("LEASE_LOST");
  });

  it("the OLD token cannot fail the run after takeover", async () => {
    const s = nextSuffix("oldfail");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "12.5" }] });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    await prisma.$executeRawUnsafe(`UPDATE data_hub_normalization_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = '${created.run.id}'`);
    await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });

    const applied = await markNormalizationRunFailed({ organisationId: ORG, runId: created.run.id, executionToken: created.run.executionToken, failureCode: "X" });
    expect(applied).toBe(false);
  });

  it("the OLD token cannot complete the run after takeover", async () => {
    const s = nextSuffix("oldcomplete");
    const ids = await seedWorld(s, { rows: [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "12.5" }] });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    await prisma.$executeRawUnsafe(`UPDATE data_hub_normalization_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = '${created.run.id}'`);
    await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });

    const result = await completeNormalizationRun({ organisationId: ORG, runId: created.run.id, executionToken: created.run.executionToken, completedByUserId: ids.userId });
    expect(result).toEqual({ ok: false, code: "LEASE_LOST" });
  });

  it("graceful yield allows the immediate next request to take over (no waiting out the full lease)", async () => {
    const s = nextSuffix("yield");
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `${s}-r${i}`, sourceRowNumber: 4 + i, col1: `id${i}`, col2: "1.5" }));
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");

    // maxDurationMs=0 forces exactly one batch then an immediate yield,
    // as long as more rows remain after that one batch. With
    // DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE=2 (one row's
    // worth of cells), the first call processes row 0 only, then yields.
    process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE = "2";
    const first = await normalizeBatches(created.run, 0);
    delete process.env.DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE;
    expect(first.ok).toBe(true);
    expect(first.exhausted).toBe(false);

    // The lease should be immediately re-takeable, not stuck for ~120s.
    const resumed = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.alreadyNormalized) throw new Error("expected a resumed run");
    expect(resumed.run.id).toBe(created.run.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// RESUME CURSOR / REPLAY
// ═══════════════════════════════════════════════════════════════════════

describe("resume cursor: MAX(source_row_number), not persisted_row_count", () => {
  it("resumes strictly after the max already-normalized source row, never reprocessing committed rows", async () => {
    const s = nextSuffix("cursor");
    const rows = [
      { id: `${s}-r1`, sourceRowNumber: 4, col1: "a", col2: "1" },
      { id: `${s}-r2`, sourceRowNumber: 5, col1: "b", col2: "2" },
    ];
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");

    const result = await normalizeBatches(created.run, 5000);
    expect(result.ok).toBe(true);
    expect(result.exhausted).toBe(true);
    expect(result.persistedRowCount).toBe(2);

    const normalizedRows = await prisma.dataHubNormalizedRow.findMany({ where: { normalization_run_id: created.run.id } });
    expect(normalizedRows).toHaveLength(2);

    // Replaying the SAME run/token again finds nothing left to do. Note:
    // `created.run` is an immutable snapshot from creation time
    // (persistedRowCount=0 baked in) -- normalizeBatches's own return
    // value is scoped to what THIS call itself persisted (correctly 0 new
    // rows here), while the DURABLE cumulative count lives on the DB row
    // itself, checked separately below.
    const replay = await normalizeBatches(created.run, 5000);
    expect(replay.ok).toBe(true);
    expect(replay.exhausted).toBe(true);
    expect(replay.persistedRowCount).toBe(0);
    const stillTwo = await prisma.dataHubNormalizedRow.count({ where: { normalization_run_id: created.run.id } });
    expect(stillTwo).toBe(2);
    const runRow = await prisma.dataHubNormalizationRun.findFirstOrThrow({ where: { id: created.run.id } });
    expect(runRow.persisted_row_count).toBe(2);
  });

  it("a FAILED prior attempt's rows never affect a new attempt's cursor -- two attempts coexist historically without rewriting evidence", async () => {
    // Raw evidence is immutable (D4A invariant) -- so this proof does NOT
    // "fix" a bad value between attempts. Instead: row 1 is valid, row 2 is
    // permanently blocking. Attempt 1 normalizes row 1 then blocks on row
    // 2. Attempt 2 (a fresh, independent run) starts with its OWN empty
    // cursor -- if attempt 2's resume cursor were contaminated by attempt
    // 1's evidence, it would skip row 1; instead it re-normalizes row 1
    // under ITS OWN normalization_run_id, proving the cursor is scoped per
    // run, and attempt 1's own evidence is left completely untouched.
    const s = nextSuffix("multiattempt");
    const rows = [
      { id: `${s}-r1`, sourceRowNumber: 4, col1: "a", col2: "1" },
      { id: `${s}-r2`, sourceRowNumber: 5, col1: "b", col2: "not-a-number" },
    ];
    const ids = await seedWorld(s, { rows });

    const attempt1 = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!attempt1.ok || attempt1.alreadyNormalized) throw new Error("expected a fresh run");
    const blockedResult1 = await normalizeBatches(attempt1.run, 5000);
    expect(blockedResult1.ok).toBe(false);
    expect(blockedResult1.code).toBe("NORMALIZATION_BLOCKED");

    const attempt1Rows = await prisma.dataHubNormalizedRow.count({ where: { normalization_run_id: attempt1.run.id } });
    expect(attempt1Rows).toBe(1); // row 1 only (row 2 blocked)

    // upload.normalized_at is still NULL (attempt 1 FAILED, never
    // completed), so a second attempt is eligible.
    const attempt2 = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!attempt2.ok || attempt2.alreadyNormalized) throw new Error("expected a second fresh run");
    expect(attempt2.run.id).not.toBe(attempt1.run.id);

    const blockedResult2 = await normalizeBatches(attempt2.run, 5000);
    expect(blockedResult2.ok).toBe(false);
    expect(blockedResult2.code).toBe("NORMALIZATION_BLOCKED");
    // Attempt 2's cursor started fresh (no rows normalized under attempt 2
    // yet), so it independently re-normalized row 1 before blocking on the
    // same row 2 -- proof the cursor is scoped per normalization_run_id.
    expect(blockedResult2.persistedRowCount).toBe(1);

    const attempt1RowsAfter = await prisma.dataHubNormalizedRow.count({ where: { normalization_run_id: attempt1.run.id } });
    expect(attempt1RowsAfter).toBe(1); // still exactly what attempt 1 left, untouched
    const attempt2Rows = await prisma.dataHubNormalizedRow.count({ where: { normalization_run_id: attempt2.run.id } });
    expect(attempt2Rows).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TRANSFORM / PERSIST / BLOCKING BEHAVIOUR
// ═══════════════════════════════════════════════════════════════════════

describe("transform/persist: successful batch", () => {
  it("an all-success batch writes normalized rows/cells, zero findings, and JSON-string high-precision decimals with JSON null preserved", async () => {
    const s = nextSuffix("success");
    const rows = [
      { id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "12.3456789012345" },
      { id: `${s}-r2`, sourceRowNumber: 5, col1: "def", col2: null },
    ];
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");

    const result = await normalizeBatches(created.run, 5000);
    expect(result.ok).toBe(true);
    expect(result.exhausted).toBe(true);
    expect(result.persistedRowCount).toBe(2);
    expect(result.persistedCellCount).toBe(4);

    const findingCount = await prisma.dataHubNormalizationFinding.count({ where: { normalization_run_id: created.run.id } });
    expect(findingCount).toBe(0);

    const cell = await prisma.dataHubNormalizedCell.findFirst({ where: { raw_row_id: `${s}-r1`, source_schema_column_id: ids.col2 } });
    expect(cell?.normalized_value).toBe("12.3456789012345");
    expect(typeof cell?.normalized_value).toBe("string");

    const nullCell = await prisma.dataHubNormalizedCell.findFirst({ where: { raw_row_id: `${s}-r2`, source_schema_column_id: ids.col2 } });
    expect(nullCell?.normalized_value).toBeNull();
  });
});

describe("transform/persist: blocking behaviour", () => {
  it("a BLOCKING row writes findings but no normalized row for that row, and no PII/raw value in the finding payload", async () => {
    const s = nextSuffix("block1");
    const rows = [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "not-a-number" }];
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");

    const result = await normalizeBatches(created.run, 5000);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NORMALIZATION_BLOCKED");

    const normalizedRows = await prisma.dataHubNormalizedRow.count({ where: { normalization_run_id: created.run.id, raw_row_id: `${s}-r1` } });
    expect(normalizedRows).toBe(0);

    const findings = await prisma.dataHubNormalizationFinding.findMany({ where: { normalization_run_id: created.run.id, raw_row_id: `${s}-r1` } });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe("BLOCKING_ERROR");
    expect(findings[0].finding_code).toBe("MALFORMED_NUMERIC_STRING");

    const run = await prisma.dataHubNormalizationRun.findFirstOrThrow({ where: { id: created.run.id } });
    expect(run.status).toBe("FAILED");
    expect(run.failure_code).toBe("NORMALIZATION_BLOCKED");
    expect(run.failure_detail).toBe("One or more blocking normalization findings were persisted.");
    expect(run.failure_detail).not.toMatch(/not-a-number/);
  });

  it("no later rows are processed after a blocking row within the same batch", async () => {
    const s = nextSuffix("block2");
    const rows = [
      { id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "not-a-number" },
      { id: `${s}-r2`, sourceRowNumber: 5, col1: "def", col2: "1.5" },
    ];
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");

    const result = await normalizeBatches(created.run, 5000);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NORMALIZATION_BLOCKED");

    const row2Normalized = await prisma.dataHubNormalizedRow.count({ where: { normalization_run_id: created.run.id, raw_row_id: `${s}-r2` } });
    expect(row2Normalized).toBe(0);
    const row2Findings = await prisma.dataHubNormalizationFinding.count({ where: { normalization_run_id: created.run.id, raw_row_id: `${s}-r2` } });
    expect(row2Findings).toBe(0);
  });

  it("earlier SUCCESSFUL rows in the same batch persist alongside the blocking row's findings, and persisted counts reflect only the successful evidence", async () => {
    const s = nextSuffix("block3");
    const rows = [
      { id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1.5" },
      { id: `${s}-r2`, sourceRowNumber: 5, col1: "def", col2: "not-a-number" },
    ];
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");

    const result = await normalizeBatches(created.run, 5000);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NORMALIZATION_BLOCKED");
    expect(result.persistedRowCount).toBe(1);
    expect(result.persistedCellCount).toBe(2);

    const row1Normalized = await prisma.dataHubNormalizedRow.count({ where: { normalization_run_id: created.run.id, raw_row_id: `${s}-r1` } });
    expect(row1Normalized).toBe(1);
  });

  it("BLOCKING completion is refused: a FAILED run's evidence can never be completed", async () => {
    const s = nextSuffix("block4");
    const rows = [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "not-a-number" }];
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    await normalizeBatches(created.run, 5000);

    const completion = await completeNormalizationRun({ organisationId: ORG, runId: created.run.id, executionToken: created.run.executionToken, completedByUserId: ids.userId });
    // The run is no longer RUNNING (FAILED) -- the TS-level pre-check
    // reports LEASE_LOST (status !== RUNNING), never claiming completion.
    expect(completion).toEqual({ ok: false, code: "LEASE_LOST" });
  });
});

describe("finding logical-identity uniqueness prevents replay noise", () => {
  it("re-transforming and re-persisting the SAME blocking finding after a stale-cursor retry is rejected by B2B1's own natural uniqueness constraint (never duplicates)", async () => {
    const s = nextSuffix("findreplay");
    const rows = [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "not-a-number" }];
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    const first = await normalizeBatches(created.run, 5000);
    expect(first.code).toBe("NORMALIZATION_BLOCKED");

    // Simulate a caller that (incorrectly) retries the SAME logical batch
    // against the SAME run/token before observing the FAILED transition --
    // the underlying B2B1 uniqueness constraint (not this module's own
    // retry logic) is what prevents duplicate finding noise. We drive this
    // directly at the SQL layer (the same call normalizeBatches itself
    // makes) to prove the DB-level guarantee independent of any
    // application-level idempotency this module does or doesn't add.
    const findingsBefore = await prisma.dataHubNormalizationFinding.count({ where: { normalization_run_id: created.run.id } });
    await expect(
      prisma.$queryRawUnsafe(
        `SELECT * FROM datahub_stage_normalized_batch($1, $2, $3, $4::jsonb, $5::jsonb, $6::int)`,
        created.run.id,
        ORG,
        created.run.executionToken,
        JSON.stringify([]),
        JSON.stringify([{ id: "fresh-retry-id", rawRowId: `${s}-r1`, sourceRowNumber: 4, rawCellId: `${s}-r1-c2`, sourceSchemaColumnId: ids.col2, severity: "BLOCKING_ERROR", findingCode: "MALFORMED_NUMERIC_STRING", valueKind: "DECIMAL" }]),
        120
      )
    ).rejects.toThrow();
    const findingsAfter = await prisma.dataHubNormalizationFinding.count({ where: { normalization_run_id: created.run.id } });
    expect(findingsAfter).toBe(findingsBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// COMPLETION
// ═══════════════════════════════════════════════════════════════════════

describe("completion", () => {
  it("completes successfully once all rows are exhausted with zero blocking findings, and sets Upload's normalized metadata", async () => {
    const s = nextSuffix("complete");
    const rows = [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1.5" }];
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    const batchResult = await normalizeBatches(created.run, 5000);
    expect(batchResult.exhausted).toBe(true);

    const completion = await completeNormalizationRun({ organisationId: ORG, runId: created.run.id, executionToken: created.run.executionToken, completedByUserId: ids.userId });
    expect(completion).toEqual({ ok: true, rowCount: 1, cellCount: 2 });

    const upload = await prisma.upload.findFirstOrThrow({ where: { id: ids.uploadId } });
    expect(upload.normalized_at).not.toBeNull();
    expect(upload.normalized_row_count).toBe(1);
    expect(upload.normalized_cell_count).toBe(2);
    expect(upload.normalization_run_id).toBe(created.run.id);
  });

  it("terminal SUCCEEDED run is never resumed -- a later createOrResumeNormalizationRun call reports alreadyNormalized", async () => {
    const s = nextSuffix("termsucc");
    const rows = [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "1.5" }];
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    await normalizeBatches(created.run, 5000);
    await completeNormalizationRun({ organisationId: ORG, runId: created.run.id, executionToken: created.run.executionToken, completedByUserId: ids.userId });

    const again = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(again).toEqual({ ok: true, alreadyNormalized: true });
  });

  it("terminal FAILED run is never resumed for further batch work -- a new attempt is created instead, the failed run's own execution_token is dead", async () => {
    const s = nextSuffix("termfail");
    const rows = [{ id: `${s}-r1`, sourceRowNumber: 4, col1: "abc", col2: "not-a-number" }];
    const ids = await seedWorld(s, { rows });
    const created = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    if (!created.ok || created.alreadyNormalized) throw new Error("expected a fresh run");
    await normalizeBatches(created.run, 5000);

    const next = await createOrResumeNormalizationRun({ organisationId: ORG, uploadId: ids.uploadId, actorUserId: ids.userId });
    expect(next.ok).toBe(true);
    if (!next.ok || next.alreadyNormalized) throw new Error("expected a fresh second attempt");
    expect(next.run.id).not.toBe(created.run.id);

    const staleBatch = await normalizeBatches(created.run, 5000);
    expect(staleBatch.ok).toBe(false);
    expect(staleBatch.code).toBe("LEASE_LOST");
  });
});
