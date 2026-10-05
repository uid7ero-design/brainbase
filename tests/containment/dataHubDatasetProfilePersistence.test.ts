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
    // Matches only a CREATE TABLE whose TARGET is one of these forbidden
    // tables -- not merely a FOREIGN KEY ... REFERENCES clause naming
    // "uploads" from within the (expected, required) profile_runs table
    // definition, which the original broader `[^;]*` form false-positived
    // on.
    expect(CODE).not.toMatch(/CREATE TABLE\s+(IF NOT EXISTS\s+)?(public\.)?(uploads|data_hub_normalized_rows|data_hub_normalized_cells)\b/i);
  });

  it("does not add an Upload profile pointer or profile completion metadata", () => {
    expect(CODE).not.toMatch(/ALTER TABLE public\.uploads\s+ADD COLUMN/i);
    for (const name of ["profiled_at", "profiled_by", "profile_run_id", "profiler_version"]) {
      expect(CODE).not.toMatch(new RegExp(`ADD COLUMN\\s+${name}\\b`, "i"));
    }
  });

  it("leaves pre-existing Upload row/column count Prisma types unchanged", () => {
    const start = PRISMA.indexOf("model Upload {");
    const end = PRISMA.indexOf("\nmodel ", start + 10);
    const upload = PRISMA.slice(start, end === -1 ? PRISMA.length : end);
    expect(upload).toMatch(/\brow_count\s+Int\?/);
    expect(upload).toMatch(/\bcolumn_count\s+Int\?/);
    expect(upload).not.toMatch(/\brow_count\s+BigInt\?/);
    expect(upload).not.toMatch(/\bcolumn_count\s+BigInt\?/);
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

  it("pins the profile run to Upload's authoritative normalization_run_id", () => {
    expect(CODE).toContain("uploads_id_normalization_run_organisation_key");
    const idx = CODE.indexOf("data_hub_dataset_profile_runs_authoritative_normalization_fkey");
    const region = CODE.slice(idx, idx + 500);
    expect(region).toContain("FOREIGN KEY (upload_id, normalization_run_id, organisation_id)");
    expect(region).toContain("REFERENCES public.uploads(id, normalization_run_id, organisation_id)");
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
    // 1400: the trigger's own SELECT (which computes min(ordinal)) sits
    // ~1245 chars before this message in the function body; 800 was too
    // short to ever reach it.
    const completeRegion = CODE.slice(Math.max(0, completeIdx - 1400), completeIdx + 200);
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

  it("ABANDONED is terminal history, not a profiling failure", () => {
    const stateIdx = CODE.indexOf("data_hub_dataset_profile_runs_state_coherence_check");
    const state = CODE.slice(stateIdx, stateIdx + 3200);
    expect(state).toContain("status = 'FAILED'");
    expect(state).toContain("failed_at IS NOT NULL");
    expect(state).toContain("failure_code IS NOT NULL");
    expect(state).toContain("status = 'ABANDONED'");
    expect(state).toContain("failed_at IS NULL");
    expect(state).toContain("failure_code IS NULL");
  });

  it("terminal profile runs are immutable apart from created_by ON DELETE SET NULL cleanup", () => {
    expect(CODE).toContain("Terminal dataset profile attempts are immutable");
    expect(CODE).toContain("to_jsonb(NEW) - 'created_by'");
  });

  it("run completion reconciles dataset counts, complete governed-column coverage, ordinals, per-column rows and cell totals", () => {
    expect(CODE).toContain("NEW.total_cell_count::numeric <> NEW.row_count::numeric * NEW.column_count::numeric");
    expect(CODE).toContain("NEW.non_null_cell_count + NEW.null_cell_count <> NEW.total_cell_count");
    expect(CODE).toContain("NEW.complete_row_count + NEW.incomplete_row_count <> NEW.row_count");
    expect(CODE).toContain("v_column_count <> NEW.column_count");
    expect(CODE).toContain("v_governed_column_count <> NEW.column_count");
    expect(CODE).toContain("FROM public.source_schema_columns");
    expect(CODE).toContain("Dataset profile completion governed column count reconciliation failed");
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

  it("preserves upstream unit-pair coherence without duplicating the deferred unit-family matrix", () => {
    const idx = CODE.indexOf("data_hub_dataset_profile_columns_units_check");
    const check = CODE.slice(idx, idx + 900);
    expect(check).toContain("(source_unit IS NULL) = (normalized_unit IS NULL)");
    expect(check).not.toContain("MASS");
    expect(check).not.toContain("LENGTH");
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
    expect(ROLLBACK).toContain("DROP CONSTRAINT IF EXISTS uploads_id_normalization_run_organisation_key");
    expect(ROLLBACK).not.toMatch(/DROP TABLE[^;]*data_hub_normalization_runs/i);
    // Rollback may remove only the additive UNIQUE proof constraint on uploads;
    // it must never add/drop/mutate Upload profile state columns.
    expect(ROLLBACK).not.toMatch(/ALTER TABLE public\.uploads[\s\S]*DROP COLUMN/i);
    expect(ROLLBACK).not.toMatch(/ALTER TABLE public\.uploads[\s\S]*ADD COLUMN/i);
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

  it("accepts only canonical plain-decimal text and structural D4D1A ranges", () => {
    expect(CODE).toContain("data_hub_dataset_profile_columns_canonical_decimal_text_check");
    expect(CODE).toContain("data_hub_dataset_profile_columns_ratio_range_check");
    expect(CODE).toContain("null_ratio::numeric BETWEEN 0 AND 1");
    expect(CODE).toContain("non_null_ratio::numeric BETWEEN 0 AND 1");
    expect(CODE).toContain("distinct_ratio::numeric BETWEEN 0 AND 1");
    expect(CODE).toContain("mean_length::numeric >= 0");
    expect(CODE).toContain("numeric_mean IS NULL OR numeric_mean ~");
    expect(CODE).not.toContain("DOUBLE PRECISION");
    expect(CODE).not.toContain("REAL");
  });

  it("pairs the named Prisma relations on both sides", () => {
    expect(PRISMA).toContain('@relation("UploadDatasetProfileRuns", fields: [upload_id, import_batch_id, organisation_id]');
    expect(PRISMA).toContain('dataset_profile_runs DataHubDatasetProfileRun[] @relation("UploadDatasetProfileRuns")');
    expect(PRISMA).toContain('@relation("NormalizationDatasetProfileRuns", fields: [normalization_run_id, import_batch_id, upload_id');
    expect(PRISMA).toContain('dataset_profile_runs DataHubDatasetProfileRun[] @relation("NormalizationDatasetProfileRuns")');
  });

  it("contains an explicit idempotent schema-drift verifier and checks every D4D1B1 index shape", () => {
    expect(CODE).toContain("Dataset profile migration drift:");
    expect(CODE).toContain("pg_get_indexdef");
    expect(CODE).toContain("RUNNING uniqueness index has the wrong shape");
    for (const indexName of [
      "idx_data_hub_dataset_profile_runs_org_upload",
      "idx_data_hub_dataset_profile_runs_normalization",
      "idx_data_hub_dataset_profile_columns_org_run",
      "idx_data_hub_dataset_profile_columns_source_column",
    ]) {
      expect(CODE).toContain(indexName);
    }
    expect(CODE).toContain("Dataset profile migration drift: index % has the wrong shape");
    expect(CODE).toContain("required validated constraint");
  });
});
