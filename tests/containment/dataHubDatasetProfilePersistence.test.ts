import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

const MIGRATION = read("scripts/create-datahub-dataset-profiles.sql");
const CODE = stripComments(MIGRATION);
const ROLLBACK = read("scripts/rollback-datahub-dataset-profiles.sql");
const PRISMA = read("prisma/schema.prisma");

describe("6.2D4D1B1 — persistence scope", () => {
  it("creates only the profile run/column persistence tables", () => {
    expect(CODE).toContain("CREATE TABLE IF NOT EXISTS public.data_hub_dataset_profile_runs");
    expect(CODE).toContain("CREATE TABLE IF NOT EXISTS public.data_hub_dataset_profile_columns");
    expect(CODE).not.toMatch(/CREATE TABLE[^;]*(uploads|data_hub_normalized_rows|data_hub_normalized_cells)/i);
  });

  it("does not add an Upload profile pointer or profile completion metadata", () => {
    expect(CODE).not.toMatch(/ALTER TABLE public\.uploads\s+ADD COLUMN/i);
    for (const name of ["profiled_at", "profiled_by", "profile_run_id", "profiler_version"]) {
      expect(CODE).not.toMatch(new RegExp(`ADD COLUMN\\s+${name}\\b`, "i"));
    }
  });

  it("does not add executor, API, UI or profiler behavior", () => {
    expect(CODE).not.toMatch(/INSERT INTO public\.data_hub_dataset_profile_columns/i);
    expect(CODE).not.toMatch(/UPDATE public\.uploads/i);
    expect(CODE).not.toMatch(/normalized_value\s*=/i);
  });
});

