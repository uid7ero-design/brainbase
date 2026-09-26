// Data Hub 6.2D4B — real disposable-Postgres proof for
// scripts/create-datahub-raw-staging-runs.sql, applied on top of D4A's
// own scripts/create-datahub-raw-staging.sql.
//
// This proof must only run against a throwaway postgres:16-alpine database
// on port 55566. The harness must bootstrap the current main Prisma schema,
// then apply D4A (twice, idempotency) then D4B (twice, idempotency) before
// invoking this file.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL?.includes("55566")) {
  throw new Error("Refusing to run: DATABASE_URL does not point at the disposable D4B proof container (port 55566).");
}

const prisma = new PrismaClient();

const ORG = "d4b-org-a";
const ORG_B = "d4b-org-b";

describe("6.2D4B raw-staging-run foundation — real disposable Postgres proof", () => {
  beforeAll(async () => {
    await prisma.organisation.createMany({
      data: [
        { id: ORG, name: "D4B Org A", slug: "d4b-org-a" },
        { id: ORG_B, name: "D4B Org B", slug: "d4b-org-b" },
      ],
    });
    await prisma.user.createMany({
      data: [
        { id: "d4b-user-a", organisation_id: ORG, username: "d4b-user-a", name: "D4B User A" },
        { id: "d4b-user-b", organisation_id: ORG, username: "d4b-user-b", name: "D4B User B (completer)" },
      ],
    });
    await prisma.sourceSystem.create({ data: { id: "d4b-ss-a", organisation_id: ORG, name: "D4B Source A", active: true } });
    await prisma.datasetType.create({ data: { id: "d4b-dt-a", organisation_id: ORG, source_system_id: "d4b-ss-a", name: "D4B Dataset A", active: true } });
    await prisma.sourceSchemaVersion.create({
      data: { id: "d4b-sv-a", organisation_id: ORG, dataset_type_id: "d4b-dt-a", version_number: 1, label: "D4B Schema A", status: "ACTIVE", activated_at: new Date() },
    });
    await prisma.sourceSchemaWorksheet.create({
      data: { id: "d4b-ws-a", organisation_id: ORG, source_schema_version_id: "d4b-sv-a", logical_key: "data", expected_name: "Data", ordinal_hint: 0, presence: "REQUIRED", role: "DATA" },
    });
    await prisma.sourceSchemaColumn.createMany({
      data: [
        { id: "d4b-col-0", organisation_id: ORG, source_schema_worksheet_id: "d4b-ws-a", ordinal: 0, source_header: "Code", presence: "REQUIRED", declared_type: "STRING", sensitivity_class: "PUBLIC" },
        { id: "d4b-col-3", organisation_id: ORG, source_schema_worksheet_id: "d4b-ws-a", ordinal: 3, source_header: "Amount", presence: "REQUIRED", declared_type: "DECIMAL", sensitivity_class: "INTERNAL" },
      ],
    });
    await prisma.worksheetMappingProfile.create({
      data: { id: "d4b-wp-a", organisation_id: ORG, source_schema_worksheet_id: "d4b-ws-a", name: "Profile A", active: true },
    });
    await prisma.worksheetMappingProfileVersion.create({
      data: { id: "d4b-wp-a-v1", organisation_id: ORG, worksheet_mapping_profile_id: "d4b-wp-a", version_number: 1, disposition: "STAGING_DATASET", profile_document: { documentVersion: 1, headerRowOneBased: 1, schemaStatus: "ACTIVE" } },
    });
    await prisma.worksheetMappingProfile.update({ where: { id: "d4b-wp-a" }, data: { active_profile_version_id: "d4b-wp-a-v1" } });

    await prisma.importBatch.create({
      data: {
        id: "d4b-batch-a", organisation_id: ORG, original_filename: "a.xlsx", content_type: "xlsx",
        size_bytes: 1, sha256: "a".repeat(64), storage_provider: "proof", storage_key: "proof/d4b-a", status: "READY",
        source_system_id: "d4b-ss-a", dataset_type_id: "d4b-dt-a", source_schema_version_id: "d4b-sv-a",
      },
    });
    await prisma.upload.create({
      data: {
        id: "d4b-upload-a", organisation_id: ORG, original_name: "a.xlsx", stored_path: "n/a",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 1,
        lineage_kind: "DATA_HUB", import_batch_id: "d4b-batch-a", worksheet_index: 0, worksheet_name: "Data",
        worksheet_visibility: "visible", worksheet_is_empty: false, canonical_status: "AWAITING_CONFIRMATION",
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function runInsert(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: `run-${Math.random().toString(36).slice(2)}`,
      organisation_id: ORG,
      import_batch_id: "d4b-batch-a",
      upload_id: "d4b-upload-a",
      source_schema_version_id: "d4b-sv-a",
      source_schema_worksheet_id: "d4b-ws-a",
      worksheet_mapping_profile_id: "d4b-wp-a",
      worksheet_mapping_profile_version_id: "d4b-wp-a-v1",
      attempt_number: 1,
      source_sha256: "a".repeat(64),
      parser_version: "test",
      status: "RUNNING",
      execution_token: "tok-a",
      lease_expires_at: new Date(Date.now() + 60_000),
      last_progress_at: new Date(),
      ...overrides,
    };
  }

  it("catalog: partial unique index exists with the exact drift-checked definition", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'data_hub_raw_staging_runs_one_active_per_upload'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("UNIQUE");
    expect(rows[0].indexdef).toContain("upload_id");
    expect(rows[0].indexdef).toMatch(/WHERE \(status = 'RUNNING'::text\)/);
  });

  it("the circular-FK fix: a raw row can be inserted while Upload.raw_profile_version_id is still NULL", async () => {
    const run = runInsert({ id: "d4b-run-basic" });
    await prisma.dataHubRawStagingRun.create({ data: run });

    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: "d4b-upload-a" } });
    expect(upload.raw_profile_version_id).toBeNull();
    expect(upload.raw_staged_at).toBeNull();

    // Must succeed — this is exactly what D4A's own FK made impossible.
    await prisma.dataHubRawRow.create({
      data: {
        id: "d4b-row-1", organisation_id: ORG, import_batch_id: "d4b-batch-a", upload_id: "d4b-upload-a",
        source_schema_version_id: "d4b-sv-a", source_schema_worksheet_id: "d4b-ws-a",
        worksheet_mapping_profile_id: "d4b-wp-a", worksheet_mapping_profile_version_id: "d4b-wp-a-v1",
        staging_run_id: "d4b-run-basic", source_row_number: 2,
      },
    });
    const row = await prisma.dataHubRawRow.findUniqueOrThrow({ where: { id: "d4b-row-1" } });
    expect(row.staging_run_id).toBe("d4b-run-basic");

    // Free the partial-unique-index slot for subsequent tests on the same upload.
    await prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-basic" }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
  });

  it("row uniqueness is scoped to the run, not the upload: the same physical row number can be reinserted under a NEW run", async () => {
    await prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-retry-a", attempt_number: 10, execution_token: "tok-retry-a" }) });
    // Two different runs for the same upload cannot BOTH be RUNNING at once
    // (proven separately below) — mark the first FAILED BEFORE creating the
    // second (the partial index would otherwise reject the second create).
    await prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-retry-a" }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
    await prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-retry-b", attempt_number: 11, execution_token: "tok-retry-b" }) });

    await prisma.dataHubRawRow.create({
      data: { id: "d4b-row-retry-a", organisation_id: ORG, import_batch_id: "d4b-batch-a", upload_id: "d4b-upload-a", source_schema_version_id: "d4b-sv-a", source_schema_worksheet_id: "d4b-ws-a", worksheet_mapping_profile_id: "d4b-wp-a", worksheet_mapping_profile_version_id: "d4b-wp-a-v1", staging_run_id: "d4b-run-retry-a", source_row_number: 5 },
    });
    // Same source_row_number=5, but under the SECOND run — must succeed.
    await prisma.dataHubRawRow.create({
      data: { id: "d4b-row-retry-b", organisation_id: ORG, import_batch_id: "d4b-batch-a", upload_id: "d4b-upload-a", source_schema_version_id: "d4b-sv-a", source_schema_worksheet_id: "d4b-ws-a", worksheet_mapping_profile_id: "d4b-wp-a", worksheet_mapping_profile_version_id: "d4b-wp-a-v1", staging_run_id: "d4b-run-retry-b", source_row_number: 5 },
    });
    // But the SAME run cannot reuse the same row number.
    await expect(prisma.dataHubRawRow.create({
      data: { id: "d4b-row-retry-b2", organisation_id: ORG, import_batch_id: "d4b-batch-a", upload_id: "d4b-upload-a", source_schema_version_id: "d4b-sv-a", source_schema_worksheet_id: "d4b-ws-a", worksheet_mapping_profile_id: "d4b-wp-a", worksheet_mapping_profile_version_id: "d4b-wp-a-v1", staging_run_id: "d4b-run-retry-b", source_row_number: 5 },
    })).rejects.toThrow();

    // Free the partial-unique-index slot for subsequent tests on the same upload.
    await prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-retry-b" }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
  });

  it("partial unique index rejects a second concurrent RUNNING run for the same upload", async () => {
    await prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-conc-1", attempt_number: 20, execution_token: "tok-c1" }) });
    await expect(
      prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-conc-2", attempt_number: 21, execution_token: "tok-c2" }) })
    ).rejects.toThrow();
    await prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-conc-1" }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
    // Now a new RUNNING row for the same upload succeeds.
    await prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-conc-3", attempt_number: 22, execution_token: "tok-c3" }) });
    await prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-conc-3" }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
  });

  it("lease takeover: an expired lease can be atomically claimed; a live lease cannot", async () => {
    await prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-lease", attempt_number: 30, execution_token: "tok-live", lease_expires_at: new Date(Date.now() + 60_000) }) });

    const liveAttempt = await prisma.$executeRawUnsafe(
      `UPDATE data_hub_raw_staging_runs SET execution_token = $1, lease_expires_at = now() + interval '60 seconds'
       WHERE id = $2 AND organisation_id = $3 AND status = 'RUNNING' AND lease_expires_at < now()`,
      "tok-steal-attempt", "d4b-run-lease", ORG
    );
    expect(liveAttempt).toBe(0); // live lease — cannot be taken over

    await prisma.$executeRawUnsafe(`UPDATE data_hub_raw_staging_runs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, "d4b-run-lease");

    const takeover = await prisma.$executeRawUnsafe(
      `UPDATE data_hub_raw_staging_runs SET execution_token = $1, lease_expires_at = now() + interval '60 seconds'
       WHERE id = $2 AND organisation_id = $3 AND status = 'RUNNING' AND lease_expires_at < now()`,
      "tok-new-owner", "d4b-run-lease", ORG
    );
    expect(takeover).toBe(1); // expired lease — successfully taken over

    await prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-lease" }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
  });

  it("correction 1: datahub_stage_raw_batch never leaves partial evidence when the lease has been lost", async () => {
    await prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-batch-ok", attempt_number: 40, execution_token: "tok-batch-ok" }) });

    const payload = JSON.stringify([
      { id: "cell-row-a", sourceRowNumber: 2, cells: [{ id: "cell-a0", sourceSchemaColumnId: "d4b-col-0", columnOrdinal: 0, sourceHeader: "Code", sensitivityClass: "PUBLIC", rawValue: "A1", rawValueType: "STRING", originalUnit: null }] },
    ]);
    const ok = await prisma.$queryRawUnsafe<Array<{ inserted_row_count: number }>>(
      `SELECT * FROM datahub_stage_raw_batch($1, $2, $3, $4::jsonb)`, "d4b-run-batch-ok", ORG, "tok-batch-ok", payload
    );
    expect(ok[0].inserted_row_count).toBe(1);

    const rowCountAfterGood = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM data_hub_raw_rows WHERE staging_run_id = 'd4b-run-batch-ok'`);
    expect(rowCountAfterGood[0].n).toBe(1);

    // Now simulate a lost lease (wrong token) with a NEW batch — must be
    // rejected AND must not insert anything (correction 1's core guarantee).
    const badPayload = JSON.stringify([
      { id: "cell-row-b", sourceRowNumber: 3, cells: [{ id: "cell-b0", sourceSchemaColumnId: "d4b-col-0", columnOrdinal: 0, sourceHeader: "Code", sensitivityClass: "PUBLIC", rawValue: "SHOULD-NOT-PERSIST", rawValueType: "STRING", originalUnit: null }] },
    ]);
    await expect(
      prisma.$queryRawUnsafe(`SELECT * FROM datahub_stage_raw_batch($1, $2, $3, $4::jsonb)`, "d4b-run-batch-ok", ORG, "tok-WRONG", badPayload)
    ).rejects.toThrow();

    const rowCountAfterBad = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM data_hub_raw_rows WHERE staging_run_id = 'd4b-run-batch-ok'`);
    // Still exactly 1 — the rejected batch inserted NOTHING, not even the
    // row that would have gone with the mismatched token.
    expect(rowCountAfterBad[0].n).toBe(1);
    const leaked = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM data_hub_raw_cells WHERE raw_value::text LIKE '%SHOULD-NOT-PERSIST%'`);
    expect(leaked[0].n).toBe(0);

    await prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-batch-ok" }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
  });

  it("correction 2: actor deletion nulls created_by unconditionally, while RUNNING and while terminal, with nothing else changing", async () => {
    await prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-actor-running", attempt_number: 50, execution_token: "tok-actor-1", created_by: "d4b-user-a" }) });
    await prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-actor-terminal", attempt_number: 51, upload_id: "d4b-upload-a", execution_token: "tok-actor-2", created_by: "d4b-user-a", status: "FAILED", failed_at: new Date(), failure_code: "TEST" }) });
    // Second run can't be RUNNING (partial index) — created as FAILED directly above.

    await prisma.user.delete({ where: { id: "d4b-user-a" } });

    const runningAfter = await prisma.dataHubRawStagingRun.findUniqueOrThrow({ where: { id: "d4b-run-actor-running" } });
    expect(runningAfter.created_by).toBeNull();
    expect(runningAfter.status).toBe("RUNNING"); // untouched by the actor-deletion cascade

    const terminalAfter = await prisma.dataHubRawStagingRun.findUniqueOrThrow({ where: { id: "d4b-run-actor-terminal" } });
    expect(terminalAfter.created_by).toBeNull();
    expect(terminalAfter.status).toBe("FAILED"); // untouched — proves the cascade needs no ordinary lease/status update

    await prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-actor-running" }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
  });

  it("lifecycle guard: terminal runs are otherwise immutable; DELETE is always rejected", async () => {
    await prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-immutable", attempt_number: 60, execution_token: "tok-immutable", status: "FAILED", failed_at: new Date(), failure_code: "TEST" }) });
    await expect(prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-immutable" }, data: { status: "SUCCEEDED", completed_at: new Date() } })).rejects.toThrow();
    await expect(prisma.dataHubRawStagingRun.delete({ where: { id: "d4b-run-immutable" } })).rejects.toThrow();
  });

  it("progress counters may never decrease while RUNNING", async () => {
    await prisma.dataHubRawStagingRun.create({ data: runInsert({ id: "d4b-run-progress", attempt_number: 70, execution_token: "tok-progress", persisted_row_count: 5, persisted_cell_count: 10 }) });
    await expect(
      prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-progress" }, data: { persisted_row_count: 4 } })
    ).rejects.toThrow();
    await prisma.dataHubRawStagingRun.update({ where: { id: "d4b-run-progress" }, data: { status: "FAILED", failed_at: new Date(), failure_code: "TEST" } });
  });

  it("correction 3: completion uses the AUTHENTICATED COMPLETING actor for Upload.raw_staged_by, never the run's own created_by — and survives the run creator's deletion", async () => {
    await prisma.user.create({ data: { id: "d4b-user-creator", organisation_id: ORG, username: "d4b-user-creator", name: "Creator" } });

    await prisma.importBatch.create({
      data: {
        id: "d4b-batch-c3", organisation_id: ORG, original_filename: "c3.xlsx", content_type: "xlsx",
        size_bytes: 1, sha256: "c".repeat(64), storage_provider: "proof", storage_key: "proof/d4b-c3", status: "READY",
        source_system_id: "d4b-ss-a", dataset_type_id: "d4b-dt-a", source_schema_version_id: "d4b-sv-a",
      },
    });
    await prisma.upload.create({
      data: {
        id: "d4b-upload-c3", organisation_id: ORG, original_name: "c3.xlsx", stored_path: "n/a",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 1,
        lineage_kind: "DATA_HUB", import_batch_id: "d4b-batch-c3", worksheet_index: 0, worksheet_name: "Data",
        worksheet_visibility: "visible", worksheet_is_empty: false, canonical_status: "AWAITING_CONFIRMATION",
      },
    });
    await prisma.dataHubRawStagingRun.create({
      data: runInsert({
        id: "d4b-run-c3", upload_id: "d4b-upload-c3", import_batch_id: "d4b-batch-c3", attempt_number: 1,
        execution_token: "tok-c3", created_by: "d4b-user-creator",
        expected_row_count: 1, expected_cell_count: 1, persisted_row_count: 1, persisted_cell_count: 1,
      }),
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_raw_rows (id, organisation_id, import_batch_id, upload_id, source_schema_version_id, source_schema_worksheet_id, worksheet_mapping_profile_id, worksheet_mapping_profile_version_id, staging_run_id, source_row_number)
       VALUES ('d4b-row-c3', $1, 'd4b-batch-c3', 'd4b-upload-c3', 'd4b-sv-a', 'd4b-ws-a', 'd4b-wp-a', 'd4b-wp-a-v1', 'd4b-run-c3', 2)`,
      ORG
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO data_hub_raw_cells (id, organisation_id, raw_row_id, source_schema_worksheet_id, source_schema_column_id, column_ordinal, source_header, raw_value, raw_value_type, sensitivity_class)
       VALUES ('d4b-cell-c3', $1, 'd4b-row-c3', 'd4b-ws-a', 'd4b-col-0', 0, 'Code', '"A1"'::jsonb, 'STRING', 'PUBLIC')`,
      ORG
    );

    // Delete the ORIGINAL run creator BEFORE completion.
    await prisma.user.delete({ where: { id: "d4b-user-creator" } });
    const runAfterDelete = await prisma.dataHubRawStagingRun.findUniqueOrThrow({ where: { id: "d4b-run-c3" } });
    expect(runAfterDelete.created_by).toBeNull();

    // Complete as a DIFFERENT, still-existing manager (d4b-user-b).
    const completion = await prisma.$queryRawUnsafe<Array<{ row_count: number }>>(
      `SELECT * FROM datahub_complete_raw_staging_run($1, $2, $3)`, "d4b-run-c3", ORG, "d4b-user-b"
    );
    expect(completion[0].row_count).toBe(1);

    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: "d4b-upload-c3" } });
    expect(upload.raw_staged_at).not.toBeNull();
    // The completing actor, NOT the (now-deleted) run creator.
    expect(upload.raw_staged_by).toBe("d4b-user-b");
    expect(upload.raw_staging_run_id).toBe("d4b-run-c3");

    const runAfter = await prisma.dataHubRawStagingRun.findUniqueOrThrow({ where: { id: "d4b-run-c3" } });
    expect(runAfter.status).toBe("SUCCEEDED");
  });

  it("extended uploads_raw_staging_coherence_check requires raw_staging_run_id alongside the other four completion fields", async () => {
    await prisma.importBatch.create({
      data: {
        id: "d4b-batch-coh", organisation_id: ORG, original_filename: "coh.xlsx", content_type: "xlsx",
        size_bytes: 1, sha256: "d".repeat(64), storage_provider: "proof", storage_key: "proof/d4b-coh", status: "READY",
        source_system_id: "d4b-ss-a", dataset_type_id: "d4b-dt-a", source_schema_version_id: "d4b-sv-a",
      },
    });
    await prisma.upload.create({
      data: {
        id: "d4b-upload-coh", organisation_id: ORG, original_name: "coh.xlsx", stored_path: "n/a",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 1,
        lineage_kind: "DATA_HUB", import_batch_id: "d4b-batch-coh", worksheet_index: 0, worksheet_name: "Data",
        worksheet_visibility: "visible", worksheet_is_empty: false, canonical_status: "AWAITING_CONFIRMATION",
      },
    });
    await expect(
      prisma.upload.update({
        where: { id: "d4b-upload-coh" },
        data: { raw_staged_at: new Date(), raw_staged_by: "d4b-user-b", raw_profile_version_id: "d4b-wp-a-v1", raw_row_count: 1, raw_cell_count: 1 },
      })
    ).rejects.toThrow();
  });
});
