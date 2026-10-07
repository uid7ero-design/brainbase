import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { AnalysisDatasetContext } from "@/lib/data-hub/analysis";
import type { SemanticDatasetSchemaDraft } from "@/lib/data-hub/semanticInference/schemaSynthesis";
import type { DataQualityReviewResolution } from "@/lib/data-hub/dataQuality/reviewResolution";

// Data Hub 6.2D4D1B2 -- real disposable-Postgres proof for the dataset
// profile execution service (profileUploadDataset, and its own
// completeDatasetProfileRun/createDatasetProfileRunAttempt building
// blocks). Exact structural analogue of
// scripts/tests/dataHubNormalizationExecutor.integration.test.ts's own
// "no route, no auth seam, only the lib/db sql-client seam" pattern -- the
// service takes already-trusted {organisationId, uploadId, actorId}
// directly.
//
// WHY REAL POSTGRES: the one-RUNNING-per-normalization-run partial unique
// index, the completion reconciliation trigger, and the Upload pointer
// guard trigger are all enforced by real Postgres constraints/triggers --
// a mocked sql client cannot prove any of this.
//
// Run ONLY via scripts/tests/verify-datahub-profile-execution.sh, which
// creates the disposable postgres:16-alpine container, applies the real
// D4A -> D4B -> D4C-B1 -> D4C-B2B1 -> D4D1B1 -> D4D1B2 migration chain
// (unmodified), and exports DATABASE_URL before this file is ever
// imported.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("dataHubDatasetProfileExecution.integration.test.ts requires DATABASE_URL to point at a disposable Postgres container (see scripts/tests/verify-datahub-profile-execution.sh). Refusing to run without it.");
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

let profileUploadDataset: typeof import("@/lib/data-hub/profileExecution/profileUploadDataset").profileUploadDataset;
let createDatasetProfileRunAttempt: typeof import("@/lib/data-hub/profileExecution/dataHubDatasetProfileRun").createDatasetProfileRunAttempt;
let resolveAuthoritativeNormalizationContext: typeof import("@/lib/data-hub/profileExecution/dataHubDatasetProfileRun").resolveAuthoritativeNormalizationContext;
let markDatasetProfileRunFailed: typeof import("@/lib/data-hub/profileExecution/dataHubDatasetProfileRun").markDatasetProfileRunFailed;
let getDatasetProfileRunById: typeof import("@/lib/data-hub/profileExecution/dataHubDatasetProfileRun").getDatasetProfileRunById;
let completeDatasetProfileRun: typeof import("@/lib/data-hub/profileExecution/completeDatasetProfileRun").completeDatasetProfileRun;
let DATASET_PROFILER_VERSION: typeof import("@/lib/data-hub/profiling/contracts").DATASET_PROFILER_VERSION;

const ORG_A = "org-a";
const ORG_B = "org-b";
let batchSeq = 0;
const RUN_SALT = Date.now().toString(36).slice(-6);

beforeAll(async () => {
  ({ profileUploadDataset } = await import("@/lib/data-hub/profileExecution/profileUploadDataset"));
  ({ createDatasetProfileRunAttempt, resolveAuthoritativeNormalizationContext, markDatasetProfileRunFailed, getDatasetProfileRunById } = await import("@/lib/data-hub/profileExecution/dataHubDatasetProfileRun"));
  ({ completeDatasetProfileRun } = await import("@/lib/data-hub/profileExecution/completeDatasetProfileRun"));
  ({ DATASET_PROFILER_VERSION } = await import("@/lib/data-hub/profiling/contracts"));

  await prisma.$executeRawUnsafe(`INSERT INTO organisations (id, name, slug, updated_at) VALUES ('${ORG_A}', 'Org A', '${ORG_A}', now()) ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO organisations (id, name, slug, updated_at) VALUES ('${ORG_B}', 'Org B', '${ORG_B}', now()) ON CONFLICT (id) DO NOTHING`);
}, 60_000);

afterAll(async () => {
  // The analysis service uses the real application Prisma client as well.
  const { prisma: analysisPrisma } = await import("@/lib/prisma");
  await analysisPrisma.$disconnect();
  await prisma.$disconnect();
});

function nextSuffix(prefix: string): string {
  batchSeq += 1;
  return `${prefix}${RUN_SALT}${batchSeq}`;
}

// ─── Fixture builder ────────────────────────────────────────────────────
// One fresh, isolated world per call: a user, a governed worksheet with
// 4 columns (col1 IDENTIFIER, col2 DECIMAL, col3 DATE, col4 STRING), an
// import batch + upload, a SUCCEEDED raw staging run, and a SUCCEEDED
// normalization run with real normalized rows/cells -- i.e. an upload
// that is immediately profile-eligible via its own authoritative
// normalization_run_id pointer.

interface SeedRow {
  id: string;
  sourceRowNumber: number;
  col1: string; // IDENTIFIER
  col2: string | null; // DECIMAL canonical string or explicit missing value
  col3: string; // DATE canonical string
  col4: string; // STRING
}