describe("6.2D4D1B1 — exact lineage and tenancy", () => {
  it("pins the profile run to the exact normalization lineage", () => {
    expect(CODE).toContain("data_hub_normalization_runs_profile_lineage_key");
    const idx = CODE.indexOf("data_hub_dataset_profile_runs_normalization_lineage_fkey");
    const region = CODE.slice(idx, idx + 1200);
    expect(region).toContain("normalization_run_id");
    expect(region).toContain("import_batch_id");
    expect(region).toContain("upload_id");
    expect(region).toContain("source_schema_version_id");
    expect(region).toContain("source_schema_worksheet_id");
    expect(region).toContain("worksheet_mapping_profile_version_id");
    expect(region).toContain("organisation_id");
  });

  it("proves each profile column belongs to the pinned worksheet and governed source ordinal", () => {
    const runFk = CODE.slice(CODE.indexOf("data_hub_dataset_profile_columns_run_worksheet_fkey"), CODE.indexOf("data_hub_dataset_profile_columns_run_worksheet_fkey") + 600);
    expect(runFk).toContain("FOREIGN KEY (profile_run_id, source_schema_worksheet_id, organisation_id)");
    expect(runFk).toContain("data_hub_dataset_profile_runs(id, source_schema_worksheet_id, organisation_id)");

    const colFk = CODE.slice(CODE.indexOf("data_hub_dataset_profile_columns_source_column_fkey"), CODE.indexOf("data_hub_dataset_profile_columns_source_column_fkey") + 700);
    expect(colFk).toContain("FOREIGN KEY (source_schema_column_id, source_schema_worksheet_id, source_column_ordinal, organisation_id)");
    expect(colFk).toContain("source_schema_columns(id, source_schema_worksheet_id, ordinal, organisation_id)");
  });



  it("keeps D4D1A profile order distinct from governed source-column ordinal", () => {
    expect(CODE).toContain("source_column_ordinal integer NOT NULL");
    expect(CODE).toContain("UNIQUE (profile_run_id, ordinal)");
    const fkIdx = CODE.indexOf("data_hub_dataset_profile_columns_source_column_fkey");
    const fk = CODE.slice(fkIdx, fkIdx + 700);
    expect(fk).toContain("source_column_ordinal");
    expect(fk).toContain("REFERENCES public.source_schema_columns(id, source_schema_worksheet_id, ordinal, organisation_id)");
    const completeIdx = CODE.indexOf("Dataset profile completion ordinal reconciliation failed");
    const completeRegion = CODE.slice(Math.max(0, completeIdx - 800), completeIdx + 200);
    expect(completeRegion).toContain("min(ordinal)");
    expect(completeRegion).not.toContain("source_column_ordinal");
  });
  it("rejects cross-tenant initiating actors in the DB trigger", () => {
    const fn = CODE.slice(CODE.indexOf("datahub_guard_dataset_profile_run_lifecycle"), CODE.lastIndexOf("$fn$;"));
    expect(fn).toMatch(/NEW\.created_by IS NOT NULL AND NOT EXISTS/);
    expect(fn).toMatch(/id = NEW\.created_by AND organisation_id = NEW\.organisation_id/);
  });

  it("requires the exact source normalization run to be SUCCEEDED on insert and completion", () => {
    expect(CODE.match(/v_normalization_status IS DISTINCT FROM 'SUCCEEDED'/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("6.2D4D1B1 — lifecycle and immutable evidence", () => {
  it("allows only RUNNING | SUCCEEDED | FAILED | ABANDONED", () => {
    expect(CODE).toContain("status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED')");
  });

  it("permits at most one RUNNING profile per normalization run", () => {
    expect(CODE).toContain("idx_data_hub_dataset_profile_runs_one_running_per_normalization");
    expect(CODE).toContain("WHERE status = 'RUNNING'");
  });

  it("profile columns reject UPDATE and DELETE", () => {
    expect(CODE).toContain("datahub_guard_dataset_profile_column_immutable");
    expect(CODE).toMatch(/TG_OP = 'UPDATE' OR TG_OP = 'DELETE'/);
    expect(CODE).toContain("Dataset profile column evidence is immutable");
  });

  it("terminal profile runs are immutable apart from created_by ON DELETE SET NULL cleanup", () => {
    expect(CODE).toContain("Terminal dataset profile attempts are immutable");
    expect(CODE).toContain("to_jsonb(NEW) - 'created_by'");
  });

  it("run completion reconciles dataset counts, column counts, ordinals, per-column rows and cell totals", () => {
    expect(CODE).toContain("NEW.total_cell_count::numeric <> NEW.row_count::numeric * NEW.column_count::numeric");
    expect(CODE).toContain("NEW.non_null_cell_count + NEW.null_cell_count <> NEW.total_cell_count");
    expect(CODE).toContain("NEW.complete_row_count + NEW.incomplete_row_count <> NEW.row_count");
    expect(CODE).toContain("v_column_count <> NEW.column_count");
    expect(CODE).toContain("v_min_ordinal <> 0 OR v_max_ordinal <> NEW.column_count - 1");
    expect(CODE).toContain("v_bad_row_count <> 0");
    expect(CODE).toContain("v_sum_non_null <> NEW.non_null_cell_count");
    expect(CODE).toContain("v_sum_null <> NEW.null_cell_count");
  });
});

describe("6.2D4D1B1 — kind-specific persisted shape", () => {
  it("contains all 13 governed value kinds", () => {
    for (const kind of ["STRING","IDENTIFIER","INTEGER","DECIMAL","BOOLEAN","DATE","TIME","DATETIME","DURATION","PERCENTAGE","CURRENCY","LATITUDE","LONGITUDE"]) {
      expect(CODE).toContain(`'${kind}'`);
    }
  });

  it("separates string, boolean, numeric and temporal statistic families", () => {
    expect(CODE).toContain("data_hub_dataset_profile_columns_kind_stats_check");
    expect(CODE).toContain("value_kind IN ('STRING','IDENTIFIER')");
    expect(CODE).toContain("value_kind = 'BOOLEAN'");
    expect(CODE).toContain("value_kind IN ('INTEGER','DECIMAL','DURATION','PERCENTAGE','CURRENCY','LATITUDE','LONGITUDE')");
    expect(CODE).toContain("value_kind IN ('DATE','TIME','DATETIME')");
  });

  it("accepts the D4D1A all-null representation", () => {
    expect(CODE).toContain("non_null_count = 0 AND numeric_min IS NULL");
    expect(CODE).toContain("non_null_count = 0 AND temporal_min IS NULL");
    expect(CODE).toContain("non_null_count = 0 AND mean_length IS NULL");
  });
});

describe("6.2D4D1B1 — exact values and privacy", () => {
  it("stores ratios, exact numerics and temporals as String/Text in Prisma, never Float", () => {
    const start = PRISMA.indexOf("model DataHubDatasetProfileColumn");
    const end = PRISMA.indexOf("\nmodel ", start + 10);
    const model = PRISMA.slice(start, end === -1 ? PRISMA.length : end);
    for (const field of ["null_ratio","non_null_ratio","distinct_ratio","mean_length","numeric_min","numeric_max","numeric_sum","numeric_mean","temporal_min","temporal_max"]) {
      expect(model).toMatch(new RegExp(`\\b${field}\\s+String\\?`));
    }
    expect(model).not.toMatch(/\bFloat\??\b/);
  });

  it("has no persisted raw/normalized/example/sample/source-header/free-message value field", () => {
    const forbidden = ["raw_value","normalized_value","sample_value","example_value","source_header","failure_detail"];
    const start = PRISMA.indexOf("model DataHubDatasetProfileRun");
    const end = PRISMA.indexOf("\nmodel DashboardConfig", start);
    const models = PRISMA.slice(start, end);
    for (const field of forbidden) {
      expect(models).not.toMatch(new RegExp(`^\\s*${field}\\s`, "m"));
    }
    expect(CODE).toContain("Dataset profile persistence privacy drift");
  });

  it("profiler_version is mandatory and has no database default", () => {
    const start = PRISMA.indexOf("model DataHubDatasetProfileRun");
    const end = PRISMA.indexOf("\nmodel DataHubDatasetProfileColumn", start);
    const model = PRISMA.slice(start, end);
    expect(model).toMatch(/profiler_version\s+String\b/);
    expect(model).not.toMatch(/profiler_version[^\n]*@default/);
    expect(CODE).toContain("profiler_version text NOT NULL");
  });
});

describe("6.2D4D1B1 — Prisma mirror and rollback", () => {
  it("defines exactly the two new Prisma models", () => {
    expect(PRISMA).toContain("model DataHubDatasetProfileRun {");
    expect(PRISMA).toContain("model DataHubDatasetProfileColumn {");
  });

  it("uses BIGINT for all potentially large persisted counts", () => {
    for (const field of ["row_count","column_count","total_cell_count","non_null_cell_count","null_cell_count","complete_row_count","incomplete_row_count"]) {
      expect(PRISMA).toMatch(new RegExp(`\\b${field}\\s+BigInt\\?`));
    }
  });

  it("rollback is guarded by profile-attempt history and removes only D4D1B1 objects plus its additive normalization lineage key", () => {
    expect(ROLLBACK).toContain("Refusing rollback: data_hub_dataset_profile_runs contains");
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.data_hub_dataset_profile_columns");
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.data_hub_dataset_profile_runs");
    expect(ROLLBACK).toContain("DROP CONSTRAINT IF EXISTS data_hub_normalization_runs_profile_lineage_key");
    expect(ROLLBACK).not.toMatch(/DROP TABLE[^;]*data_hub_normalization_runs/i);
    expect(ROLLBACK).not.toMatch(/ALTER TABLE public\.uploads/i);
  });
});


describe("6.2D4D1B1 — hardened persisted-fact invariants", () => {
  it("caps persisted counts at D4D1A's Number.MAX_SAFE_INTEGER contract", () => {
    expect(CODE).toContain("data_hub_dataset_profile_runs_counts_safe_integer_check");
    expect(CODE).toContain("data_hub_dataset_profile_columns_safe_integer_check");
    expect(CODE).toContain("9007199254740991");
  });

  it("requires structural flags to agree exactly with their persisted counts", () => {
    expect(CODE).toContain("data_hub_dataset_profile_columns_flags_coherence_check");
    expect(CODE).toContain("is_all_null = (row_count > 0 AND non_null_count = 0)");
    expect(CODE).toContain("is_complete = (null_count = 0)");
    expect(CODE).toContain("is_sparse = (row_count > 0 AND non_null_count > 0 AND non_null_count < row_count)");
    expect(CODE).toContain("is_constant = (distinct_non_null_count = 1)");
    expect(CODE).toContain("is_unique_among_non_null = (non_null_count > 0 AND distinct_non_null_count = non_null_count)");
  });

  it("accepts only canonical plain-decimal text for ratios/means/numeric statistics", () => {
    expect(CODE).toContain("data_hub_dataset_profile_columns_canonical_decimal_text_check");
    expect(CODE).toContain("numeric_mean IS NULL OR numeric_mean ~");
    expect(CODE).not.toContain("DOUBLE PRECISION");
    expect(CODE).not.toContain("REAL");
  });

  it("contains an explicit idempotent schema-drift verifier and checks the RUNNING partial unique index shape", () => {
    expect(CODE).toContain("Dataset profile migration drift:");
    expect(CODE).toContain("pg_get_indexdef");
    expect(CODE).toContain("RUNNING uniqueness index has the wrong shape");
    expect(CODE).toContain("required validated constraint");
  });
});
