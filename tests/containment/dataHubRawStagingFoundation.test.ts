import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SQL = read("scripts/create-datahub-raw-staging.sql");
const PRISMA = read("prisma/schema.prisma");

describe("6.2D4A raw staging foundation — static containment", () => {
  it("adds only the two raw evidence models/tables and Upload staging metadata", () => {
    expect(PRISMA).toContain("model DataHubRawRow {");
    expect(PRISMA).toContain('@@map("data_hub_raw_rows")');
    expect(PRISMA).toContain("model DataHubRawCell {");
    expect(PRISMA).toContain('@@map("data_hub_raw_cells")');
    for (const field of [
      "raw_staged_at",
      "raw_staged_by",
      "raw_profile_version_id",
      "raw_row_count",
      "raw_cell_count",
    ]) {
      expect(PRISMA).toContain(field);
    }
  });

  it("does not repurpose canonical_status or introduce canonical/domain writes", () => {
    const withoutComments = SQL.replace(/--.*$/gm, "");
    expect(withoutComments).not.toMatch(/UPDATE\s+public\.uploads\s+SET\s+canonical_status/i);
    expect(withoutComments).not.toMatch(/INSERT\s+INTO\s+public\.(illegal_dumping|service_requests|missed_collections|debtor_accounts|metrics)/i);
  });

  it("creates the strict raw-row lineage chain including exact Upload profile-version coherence", () => {
    for (const name of [
      "data_hub_raw_rows_batch_schema_org_fkey",
      "data_hub_raw_rows_upload_batch_org_fkey",
      "data_hub_raw_rows_upload_profile_version_org_fkey",
      "data_hub_raw_rows_schema_worksheet_fkey",
      "data_hub_raw_rows_mapping_profile_fkey",
      "data_hub_raw_rows_mapping_profile_version_fkey",
      "data_hub_raw_rows_created_by_fkey",
      "data_hub_raw_rows_organisation_id_fkey",
    ]) {
      expect(SQL).toContain(name);
    }
    expect(SQL).toContain("uploads_id_raw_profile_version_organisation_key");
  });

  it("binds every raw cell to exact governed worksheet, ordinal, header and sensitivity", () => {
    expect(SQL).toContain("source_schema_columns_raw_evidence_key");
    expect(SQL).toContain("data_hub_raw_cells_schema_column_fkey");
    expect(SQL).toContain(
      "source_schema_column_id, source_schema_worksheet_id, column_ordinal, source_header, sensitivity_class, organisation_id"
    );
  });

  it("raw JSON is restricted to truthful scalar discriminators", () => {
    expect(SQL).toContain("data_hub_raw_cells_value_type_check");
    expect(SQL).toContain("data_hub_raw_cells_value_shape_check");
    expect(SQL).toContain("jsonb_typeof(raw_value) = 'string'");
    expect(SQL).toContain("jsonb_typeof(raw_value) = 'number'");
    expect(SQL).toContain("jsonb_typeof(raw_value) = 'boolean'");
    expect(SQL).toContain("raw_value = 'null'::jsonb");
  });

  it("raw evidence is immutable except actor SET NULL; Upload staging is one-way", () => {
    expect(SQL).toContain("datahub_guard_raw_row_immutable");
    expect(SQL).toContain("datahub_guard_raw_cell_immutable");
    expect(SQL).toContain("OLD.created_by IS NOT NULL");
    expect(SQL).toContain("NEW.created_by IS NULL");
    expect(SQL).toContain("datahub_guard_upload_raw_staging_metadata");
    expect(SQL).toContain("raw staging metadata is immutable once completed");
  });

  it("migration is transaction wrapped and contains no data backfill", () => {
    expect((SQL.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((SQL.match(/^COMMIT;$/gm) ?? []).length).toBe(1);

    const withoutFunctions = SQL.replace(/\$fn\$[\s\S]*?\$fn\$/g, "");
    expect(withoutFunctions).not.toMatch(/^\s*INSERT\s+INTO\s+public\./im);
    expect(withoutFunctions).not.toMatch(/^\s*DELETE\s+FROM\s+public\./im);
    expect(withoutFunctions).not.toMatch(/^\s*UPDATE\s+public\./im);
  });

  it("CSV / D3C / D3D implementation files are not coupled to D4A raw tables", () => {
    for (const rel of [
      "lib/data-hub/importBatch/confirmWorksheet.ts",
      "lib/data-hub/importBatch/reconciliation.ts",
      "lib/data-hub/importBatch/illegalDumpingMapper.ts",
      "lib/data-hub/schemaMatch/matchImportBatchSchema.ts",
      "lib/data-hub/schemaMatch/establishImportBatchSchemaLineage.ts",
    ]) {
      expect(read(rel), rel).not.toMatch(/dataHubRawRow|dataHubRawCell|data_hub_raw_rows|data_hub_raw_cells/);
    }
  });
});
