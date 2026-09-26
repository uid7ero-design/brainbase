// Data Hub 6.2D4A — real disposable-Postgres proof for
// scripts/create-datahub-raw-staging.sql.
//
// This proof must only run against a throwaway postgres:16-alpine container
// on port 55565. The container must already contain the current main Prisma
// schema; this file applies the real D4A migration twice itself before
// exercising the catalog and behavioral invariants.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL?.includes("55565")) {
  throw new Error(
    "Refusing to run: DATABASE_URL does not point at the disposable D4A proof container (port 55565)."
  );
}

const CONTAINER = process.env.DATAHUB_D4A_PROOF_CONTAINER;
if (!CONTAINER) {
  throw new Error("DATAHUB_D4A_PROOF_CONTAINER must name the disposable postgres container.");
}

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION_SQL = fs.readFileSync(path.join(ROOT, "scripts/create-datahub-raw-staging.sql"), "utf8");

function psql(sql: string): string {
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER as string, "psql", "-X", "-q", "-U", "postgres", "-d", "testdb", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" }
  );
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status !== 0) throw new Error(combined || `psql exited ${result.status}`);
  return combined;
}

const prisma = new PrismaClient();

describe("6.2D4A raw staging foundation — real disposable Postgres proof", () => {
  beforeAll(async () => {
    // First apply + idempotent second apply of the real migration.
    psql(MIGRATION_SQL);
    psql(MIGRATION_SQL);

    await prisma.organisation.createMany({
      data: [
        { id: "d4a-org-a", name: "D4A Org A", slug: "d4a-org-a" },
        { id: "d4a-org-b", name: "D4A Org B", slug: "d4a-org-b" },
      ],
    });

    await prisma.user.createMany({
      data: [
        { id: "d4a-stage-a", organisation_id: "d4a-org-a", username: "d4a-stage-a", name: "D4A Stage A" },
        { id: "d4a-stage-a2", organisation_id: "d4a-org-a", username: "d4a-stage-a2", name: "D4A Stage A2" },
        { id: "d4a-stage-b", organisation_id: "d4a-org-b", username: "d4a-stage-b", name: "D4A Stage B" },
      ],
    });

    await prisma.sourceSystem.createMany({
      data: [
        { id: "d4a-ss-a", organisation_id: "d4a-org-a", name: "D4A Source A", active: true },
        { id: "d4a-ss-b", organisation_id: "d4a-org-b", name: "D4A Source B", active: true },
      ],
    });

    await prisma.datasetType.createMany({
      data: [
        { id: "d4a-dt-a", organisation_id: "d4a-org-a", source_system_id: "d4a-ss-a", name: "D4A Dataset A", active: true },
        { id: "d4a-dt-b", organisation_id: "d4a-org-b", source_system_id: "d4a-ss-b", name: "D4A Dataset B", active: true },
      ],
    });

    await prisma.sourceSchemaVersion.createMany({
      data: [
        { id: "d4a-sv-a", organisation_id: "d4a-org-a", dataset_type_id: "d4a-dt-a", version_number: 1, label: "D4A Schema A", status: "ACTIVE", activated_at: new Date() },
        { id: "d4a-sv-b", organisation_id: "d4a-org-b", dataset_type_id: "d4a-dt-b", version_number: 1, label: "D4A Schema B", status: "ACTIVE", activated_at: new Date() },
      ],
    });

    await prisma.sourceSchemaWorksheet.createMany({
      data: [
        { id: "d4a-ws-a", organisation_id: "d4a-org-a", source_schema_version_id: "d4a-sv-a", logical_key: "data", expected_name: "Data", ordinal_hint: 0, presence: "REQUIRED", role: "DATA" },
        { id: "d4a-ws-a2", organisation_id: "d4a-org-a", source_schema_version_id: "d4a-sv-a", logical_key: "other", expected_name: "Other", ordinal_hint: 1, presence: "OPTIONAL", role: "DATA" },
        { id: "d4a-ws-b", organisation_id: "d4a-org-b", source_schema_version_id: "d4a-sv-b", logical_key: "data", expected_name: "Data", ordinal_hint: 0, presence: "REQUIRED", role: "DATA" },
      ],
    });

    await prisma.sourceSchemaColumn.createMany({
      data: [
        { id: "d4a-col-a0", organisation_id: "d4a-org-a", source_schema_worksheet_id: "d4a-ws-a", ordinal: 0, source_header: "Code", presence: "REQUIRED", declared_type: "STRING", sensitivity_class: "PUBLIC" },
        { id: "d4a-col-a1", organisation_id: "d4a-org-a", source_schema_worksheet_id: "d4a-ws-a", ordinal: 1, source_header: "Amount", presence: "OPTIONAL", declared_type: "DECIMAL", sensitivity_class: "INTERNAL" },
        { id: "d4a-col-a2", organisation_id: "d4a-org-a", source_schema_worksheet_id: "d4a-ws-a", ordinal: 2, source_header: "Flag", presence: "OPTIONAL", declared_type: "BOOLEAN", sensitivity_class: "INTERNAL" },
        { id: "d4a-col-a3", organisation_id: "d4a-org-a", source_schema_worksheet_id: "d4a-ws-a", ordinal: 3, source_header: "Optional", presence: "OPTIONAL", declared_type: "UNKNOWN", sensitivity_class: "CONFIDENTIAL" },
        { id: "d4a-col-a-other", organisation_id: "d4a-org-a", source_schema_worksheet_id: "d4a-ws-a2", ordinal: 0, source_header: "Elsewhere", presence: "OPTIONAL", declared_type: "STRING", sensitivity_class: "PUBLIC" },
        { id: "d4a-col-b0", organisation_id: "d4a-org-b", source_schema_worksheet_id: "d4a-ws-b", ordinal: 0, source_header: "Code", presence: "REQUIRED", declared_type: "STRING", sensitivity_class: "PUBLIC" },
      ],
    });

    for (const [id, org, ws, name] of [
      ["d4a-wp-a", "d4a-org-a", "d4a-ws-a", "Profile A"],
      ["d4a-wp-a-alt", "d4a-org-a", "d4a-ws-a", "Profile A Alt"],
      ["d4a-wp-a2", "d4a-org-a", "d4a-ws-a2", "Profile A2"],
      ["d4a-wp-b", "d4a-org-b", "d4a-ws-b", "Profile B"],
    ] as const) {
      await prisma.worksheetMappingProfile.create({
        data: { id, organisation_id: org, source_schema_worksheet_id: ws, name, active: true },
      });
      await prisma.worksheetMappingProfileVersion.create({
        data: {
          id: `${id}-v1`,
          organisation_id: org,
          worksheet_mapping_profile_id: id,
          version_number: 1,
          disposition: "STAGING_DATASET",
          profile_document: { documentVersion: 1, headerRowOneBased: 1 },
        },
      });
      await prisma.worksheetMappingProfile.update({
        where: { id },
        data: { active_profile_version_id: `${id}-v1` },
      });
    }

    await prisma.importBatch.createMany({
      data: [
        {
          id: "d4a-batch-a", organisation_id: "d4a-org-a", original_filename: "a.xlsx", content_type: "xlsx",
          size_bytes: 123, sha256: "a".repeat(64), storage_provider: "proof", storage_key: "proof/d4a-a", status: "READY",
          source_system_id: "d4a-ss-a", dataset_type_id: "d4a-dt-a", source_schema_version_id: "d4a-sv-a",
        },
        {
          id: "d4a-batch-b", organisation_id: "d4a-org-b", original_filename: "b.xlsx", content_type: "xlsx",
          size_bytes: 123, sha256: "b".repeat(64), storage_provider: "proof", storage_key: "proof/d4a-b", status: "READY",
          source_system_id: "d4a-ss-b", dataset_type_id: "d4a-dt-b", source_schema_version_id: "d4a-sv-b",
        },
      ],
    });

    await prisma.upload.createMany({
      data: [
        {
          id: "d4a-upload-a", organisation_id: "d4a-org-a", original_name: "a.xlsx", stored_path: "n/a",
          mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 123,
          lineage_kind: "DATA_HUB", import_batch_id: "d4a-batch-a", worksheet_index: 0, worksheet_name: "Data",
          worksheet_visibility: "visible", worksheet_is_empty: false, canonical_status: "AWAITING_CONFIRMATION",
        },
        {
          id: "d4a-upload-b", organisation_id: "d4a-org-b", original_name: "b.xlsx", stored_path: "n/a",
          mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 123,
          lineage_kind: "DATA_HUB", import_batch_id: "d4a-batch-b", worksheet_index: 0, worksheet_name: "Data",
          worksheet_visibility: "visible", worksheet_is_empty: false, canonical_status: "AWAITING_CONFIRMATION",
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("catalog has the complete first-pass D4A FK/trigger set after an idempotent rerun", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; fk_count: bigint }>>(`
      SELECT t.relname AS table_name, count(*)::bigint AS fk_count
      FROM pg_constraint c
      JOIN pg_class t ON t.oid=c.conrelid
      WHERE c.contype='f' AND t.relname IN ('data_hub_raw_rows','data_hub_raw_cells')
      GROUP BY t.relname ORDER BY t.relname
    `);
    expect(rows.map((r) => [r.table_name, Number(r.fk_count)])).toEqual([
      ["data_hub_raw_cells", 3],
      ["data_hub_raw_rows", 8],
    ]);

    const triggers = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'datahub_guard_upload_raw_staging_metadata',
          'datahub_guard_raw_row_immutable',
          'datahub_guard_raw_cell_immutable'
        )
      ORDER BY tgname
    `);
    expect(triggers.map((r) => r.tgname)).toEqual([
      "datahub_guard_raw_cell_immutable",
      "datahub_guard_raw_row_immutable",
      "datahub_guard_upload_raw_staging_metadata",
    ]);
  });

  it("partial Upload staging is rejected; complete staging is accepted without changing canonical_status", async () => {
    await expect(
      prisma.upload.update({ where: { id: "d4a-upload-a" }, data: { raw_staged_at: new Date() } })
    ).rejects.toThrow();

    await prisma.upload.update({
      where: { id: "d4a-upload-a" },
      data: {
        raw_staged_at: new Date(),
        raw_staged_by: "d4a-stage-a",
        raw_profile_version_id: "d4a-wp-a-v1",
        raw_row_count: 2,
        raw_cell_count: 4,
      },
    });

    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: "d4a-upload-a" } });
    expect(upload.canonical_status).toBe("AWAITING_CONFIRMATION");
    expect(upload.raw_profile_version_id).toBe("d4a-wp-a-v1");
  });

  it("valid raw row/cells preserve 1-based row identity, leading-zero string and scalar JSON types", async () => {
    await prisma.dataHubRawRow.create({
      data: {
        id: "d4a-rr-a", organisation_id: "d4a-org-a", import_batch_id: "d4a-batch-a", upload_id: "d4a-upload-a",
        source_schema_version_id: "d4a-sv-a", source_schema_worksheet_id: "d4a-ws-a",
        worksheet_mapping_profile_id: "d4a-wp-a", worksheet_mapping_profile_version_id: "d4a-wp-a-v1",
        source_row_number: 2, created_by: "d4a-stage-a",
      },
    });

    await prisma.dataHubRawCell.createMany({
      data: [
        { id: "d4a-rc-a0", organisation_id: "d4a-org-a", raw_row_id: "d4a-rr-a", source_schema_worksheet_id: "d4a-ws-a", source_schema_column_id: "d4a-col-a0", column_ordinal: 0, source_header: "Code", raw_value: "00123", raw_value_type: "STRING", sensitivity_class: "PUBLIC" },
        { id: "d4a-rc-a1", organisation_id: "d4a-org-a", raw_row_id: "d4a-rr-a", source_schema_worksheet_id: "d4a-ws-a", source_schema_column_id: "d4a-col-a1", column_ordinal: 1, source_header: "Amount", raw_value: 42.5, raw_value_type: "NUMBER", sensitivity_class: "INTERNAL" },
        { id: "d4a-rc-a2", organisation_id: "d4a-org-a", raw_row_id: "d4a-rr-a", source_schema_worksheet_id: "d4a-ws-a", source_schema_column_id: "d4a-col-a2", column_ordinal: 2, source_header: "Flag", raw_value: true, raw_value_type: "BOOLEAN", sensitivity_class: "INTERNAL" },
        { id: "d4a-rc-a3", organisation_id: "d4a-org-a", raw_row_id: "d4a-rr-a", source_schema_worksheet_id: "d4a-ws-a", source_schema_column_id: "d4a-col-a3", column_ordinal: 3, source_header: "Optional", raw_value: null, raw_value_type: "NULL", sensitivity_class: "CONFIDENTIAL" },
      ],
    });

    const cells = await prisma.dataHubRawCell.findMany({ where: { raw_row_id: "d4a-rr-a" }, orderBy: { column_ordinal: "asc" } });
    expect(cells[0].raw_value).toBe("00123");
    expect(cells[1].raw_value).toBe(42.5);
    expect(cells[2].raw_value).toBe(true);
    expect(cells[3].raw_value).toBeNull();
  });

  it("DB rejects cross-tenant, wrong-worksheet and wrong-profile raw row lineage", async () => {
    const base = {
      import_batch_id: "d4a-batch-a",
      upload_id: "d4a-upload-a",
      source_schema_version_id: "d4a-sv-a",
      source_row_number: 3,
    };

    await expect(prisma.dataHubRawRow.create({
      data: {
        id: "d4a-bad-tenant", organisation_id: "d4a-org-b", ...base,
        source_schema_worksheet_id: "d4a-ws-a", worksheet_mapping_profile_id: "d4a-wp-a",
        worksheet_mapping_profile_version_id: "d4a-wp-a-v1",
      },
    })).rejects.toThrow();

    await expect(prisma.dataHubRawRow.create({
      data: {
        id: "d4a-bad-sheet", organisation_id: "d4a-org-a", ...base,
        source_schema_worksheet_id: "d4a-ws-a2", worksheet_mapping_profile_id: "d4a-wp-a2",
        worksheet_mapping_profile_version_id: "d4a-wp-a2-v1",
      },
    })).rejects.toThrow();

    await expect(prisma.dataHubRawRow.create({
      data: {
        id: "d4a-bad-profile", organisation_id: "d4a-org-a", ...base,
        source_schema_worksheet_id: "d4a-ws-a", worksheet_mapping_profile_id: "d4a-wp-a-alt",
        worksheet_mapping_profile_version_id: "d4a-wp-a-alt-v1",
      },
    })).rejects.toThrow();
  });

  it("DB rejects invalid row numbers, duplicate source rows, wrong cell metadata and non-scalar/mismatched JSON", async () => {
    await expect(prisma.dataHubRawRow.create({
      data: {
        id: "d4a-row-zero", organisation_id: "d4a-org-a", import_batch_id: "d4a-batch-a", upload_id: "d4a-upload-a",
        source_schema_version_id: "d4a-sv-a", source_schema_worksheet_id: "d4a-ws-a",
        worksheet_mapping_profile_id: "d4a-wp-a", worksheet_mapping_profile_version_id: "d4a-wp-a-v1",
        source_row_number: 0,
      },
    })).rejects.toThrow();

    await expect(prisma.dataHubRawRow.create({
      data: {
        id: "d4a-row-dup", organisation_id: "d4a-org-a", import_batch_id: "d4a-batch-a", upload_id: "d4a-upload-a",
        source_schema_version_id: "d4a-sv-a", source_schema_worksheet_id: "d4a-ws-a",
        worksheet_mapping_profile_id: "d4a-wp-a", worksheet_mapping_profile_version_id: "d4a-wp-a-v1",
        source_row_number: 2,
      },
    })).rejects.toThrow();

    await prisma.dataHubRawRow.create({
      data: {
        id: "d4a-rr-probe", organisation_id: "d4a-org-a", import_batch_id: "d4a-batch-a", upload_id: "d4a-upload-a",
        source_schema_version_id: "d4a-sv-a", source_schema_worksheet_id: "d4a-ws-a",
        worksheet_mapping_profile_id: "d4a-wp-a", worksheet_mapping_profile_version_id: "d4a-wp-a-v1",
        source_row_number: 3,
      },
    });

    await expect(prisma.dataHubRawCell.create({
      data: { id: "d4a-bad-header", organisation_id: "d4a-org-a", raw_row_id: "d4a-rr-probe", source_schema_worksheet_id: "d4a-ws-a", source_schema_column_id: "d4a-col-a0", column_ordinal: 0, source_header: "Wrong", raw_value: "x", raw_value_type: "STRING", sensitivity_class: "PUBLIC" },
    })).rejects.toThrow();

    await expect(prisma.dataHubRawCell.create({
      data: { id: "d4a-bad-sensitivity", organisation_id: "d4a-org-a", raw_row_id: "d4a-rr-probe", source_schema_worksheet_id: "d4a-ws-a", source_schema_column_id: "d4a-col-a0", column_ordinal: 0, source_header: "Code", raw_value: "x", raw_value_type: "STRING", sensitivity_class: "INTERNAL" },
    })).rejects.toThrow();

    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO data_hub_raw_cells
      (id,organisation_id,raw_row_id,source_schema_worksheet_id,source_schema_column_id,column_ordinal,source_header,raw_value,raw_value_type,sensitivity_class)
      VALUES ('d4a-bad-object','d4a-org-a','d4a-rr-probe','d4a-ws-a','d4a-col-a0',0,'Code','{"x":1}'::jsonb,'STRING','PUBLIC')
    `)).rejects.toThrow();

    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO data_hub_raw_cells
      (id,organisation_id,raw_row_id,source_schema_worksheet_id,source_schema_column_id,column_ordinal,source_header,raw_value,raw_value_type,sensitivity_class)
      VALUES ('d4a-bad-discriminator','d4a-org-a','d4a-rr-probe','d4a-ws-a','d4a-col-a0',0,'Code','123'::jsonb,'STRING','PUBLIC')
    `)).rejects.toThrow();
  });

  it("raw evidence and completed staging metadata are immutable", async () => {
    await expect(
      prisma.dataHubRawRow.update({ where: { id: "d4a-rr-a" }, data: { source_row_number: 99 } })
    ).rejects.toThrow();

    await expect(
      prisma.dataHubRawCell.delete({ where: { id: "d4a-rc-a0" } })
    ).rejects.toThrow();

    await expect(
      prisma.upload.update({ where: { id: "d4a-upload-a" }, data: { raw_row_count: 99 } })
    ).rejects.toThrow();

    await expect(
      prisma.upload.update({ where: { id: "d4a-upload-a" }, data: { raw_staged_by: "d4a-stage-a2" } })
    ).rejects.toThrow();
  });

  it("actor deletion may null attribution only; evidence/profile/counts remain intact", async () => {
    await prisma.user.delete({ where: { id: "d4a-stage-a" } });

    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: "d4a-upload-a" } });
    expect(upload.raw_staged_by).toBeNull();
    expect(upload.raw_profile_version_id).toBe("d4a-wp-a-v1");
    expect(upload.raw_row_count).toBe(2);
    expect(upload.raw_cell_count).toBe(4);

    const rows = await prisma.dataHubRawRow.findMany({
      where: { id: { in: ["d4a-rr-a", "d4a-rr-probe"] } },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.created_by === null)).toBe(true);
  });
});