async function seedWorld(suffix: string, org: string, rows: SeedRow[], opts: { corruptCol2NormalizedValueForRowId?: string } = {}) {
  const userId = `user-${suffix}`;
  const wsId = `ws-${suffix}`;
  const svId = `sv-${suffix}`;
  const col1 = `col1-${suffix}`;
  const col2 = `col2-${suffix}`;
  const col3 = `col3-${suffix}`;
  const col4 = `col4-${suffix}`;
  const profileId = `wp-${suffix}`;
  const pvId = `pv-${suffix}`;
  const batchId = `batch-${suffix}`;
  const uploadId = `up-${suffix}`;
  const rawRunId = `raw-${suffix}`;
  const normRunId = `norm-${suffix}`;

  await prisma.$executeRawUnsafe(`INSERT INTO users (id, organisation_id, username, email, name, password_hash, role, updated_at) VALUES ('${userId}','${org}','${userId}','${userId}@x.com','User ${suffix}','x','MANAGER', now()) ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_systems (id, organisation_id, name, updated_at) VALUES ('ss-${suffix}','${org}','SS ${suffix}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO dataset_types (id, organisation_id, source_system_id, name, updated_at) VALUES ('dt-${suffix}','${org}','ss-${suffix}','DT ${suffix}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('${svId}','${org}','dt-${suffix}',1,'v1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role, ordinal_hint) VALUES ('${wsId}','${org}','${svId}','data','Data','REQUIRED','DATA',0)`);
  await prisma.$executeRawUnsafe(
    `INSERT INTO source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, presence, declared_type, sensitivity_class) VALUES
     ('${col1}','${org}','${wsId}',0,'Id','REQUIRED','UNKNOWN','CONFIDENTIAL'),
     ('${col2}','${org}','${wsId}',1,'Amount','REQUIRED','UNKNOWN','CONFIDENTIAL'),
     ('${col3}','${org}','${wsId}',2,'Date','REQUIRED','UNKNOWN','INTERNAL'),
     ('${col4}','${org}','${wsId}',3,'Notes','REQUIRED','UNKNOWN','PERSONALLY_IDENTIFIABLE')`
  );
  await prisma.$executeRawUnsafe(`INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name, active, updated_at) VALUES ('${profileId}','${org}','${wsId}','profile-${suffix}', true, now())`);

  const profileDocument = JSON.stringify({
    documentVersion: 2,
    schemaStatus: "DRAFT",
    headerRowOneBased: 3,
    columnRules: [
      { sourceSchemaColumnId: col1, valueKind: "IDENTIFIER", preserveLeadingZeros: true },
      { sourceSchemaColumnId: col2, valueKind: "DECIMAL" },
      { sourceSchemaColumnId: col3, valueKind: "DATE", datePolicy: "ISO_8601" },
      { sourceSchemaColumnId: col4, valueKind: "STRING" },
    ],
  }).replace(/'/g, "''");
  await prisma.$executeRawUnsafe(`INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('${pvId}','${org}','${profileId}',1,'STAGING_DATASET','${profileDocument}')`);
  await prisma.$executeRawUnsafe(`UPDATE worksheet_mapping_profiles SET active_profile_version_id='${pvId}' WHERE id='${profileId}'`);

  const sha = suffix.padEnd(64, "0").slice(0, 64);
  await prisma.$executeRawUnsafe(`INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256, source_schema_version_id, updated_at) VALUES ('${batchId}','${org}','${userId}','f.xlsx','xlsx',1,'vercel-blob','k-${suffix}','READY', '${sha}', '${svId}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, worksheet_name, lineage_kind, updated_at) VALUES ('${uploadId}','${org}','f.xlsx','p','x',1,'${batchId}',0,'Data','DATA_HUB', now())`);

  const rowCount = rows.length;
  const cellCount = rowCount * 4;

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
    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_raw_cells (id, organisation_id, raw_row_id, source_schema_worksheet_id, source_schema_column_id, column_ordinal, source_header, raw_value, raw_value_type, sensitivity_class, original_unit)
       VALUES
       ('${row.id}-c1','${org}','${row.id}','${wsId}','${col1}',0,'Id','${JSON.stringify(row.col1)}','STRING','CONFIDENTIAL', NULL),
       ('${row.id}-c2','${org}','${row.id}','${wsId}','${col2}',1,'Amount','${JSON.stringify(row.col2)}','${row.col2 === null ? "NULL" : "STRING"}','CONFIDENTIAL', NULL),
       ('${row.id}-c3','${org}','${row.id}','${wsId}','${col3}',2,'Date','${JSON.stringify(row.col3)}','STRING','INTERNAL', NULL),
       ('${row.id}-c4','${org}','${row.id}','${wsId}','${col4}',3,'Notes','${JSON.stringify(row.col4)}','STRING','PERSONALLY_IDENTIFIABLE', NULL)`
    );
  }

  // Real transform via the pure B2A transformRow -- never hand-computed,
  // so I/J's exact-value-preservation proofs are grounded in the REAL
  // normalization transform, not a test-only re-derivation.
  const { transformRow } = await import("@/lib/data-hub/normalization/transformRow");
  const { buildNormalizationPlan } = await import("@/lib/data-hub/normalization/plan");
  const planResult = buildNormalizationPlan(JSON.parse(profileDocument.replace(/''/g, "'")), [col1, col2, col3, col4]);
  if (!planResult.ok) throw new Error("test fixture: plan build failed");

  await prisma.$executeRawUnsafe(
    `INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, created_by, completed_at)
     VALUES ('${normRunId}','${org}','${batchId}','${uploadId}','${rawRunId}','${svId}','${wsId}','${profileId}','${pvId}',1,'v1','SUCCEEDED','ntok-${suffix}', now()+interval '1 hour', now(), ${rowCount}, ${cellCount}, ${rowCount}, ${cellCount}, '${userId}', now())`
  );

  for (const row of rows) {
    const normRowId = `nr-${row.id}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_normalized_rows (id, organisation_id, normalization_run_id, raw_staging_run_id, raw_row_id, source_row_number) VALUES ('${normRowId}','${org}','${normRunId}','${rawRunId}','${row.id}',${row.sourceRowNumber})`
    );
    const cellDefs: Array<{ colId: string; rawValue: unknown; rawCellId: string }> = [
      { colId: col1, rawValue: row.col1, rawCellId: `${row.id}-c1` },
      { colId: col2, rawValue: row.col2, rawCellId: `${row.id}-c2` },
      { colId: col3, rawValue: row.col3, rawCellId: `${row.id}-c3` },
      { colId: col4, rawValue: row.col4, rawCellId: `${row.id}-c4` },
    ];
    for (const def of cellDefs) {
      const rule = planResult.plan.rulesByColumnId.get(def.colId)!;
      const result = transformRow({ rawRowId: row.id, sourceRowNumber: row.sourceRowNumber }, [{ sourceSchemaColumnId: def.colId, cell: { rawValueType: def.rawValue === null ? "NULL" : "STRING", rawValue: def.rawValue as string | null } }], { rulesByColumnId: new Map([[def.colId, rule]]) });
      if (result.findings.some((f) => f.severity === "BLOCKING_ERROR")) {
        throw new Error(`test fixture: unexpected blocking finding for ${def.colId}`);
      }
      const output = result.outputs[0];
      // F. profiler input failure fixture hook: inject an already-
      // malformed (non-canonical-decimal) value at INSERT time for one
      // targeted cell -- normalized evidence is immutable (no UPDATE
      // permitted after insert), so a bad value can only ever be
      // simulated by inserting it directly, never by corrupting it
      // afterward.
      const injectCorruption = opts.corruptCol2NormalizedValueForRowId === row.id && def.colId === col2;
      const normValueJson = injectCorruption ? JSON.stringify("not-a-number") : JSON.stringify(output.normalizedValue).replace(/'/g, "''");
      await prisma.$executeRawUnsafe(
        `INSERT INTO data_hub_normalized_cells (id, organisation_id, normalized_row_id, raw_row_id, raw_cell_id, source_schema_column_id, value_kind, normalized_value, source_unit, normalized_unit)
         VALUES ('n-${def.rawCellId}','${org}','${normRowId}','${row.id}','${def.rawCellId}','${def.colId}','${output.valueKind}','${normValueJson}'::jsonb, ${output.sourceUnit ? `'${output.sourceUnit}'` : "NULL"}, ${output.normalizedUnit ? `'${output.normalizedUnit}'` : "NULL"})`
      );
    }
  }

  await prisma.$executeRawUnsafe(`UPDATE uploads SET normalized_at=now(), normalized_by='${userId}', normalized_profile_version_id='${pvId}', normalized_row_count=${rowCount}, normalized_cell_count=${cellCount}, normalization_run_id='${normRunId}' WHERE id='${uploadId}'`);

  return { userId, wsId, svId, col1, col2, col3, col4, profileId, pvId, batchId, uploadId, rawRunId, normRunId };
}

// ═══════════════════════════════════════════════════════════════════════
// A. HAPPY PATH
// ═══════════════════════════════════════════════════════════════════════

describe("A. happy path", () => {
  it("creates exactly one RUNNING attempt, runs D4D1A, persists columns/stats exactly, completes, sets the Upload pointer", async () => {
    const s = nextSuffix("happy");
    const rows: SeedRow[] = [
      { id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-001", col2: "10.50", col3: "2024-01-15", col4: "hello" },
      { id: `${s}-r2`, sourceRowNumber: 3, col1: "ID-002", col2: "20.25", col3: "2024-02-20", col4: "world" },
    ];
    const ids = await seedWorld(s, ORG_A, rows);

    const result = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.status).toBe("SUCCEEDED");
    expect(result.created).toBe(true);
    expect(result.profilerVersion).toBe(DATASET_PROFILER_VERSION);
    expect(result.normalizationRunId).toBe(ids.normRunId);
    expect(result.rowCount).toBe(2);
    expect(result.columnCount).toBe(4);

    const runs = await prisma.dataHubDatasetProfileRun.findMany({ where: { organisation_id: ORG_A, normalization_run_id: ids.normRunId } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");
    expect(runs[0].attempt_number).toBe(1);
    expect(Number(runs[0].row_count)).toBe(2);
    expect(Number(runs[0].column_count)).toBe(4);
    expect(Number(runs[0].total_cell_count)).toBe(8);

    const columns = await prisma.dataHubDatasetProfileColumn.findMany({ where: { organisation_id: ORG_A, profile_run_id: runs[0].id }, orderBy: { ordinal: "asc" } });
    expect(columns).toHaveLength(4);
    expect(columns.map((c) => c.source_schema_column_id)).toEqual([ids.col1, ids.col2, ids.col3, ids.col4]);
    expect(columns.map((c) => c.ordinal)).toEqual([0, 1, 2, 3]);

    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: ids.uploadId } });
    expect(upload.dataset_profile_run_id).toBe(runs[0].id);
    expect(upload.profiled_by).toBe(ids.userId);
    expect(upload.profiler_version).toBe(DATASET_PROFILER_VERSION);
    expect(upload.profiled_at).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// B. IDEMPOTENT RECALL
// ═══════════════════════════════════════════════════════════════════════

describe("B. idempotent recall", () => {
  it("a second call for the same upload/run/version returns the existing success truthfully, with no second run created and no pointer change", async () => {
    const s = nextSuffix("idem");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "5", col3: "2024-01-01", col4: "x" }];
    const ids = await seedWorld(s, ORG_A, rows);

    const first = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
    if (!first.ok) throw new Error("unreachable");
    const uploadAfterFirst = await prisma.upload.findUniqueOrThrow({ where: { id: ids.uploadId } });

    const second = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.status).toBe("SUCCEEDED");
    expect(second.created).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.profileRunId).toBe(first.profileRunId);

    const runs = await prisma.dataHubDatasetProfileRun.findMany({ where: { organisation_id: ORG_A, normalization_run_id: ids.normRunId } });
    expect(runs).toHaveLength(1);
    const uploadAfterSecond = await prisma.upload.findUniqueOrThrow({ where: { id: ids.uploadId } });
    expect(uploadAfterSecond.dataset_profile_run_id).toBe(uploadAfterFirst.dataset_profile_run_id);
    expect(uploadAfterSecond.profiled_at?.getTime()).toBe(uploadAfterFirst.profiled_at?.getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C. CONCURRENT START
// ═══════════════════════════════════════════════════════════════════════

describe("C. concurrent start", () => {
  it("two simultaneous requests for the same target never create duplicate RUNNING attempts or colliding attempt numbers", async () => {
    const s = nextSuffix("conc");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "1", col3: "2024-01-01", col4: "x" }];
    const ids = await seedWorld(s, ORG_A, rows);

    const [a, b] = await Promise.all([
      profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId }),
      profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("unreachable");

    // Exactly one SUCCEEDED run was ever persisted for this normalization run.
    const runs = await prisma.dataHubDatasetProfileRun.findMany({ where: { organisation_id: ORG_A, normalization_run_id: ids.normRunId } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");
    // Both callers converge on the same profileRunId -- the loser never
    // fabricates a second identity.
    expect(a.profileRunId).toBe(runs[0].id);
    expect(b.profileRunId).toBe(runs[0].id);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// D. NORMALIZATION NOT SUCCEEDED
// ═══════════════════════════════════════════════════════════════════════
//
// NOTE on fixture technique: in this system's REAL write paths,
// Upload.normalization_run_id/normalized_at are only ever set TOGETHER,
// atomically, by normalization's own completion function, and are then
// immutable (enforced by both a CHECK constraint grouping the two fields
// and a BEFORE UPDATE trigger) -- so "Upload points at a normalization
// run that is RUNNING/FAILED/ABANDONED" is a state ordinary application
// writes can never produce. It is still a real DEFENSIVE check in
// resolveAuthoritativeNormalizationContext (never trust the pointer
// alone), so it is proven here by disabling the uploads guard trigger for
// exactly one direct fixture UPDATE, then re-enabling it immediately --
// never done by the execution service itself, only by this test's own
// fixture setup.

async function seedMinimalUploadOnly(suffix: string, org: string) {
  const userId = `user-${suffix}`;
  const wsId = `ws-${suffix}`;
  const svId = `sv-${suffix}`;
  const profileId = `wp-${suffix}`;
  const pvId = `pv-${suffix}`;
  const batchId = `batch-${suffix}`;
  const uploadId = `up-${suffix}`;

  await prisma.$executeRawUnsafe(`INSERT INTO users (id, organisation_id, username, email, name, password_hash, role, updated_at) VALUES ('${userId}','${org}','${userId}','${userId}@x.com','User ${suffix}','x','MANAGER', now()) ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_systems (id, organisation_id, name, updated_at) VALUES ('ss-${suffix}','${org}','SS ${suffix}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO dataset_types (id, organisation_id, source_system_id, name, updated_at) VALUES ('dt-${suffix}','${org}','ss-${suffix}','DT ${suffix}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_schema_versions (id, organisation_id, dataset_type_id, version_number, label) VALUES ('${svId}','${org}','dt-${suffix}',1,'v1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, presence, role, ordinal_hint) VALUES ('${wsId}','${org}','${svId}','data','Data','REQUIRED','DATA',0)`);
  await prisma.$executeRawUnsafe(`INSERT INTO worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name, active, updated_at) VALUES ('${profileId}','${org}','${wsId}','profile-${suffix}', true, now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document) VALUES ('${pvId}','${org}','${profileId}',1,'STAGING_DATASET','{"documentVersion":1,"schemaStatus":"DRAFT","headerRowOneBased":1}')`);
  await prisma.$executeRawUnsafe(`UPDATE worksheet_mapping_profiles SET active_profile_version_id='${pvId}' WHERE id='${profileId}'`);
  const sha = suffix.padEnd(64, "0").slice(0, 64);
  await prisma.$executeRawUnsafe(`INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, status, sha256, source_schema_version_id, updated_at) VALUES ('${batchId}','${org}','${userId}','f.xlsx','xlsx',1,'vercel-blob','k-${suffix}','READY', '${sha}', '${svId}', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, worksheet_name, lineage_kind, updated_at) VALUES ('${uploadId}','${org}','f.xlsx','p','x',1,'${batchId}',0,'Data','DATA_HUB', now())`);

  const rawRunId = `raw-${suffix}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO data_hub_raw_staging_runs (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, source_sha256, parser_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, persisted_row_count, persisted_cell_count, completed_at)
     VALUES ('${rawRunId}','${org}','${batchId}','${uploadId}','${svId}','${wsId}','${profileId}','${pvId}',1,'${sha}','v1','SUCCEEDED','rtok-${suffix}', now()+interval '1 hour', now(), 0, 0, 0, 0, now())`
  );
  await prisma.$executeRawUnsafe(`UPDATE uploads SET raw_staged_at=now(), raw_staged_by='${userId}', raw_profile_version_id='${pvId}', raw_row_count=0, raw_cell_count=0, raw_staging_run_id='${rawRunId}' WHERE id='${uploadId}'`);

  return { userId, wsId, svId, profileId, pvId, batchId, uploadId, rawRunId };
}

describe("D. normalization RUNNING/FAILED/ABANDONED -- profiler never called", () => {
  it.each(["RUNNING", "FAILED", "ABANDONED"] as const)("normalization status %s is rejected with NORMALIZATION_RUN_NOT_SUCCEEDED, no profile run/columns, no Upload pointer", async (status) => {
    const s = nextSuffix(`notsucc${status}`);
    const ids = await seedMinimalUploadOnly(s, ORG_A);
    const normRunId = `norm-${s}`;

    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_normalization_runs (id, organisation_id, import_batch_id, upload_id, raw_staging_run_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, attempt_number, normalizer_version, status, execution_token, lease_expires_at, last_progress_at, expected_row_count, expected_cell_count, created_by)
       VALUES ('${normRunId}','${ORG_A}','${ids.batchId}','${ids.uploadId}','${ids.rawRunId}','${ids.svId}','${ids.wsId}','${ids.profileId}','${ids.pvId}',1,'v1','RUNNING','ntok-${s}', now()+interval '1 hour', now(), 0, 0, '${ids.userId}')`
    );

    if (status === "FAILED") {
      await prisma.$executeRawUnsafe(`UPDATE data_hub_normalization_runs SET status='FAILED', failed_at=now(), failure_code='TEST' WHERE id='${normRunId}'`);
    } else if (status === "ABANDONED") {
      // ABANDONED requires BOTH completed_at and failed_at to stay NULL
      // (data_hub_normalization_runs's own lifecycle trigger) -- terminal
      // history, never a failure.
      await prisma.$executeRawUnsafe(`UPDATE data_hub_normalization_runs SET status='ABANDONED' WHERE id='${normRunId}'`);
    }

    await prisma.$executeRawUnsafe(`ALTER TABLE uploads DISABLE TRIGGER uploads_normalization_metadata_guard`);
    try {
      await prisma.$executeRawUnsafe(`UPDATE uploads SET normalization_run_id='${normRunId}', normalized_at=now(), normalized_by='${ids.userId}', normalized_profile_version_id='${ids.pvId}', normalized_row_count=0, normalized_cell_count=0 WHERE id='${ids.uploadId}'`);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE uploads ENABLE TRIGGER uploads_normalization_metadata_guard`);
    }

    const result = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
    expect(result).toEqual({ ok: false, code: "NORMALIZATION_RUN_NOT_SUCCEEDED" });

    const runs = await prisma.dataHubDatasetProfileRun.count({ where: { organisation_id: ORG_A, normalization_run_id: normRunId } });
    expect(runs).toBe(0);
    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: ids.uploadId } });
    expect(upload.dataset_profile_run_id).toBeNull();
  });

  it("no normalization pinned at all -> NORMALIZATION_NOT_COMPLETE", async () => {
    const s = nextSuffix("nonorm");
    const ids = await seedMinimalUploadOnly(s, ORG_A);
    const result = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
    expect(result).toEqual({ ok: false, code: "NORMALIZATION_NOT_COMPLETE" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// E. WRONG LINEAGE
// ═══════════════════════════════════════════════════════════════════════

describe("E. wrong lineage", () => {
  it("a manager from a different organisation cannot resolve another org's upload (cross-org rejected)", async () => {
    const s = nextSuffix("crossorg");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "1", col3: "2024-01-01", col4: "x" }];
    const ids = await seedWorld(s, ORG_A, rows);

    const result = await profileUploadDataset({ organisationId: ORG_B, uploadId: ids.uploadId, actorId: `user-${s}` });
    expect(result).toEqual({ ok: false, code: "NORMALIZATION_NOT_COMPLETE" });

    const runs = await prisma.dataHubDatasetProfileRun.count({ where: { upload_id: ids.uploadId } });
    expect(runs).toBe(0);
  });

  it("an arbitrary normalization_run_id cannot be substituted for a different upload -- the DB's own wider composite FK refuses it structurally, even with the completion guard trigger disabled", async () => {
    const s = nextSuffix("arbrun");
    const other = nextSuffix("arbrunother");
    const ids = await seedMinimalUploadOnly(s, ORG_A);
    const rows: SeedRow[] = [{ id: `${other}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "1", col3: "2024-01-01", col4: "x" }];
    const otherIds = await seedWorld(other, ORG_A, rows);

    // Attempt to point ids.uploadId's Upload.normalization_run_id at a
    // DIFFERENT upload's (otherIds.uploadId's) real SUCCEEDED
    // normalization run, with the completion guard TRIGGER disabled (the
    // same fixture technique section D uses) to isolate what the wider
    // composite FK (uploads_normalization_run_upload_fkey, proving the
    // pointed-to run really belongs to THIS upload's own id) does on its
    // own. It refuses the write outright -- this cross-upload
    // substitution is impossible at the DB level even with the trigger
    // out of the way, which is a STRONGER guarantee than relying on
    // resolveAuthoritativeNormalizationContext's own application-level
    // re-check alone.
    await prisma.$executeRawUnsafe(`ALTER TABLE uploads DISABLE TRIGGER uploads_normalization_metadata_guard`);
    try {
      await expect(
        prisma.$executeRawUnsafe(`UPDATE uploads SET normalization_run_id='${otherIds.normRunId}', normalized_at=now(), normalized_by='${ids.userId}', normalized_profile_version_id='${ids.pvId}', normalized_row_count=1, normalized_cell_count=4 WHERE id='${ids.uploadId}'`)
      ).rejects.toThrow(/uploads_normalization_run_upload_fkey/);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE uploads ENABLE TRIGGER uploads_normalization_metadata_guard`);
    }

    // Upload's own pointer is untouched by the rejected write.
    const ctx = await resolveAuthoritativeNormalizationContext({ organisationId: ORG_A, uploadId: ids.uploadId });
    expect(ctx).toEqual({ ok: false, code: "NORMALIZATION_NOT_COMPLETE" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// F. PROFILER INPUT FAILURE
// ═══════════════════════════════════════════════════════════════════════

describe("F. profiler input failure", () => {
  it("a malformed persisted normalized value (invalid canonical decimal) fails the RUNNING attempt closed with PROFILE_INPUT_INVALID, zero profile columns remain, Upload pointer stays null", async () => {
    const s = nextSuffix("badinput");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "1", col3: "2024-01-01", col4: "x" }];
    // Normalized evidence is immutable (no UPDATE permitted once
    // inserted) -- a malformed persisted value can only be simulated by
    // inserting it directly as part of fixture setup (see seedWorld's own
    // corruptCol2NormalizedValueForRowId hook), never by corrupting it
    // afterward. This still exercises the exact condition section 6/12
    // require failing closed on: persisted evidence that violates D4D1A's
    // own input contract.
    const ids = await seedWorld(s, ORG_A, rows, { corruptCol2NormalizedValueForRowId: `${s}-r1` });

    const result = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
    expect(result).toEqual({ ok: false, code: "PROFILE_INPUT_INVALID" });

    const runs = await prisma.dataHubDatasetProfileRun.findMany({ where: { organisation_id: ORG_A, normalization_run_id: ids.normRunId } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("FAILED");
    expect(runs[0].failure_code).toBe("PROFILE_INPUT_INVALID");
    expect(runs[0].row_count).toBeNull();

    const columns = await prisma.dataHubDatasetProfileColumn.count({ where: { profile_run_id: runs[0].id } });
    expect(columns).toBe(0);

    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: ids.uploadId } });
    expect(upload.dataset_profile_run_id).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// G. PERSISTENCE / RECONCILIATION FAILURE
// ═══════════════════════════════════════════════════════════════════════

describe("G. persistence/reconciliation failure", () => {
  it("a deliberately inconsistent completion payload rolls back every column insert, leaves zero partial columns, and the run becomes FAILED with a bounded code", async () => {
    const s = nextSuffix("reconfail");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "1", col3: "2024-01-01", col4: "x" }];
    const ids = await seedWorld(s, ORG_A, rows);

    const normCtx = await resolveAuthoritativeNormalizationContext({ organisationId: ORG_A, uploadId: ids.uploadId });
    if (!normCtx.ok) throw new Error("unreachable");
    const created = await createDatasetProfileRunAttempt({ organisationId: ORG_A, actorId: ids.userId, normalization: normCtx.normalization, profilerVersion: DATASET_PROFILER_VERSION });
    if (!created.ok || !created.created) throw new Error("unreachable");

    // A deliberately internally-inconsistent DatasetProfile (totalCellCount
    // disagrees with rowCount*columnCount) -- this must never reach the DB
    // from the real D4D1A/adapter path (both are exact and consistent by
    // construction); hand-crafting it here isolates and proves
    // completeDatasetProfileRun's OWN rollback behavior against the real
    // D4D1B1 reconciliation trigger.
    const badProfile = {
      profilerVersion: DATASET_PROFILER_VERSION,
      rowCount: 1,
      columnCount: 4,
      totalCellCount: 999, // WRONG: should be 4
      nonNullCellCount: 4,
      nullCellCount: 0,
      completeRowCount: 1,
      incompleteRowCount: 0,
      columns: [
        { sourceSchemaColumnId: ids.col1, valueKind: "IDENTIFIER" as const, sourceUnit: null, normalizedUnit: null, rowCount: 1, nonNullCount: 1, nullCount: 0, distinctNonNullCount: 1, nullRatio: "0", nonNullRatio: "1", distinctRatio: "1", isConstant: true, isAllNull: false, isUniqueAmongNonNull: true, isComplete: true, isSparse: false, stringStats: { minLength: 4, maxLength: 4, totalLength: 4, meanLength: "4", emptyStringCount: 0 } },
        { sourceSchemaColumnId: ids.col2, valueKind: "DECIMAL" as const, sourceUnit: null, normalizedUnit: null, rowCount: 1, nonNullCount: 1, nullCount: 0, distinctNonNullCount: 1, nullRatio: "0", nonNullRatio: "1", distinctRatio: "1", isConstant: true, isAllNull: false, isUniqueAmongNonNull: true, isComplete: true, isSparse: false, numericStats: { min: "1", max: "1", sum: "1", mean: "1" } },
        { sourceSchemaColumnId: ids.col3, valueKind: "DATE" as const, sourceUnit: null, normalizedUnit: null, rowCount: 1, nonNullCount: 1, nullCount: 0, distinctNonNullCount: 1, nullRatio: "0", nonNullRatio: "1", distinctRatio: "1", isConstant: true, isAllNull: false, isUniqueAmongNonNull: true, isComplete: true, isSparse: false, temporalStats: { min: "2024-01-01", max: "2024-01-01" } },
        { sourceSchemaColumnId: ids.col4, valueKind: "STRING" as const, sourceUnit: null, normalizedUnit: null, rowCount: 1, nonNullCount: 1, nullCount: 0, distinctNonNullCount: 1, nullRatio: "0", nonNullRatio: "1", distinctRatio: "1", isConstant: true, isAllNull: false, isUniqueAmongNonNull: true, isComplete: true, isSparse: false, stringStats: { minLength: 1, maxLength: 1, totalLength: 1, meanLength: "1", emptyStringCount: 0 } },
      ],
    };
    const sourceColumnOrdinalByColumnId = new Map([[ids.col1, 0], [ids.col2, 1], [ids.col3, 2], [ids.col4, 3]]);

    const completion = await completeDatasetProfileRun({ organisationId: ORG_A, profileRunId: created.run.id, completedBy: ids.userId, profile: badProfile, sourceColumnOrdinalByColumnId });
    expect(completion.ok).toBe(false);
    if (completion.ok) throw new Error("unreachable");
    expect(completion.code).toBe("PROFILE_RECONCILIATION_FAILED");

    // Rollback proof: ZERO columns survive, even though the function's
    // own loop inserted 4 rows before the reconciliation UPDATE raised.
    const columns = await prisma.dataHubDatasetProfileColumn.count({ where: { profile_run_id: created.run.id } });
    expect(columns).toBe(0);

    const stillRunning = await prisma.dataHubDatasetProfileRun.findUniqueOrThrow({ where: { id: created.run.id } });
    expect(stillRunning.status).toBe("RUNNING"); // the failed transaction never committed a status change

    // The execution layer's own bounded failure path.
    const failed = await markDatasetProfileRunFailed({ organisationId: ORG_A, runId: created.run.id, failureCode: completion.code });
    expect(failed).toBe(true);
    const finalRun = await prisma.dataHubDatasetProfileRun.findUniqueOrThrow({ where: { id: created.run.id } });
    expect(finalRun.status).toBe("FAILED");
    expect(finalRun.failure_code).toBe("PROFILE_RECONCILIATION_FAILED");

    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: ids.uploadId } });
    expect(upload.dataset_profile_run_id).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// G2. PR #324 REMEDIATION — real-Postgres proof of the underlying
// fail-run state transitions the mocked unit suite
// (dataHubDatasetProfileExecutionFailureDisposition.test.ts) exercises
// profileUploadDataset's own orchestration logic against. Section 10 of
// the remediation task requires these specific DB state transitions to
// remain real-Postgres even though forcing the TRIGGERING exception/race
// deterministically is impractical outside a mock.
// ═══════════════════════════════════════════════════════════════════════

describe("G2. real fail-run state transitions", () => {
  it("markDatasetProfileRunFailed applies (true) against a real RUNNING row, and durably transitions it to FAILED", async () => {
    const s = nextSuffix("faildisp1");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "1", col3: "2024-01-01", col4: "x" }];
    const ids = await seedWorld(s, ORG_A, rows);
    const normCtx = await resolveAuthoritativeNormalizationContext({ organisationId: ORG_A, uploadId: ids.uploadId });
    if (!normCtx.ok) throw new Error("unreachable");
    const created = await createDatasetProfileRunAttempt({ organisationId: ORG_A, actorId: ids.userId, normalization: normCtx.normalization, profilerVersion: DATASET_PROFILER_VERSION });
    if (!created.ok || !created.created) throw new Error("unreachable");

    const applied = await markDatasetProfileRunFailed({ organisationId: ORG_A, runId: created.run.id, failureCode: "PROFILE_INPUT_INVALID" });
    expect(applied).toBe(true);

    const run = await prisma.dataHubDatasetProfileRun.findUniqueOrThrow({ where: { id: created.run.id } });
    expect(run.status).toBe("FAILED");
    expect(run.failure_code).toBe("PROFILE_INPUT_INVALID");
  });

  it("markDatasetProfileRunFailed returns false (zero rows affected) against a real row that is no longer RUNNING -- the exact 'disposition did not apply' case", async () => {
    const s = nextSuffix("faildisp2");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "1", col3: "2024-01-01", col4: "x" }];
    const ids = await seedWorld(s, ORG_A, rows);
    const normCtx = await resolveAuthoritativeNormalizationContext({ organisationId: ORG_A, uploadId: ids.uploadId });
    if (!normCtx.ok) throw new Error("unreachable");
    const created = await createDatasetProfileRunAttempt({ organisationId: ORG_A, actorId: ids.userId, normalization: normCtx.normalization, profilerVersion: DATASET_PROFILER_VERSION });
    if (!created.ok || !created.created) throw new Error("unreachable");

    // First call legitimately transitions RUNNING -> FAILED.
    const firstApplied = await markDatasetProfileRunFailed({ organisationId: ORG_A, runId: created.run.id, failureCode: "PROFILE_INPUT_INVALID" });
    expect(firstApplied).toBe(true);

    // A second attempt against the now-terminal row is the REAL state
    // this remediation's disposeExecutionFailure must detect and handle
    // truthfully (re-read, never silently claim success) -- proven here
    // for real: the UPDATE matches zero rows.
    const secondApplied = await markDatasetProfileRunFailed({ organisationId: ORG_A, runId: created.run.id, failureCode: "PERSISTENCE_FAILURE" });
    expect(secondApplied).toBe(false);

    // The run's own failure_code from the FIRST (real) disposition is
    // untouched by the second, no-op attempt -- exactly what
    // getDatasetProfileRunById's own re-read would observe.
    const current = await getDatasetProfileRunById({ organisationId: ORG_A, runId: created.run.id });
    expect(current?.status).toBe("FAILED");
    expect(current?.failureCode).toBe("PROFILE_INPUT_INVALID");
  });

  it("getDatasetProfileRunById reflects real RUNNING/FAILED/SUCCEEDED state exactly, including null for a nonexistent id", async () => {
    const s = nextSuffix("faildisp3");
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "1", col3: "2024-01-01", col4: "x" }];
    const ids = await seedWorld(s, ORG_A, rows);

    const result = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
    if (!result.ok) throw new Error("unreachable");

    const succeeded = await getDatasetProfileRunById({ organisationId: ORG_A, runId: result.profileRunId });
    expect(succeeded?.status).toBe("SUCCEEDED");

    const missing = await getDatasetProfileRunById({ organisationId: ORG_A, runId: "does-not-exist" });
    expect(missing).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// H. SUCCESS POINTER ATOMICITY
// ═══════════════════════════════════════════════════════════════════════

describe("H. success pointer atomicity", () => {
  it("there is no observable committed state where Upload points to a run that is not SUCCEEDED, across every scenario run so far", async () => {
    const uploadsWithPointer = await prisma.upload.findMany({ where: { dataset_profile_run_id: { not: null } }, select: { id: true, dataset_profile_run_id: true, organisation_id: true } });
    expect(uploadsWithPointer.length).toBeGreaterThan(0);
    for (const upload of uploadsWithPointer) {
      const run = await prisma.dataHubDatasetProfileRun.findUniqueOrThrow({ where: { id: upload.dataset_profile_run_id! } });
      expect(run.status).toBe("SUCCEEDED");
      expect(run.upload_id).toBe(upload.id);
      expect(run.organisation_id).toBe(upload.organisation_id);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// I. EXACT VALUE PRESERVATION
// ═══════════════════════════════════════════════════════════════════════

describe("I. exact value preservation", () => {
  it("huge-precision DECIMAL values beyond JS floating precision persist byte-for-byte", async () => {
    const s = nextSuffix("exact");
    const huge1 = "99999999999999999999999999999999999999999999999991";
    const huge2 = "99999999999999999999999999999999999999999999999999";
    const rows: SeedRow[] = [
      { id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: huge1, col3: "2024-01-01", col4: "a" },
      { id: `${s}-r2`, sourceRowNumber: 3, col1: "ID-2", col2: huge2, col3: "2024-01-02", col4: "b" },
    ];
    const ids = await seedWorld(s, ORG_A, rows);

    const result = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
    if (!result.ok) throw new Error("unreachable");

    const col2Profile = await prisma.dataHubDatasetProfileColumn.findFirstOrThrow({ where: { profile_run_id: result.profileRunId, source_schema_column_id: ids.col2 } });
    expect(col2Profile.numeric_min).toBe(huge1);
    expect(col2Profile.numeric_max).toBe(huge2);
    expect(Number(huge1)).toBe(Number(huge2)); // proves this is a real exact-vs-float distinction, not a vacuous test
  });
});

// ═══════════════════════════════════════════════════════════════════════
// J. TEMPORAL PRESERVATION
// ═══════════════════════════════════════════════════════════════════════

describe("J. temporal preservation", () => {
  it("DATE values pass through unmodified -- no timezone reinterpretation, no locale parsing", async () => {
    const s = nextSuffix("temporal");
    const rows: SeedRow[] = [
      { id: `${s}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "1", col3: "2024-12-31", col4: "a" },
      { id: `${s}-r2`, sourceRowNumber: 3, col1: "ID-2", col2: "2", col3: "2024-01-01", col4: "b" },
    ];
    const ids = await seedWorld(s, ORG_A, rows);

    const result = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
    if (!result.ok) throw new Error("unreachable");

    const col3Profile = await prisma.dataHubDatasetProfileColumn.findFirstOrThrow({ where: { profile_run_id: result.profileRunId, source_schema_column_id: ids.col3 } });
    expect(col3Profile.temporal_min).toBe("2024-01-01");
    expect(col3Profile.temporal_max).toBe("2024-12-31");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// K. PRIVACY
// ═══════════════════════════════════════════════════════════════════════

describe("K. privacy", () => {
  it("sensitive STRING/IDENTIFIER values never appear in DataHubDatasetProfileRun, DataHubDatasetProfileColumn, or Upload profile metadata", async () => {
    const s = nextSuffix("privacy");
    const SECRET_IDENTIFIER = "EMP-00451-SECRET";
    const SECRET_STRING = "456 Confidential Ave, Secretville";
    const rows: SeedRow[] = [{ id: `${s}-r1`, sourceRowNumber: 2, col1: SECRET_IDENTIFIER, col2: "1", col3: "2024-01-01", col4: SECRET_STRING }];
    const ids = await seedWorld(s, ORG_A, rows);

    const result = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
    if (!result.ok) throw new Error("unreachable");

    const run = await prisma.dataHubDatasetProfileRun.findUniqueOrThrow({ where: { id: result.profileRunId } });
    const columns = await prisma.dataHubDatasetProfileColumn.findMany({ where: { profile_run_id: result.profileRunId } });
    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: ids.uploadId } });

    const serialized = JSON.stringify({ run, columns, upload }, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
    expect(serialized).not.toContain(SECRET_IDENTIFIER);
    expect(serialized).not.toContain(SECRET_STRING);
  });
});

// D4D5N: reuse the migrated real-Postgres fixture and real profiler above.
// No Prisma/loader/evaluator mock. Semantic and reviewed-quality snapshots
// are trusted test inputs; this does not prove their persistence or auth.
async function countWorld(empty = false) {
  const suffix = nextSuffix("counts");
  const ids = await seedWorld(suffix, ORG_A, empty ? [] : [
    { id: `${suffix}-r1`, sourceRowNumber: 2, col1: "ID-1", col2: "10", col3: "2024-01-01", col4: "note" },
    { id: `${suffix}-r2`, sourceRowNumber: 3, col1: "ID-2", col2: null, col3: "2024-01-02", col4: "" },
  ]);
  const profiled = await profileUploadDataset({ organisationId: ORG_A, uploadId: ids.uploadId, actorId: ids.userId });
  if (!profiled.ok) throw new Error("count fixture profiling failed");
  const context: AnalysisDatasetContext = { organisationId: ORG_A, uploadId: ids.uploadId,
    importBatchId: ids.batchId, normalizationRunId: ids.normRunId, datasetProfileRunId: profiled.profileRunId,
    sourceSchemaVersionId: ids.svId, sourceSchemaWorksheetId: ids.wsId, worksheetMappingProfileVersionId: ids.pvId };
  const schema: SemanticDatasetSchemaDraft = { schemaVersion: "v1", resolutionVersion: "v1", inferenceVersion: "v1",
    profilerVersion: "v1", recordKeyCandidateState: "NONE", fields: [
      { sourceSchemaColumnId: ids.col1, semanticRole: "IDENTIFIER", fieldClass: "IDENTIFIER" },
      { sourceSchemaColumnId: ids.col2, semanticRole: "MEASURE", fieldClass: "MEASURE" },
      { sourceSchemaColumnId: ids.col3, semanticRole: "TEMPORAL", fieldClass: "TEMPORAL" },
      { sourceSchemaColumnId: ids.col4, semanticRole: "TEXT", fieldClass: "TEXT_ATTRIBUTE" },
    ].map((field) => ({ ...field, recordKeyCandidate: false, confidence: "HIGH", evidence: [],
      resolutionSource: "AUTO_HIGH_CONFIDENCE" })) as SemanticDatasetSchemaDraft["fields"] };
  const quality: DataQualityReviewResolution = { resolutionVersion: "v1", reviewVersion: "v1", qualityVersion: "v1",
    profilerVersion: "v1", schemaVersion: "v1", state: "READY", itemCount: 0, acknowledgedNoticeCount: 0,
    continuedReviewCount: 0, heldReviewCount: 0, items: [] };
  const { analyzeUploadProfileCount } = await import("@/lib/data-hub/analysisExecution/analyzeUploadProfileCount");
  return { ids, context, schema: { context: { ...context }, snapshot: schema },
    quality: { context: { ...context }, snapshot: quality }, analyze: analyzeUploadProfileCount,
    scope: { organisationId: ORG_A, uploadId: ids.uploadId } };
}

describe("D4D5N real persisted upload count service", () => {
  const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
  it("returns row and present counts from the real profiler's persisted evidence", async () => {
    const f = await countWorld();
    const before = await prisma.upload.findUniqueOrThrow({ where: { id: f.ids.uploadId } });
    expect(await f.analyze(f.scope, f.schema, f.quality, rows))
      .toMatchObject({ ok: true, result: { count: 2, context: f.context } });
    expect(await f.analyze(f.scope, f.schema, f.quality, { requestVersion: "v1", kind: "AGGREGATE",
      sourceSchemaColumnId: f.ids.col2, operator: "COUNT_PRESENT" }))
      .toMatchObject({ ok: true, result: { count: 1, context: f.context } });
    expect(await prisma.upload.findUniqueOrThrow({ where: { id: f.ids.uploadId } })).toEqual(before);
    expect(await prisma.dataHubDatasetProfileRun.count({ where: { upload_id: f.ids.uploadId } })).toBe(1);
  });
  it("returns zero counts for an empty persisted dataset", async () => {
    const f = await countWorld(true);
    expect(await f.analyze(f.scope, f.schema, f.quality, rows)).toMatchObject({ ok: true, result: { count: 0 } });
    expect(await f.analyze(f.scope, f.schema, f.quality, { requestVersion: "v1", kind: "AGGREGATE",
      sourceSchemaColumnId: f.ids.col2, operator: "COUNT_PRESENT" })).toMatchObject({ ok: true, result: { count: 0 } });
  });
  it("does not expose another organization's upload", async () => {
    const f = await countWorld();
    expect(await f.analyze({ ...f.scope, organisationId: ORG_B }, f.schema, f.quality, rows))
      .toEqual({ ok: false, code: "UPLOAD_NOT_FOUND" });
  });
  it("rejects stale reviewed context despite valid persisted counts", async () => {
    const f = await countWorld(); f.quality.context.datasetProfileRunId = "old-profile";
    expect(await f.analyze(f.scope, f.schema, f.quality, rows)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it("honors a quality hold with real database reads", async () => {
    const f = await countWorld(); f.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    expect(await f.analyze(f.scope, f.schema, f.quality, rows)).toEqual({ ok: false, code: "QUALITY_HOLD" });
  });
  it("rejects caller profile injection with real persisted evidence", async () => {
    const f = await countWorld();
    expect(await f.analyze(f.scope, f.schema, f.quality, { ...rows, profile: { rowCount: 999 } }))
      .toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
});
