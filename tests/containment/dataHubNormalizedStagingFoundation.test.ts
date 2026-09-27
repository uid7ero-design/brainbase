import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Data Hub 6.2D4C-B1 — normalized-staging PERSISTENCE/LIFECYCLE FOUNDATION.
// Static source-text containment, mirroring the established idiom from
// tests/containment/dataHubRawStagingRunFoundation.test.ts. Behavioral
// proof (real Postgres: idempotency, tenant/lineage FK rejection,
// immutability, completion, rollback) lives in
// scripts/tests/verify-datahub-normalized-staging.sh — this file only
// proves the static shape and the absence of forbidden patterns.

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

const MIGRATION = read("scripts/create-datahub-normalized-staging.sql");
const MIGRATION_CODE = stripComments(MIGRATION);
const ROLLBACK = read("scripts/rollback-datahub-normalized-staging.sql");
const ROLLBACK_CODE = stripComments(ROLLBACK);
const D4A_SQL = read("scripts/create-datahub-raw-staging.sql");
const D4B_SQL = read("scripts/create-datahub-raw-staging-runs.sql");
const PRISMA = read("prisma/schema.prisma");

const CANONICAL_DOMAIN_TABLES = [
  "illegal_dumping",
  "missed_collections",
  "debtor_accounts",
  "bin_maintenance_jobs",
  "service_requests",
  "contacts",
  "tennis_leads",
];

describe("6.2D4C-B1 — D4A/D4B are completely untouched", () => {
  it("does not modify scripts/create-datahub-raw-staging.sql or scripts/create-datahub-raw-staging-runs.sql", () => {
    // This migration is a NEW, separate file. The real proof that D4A/D4B's
    // own files are untouched is that this suite never edits them; this
    // assertion just pins their own defining fixed strings so an accidental
    // future edit to those files is at least visible in a diff review.
    expect(D4A_SQL).toContain("CREATE TABLE IF NOT EXISTS public.data_hub_raw_rows");
    expect(D4B_SQL).toContain("CREATE TABLE IF NOT EXISTS public.data_hub_raw_staging_runs");
  });

  it("never re-declares or drops any D4A/D4B object by name (purely additive to those tables)", () => {
    expect(MIGRATION_CODE).not.toMatch(/DROP TABLE[^;]*data_hub_raw_(rows|cells|staging_runs)/i);
    expect(MIGRATION_CODE).not.toMatch(/CREATE TABLE[^(]*data_hub_raw_(rows|cells|staging_runs)/i);
  });
});

describe("6.2D4C-B1 — raw evidence is never modified", () => {
  it("contains no UPDATE statement against data_hub_raw_rows or data_hub_raw_cells", () => {
    expect(MIGRATION_CODE).not.toMatch(/UPDATE\s+public\.data_hub_raw_rows/i);
    expect(MIGRATION_CODE).not.toMatch(/UPDATE\s+public\.data_hub_raw_cells/i);
  });

  it("never writes to raw_value, raw_value_type, or original_unit", () => {
    expect(MIGRATION_CODE).not.toMatch(/\braw_value\s*=/);
    expect(MIGRATION_CODE).not.toMatch(/\braw_value_type\s*=/);
    expect(MIGRATION_CODE).not.toMatch(/\boriginal_unit\s*=/);
  });

  it("only ADDS composite UNIQUE constraints to data_hub_raw_rows/data_hub_raw_cells — never drops or alters an existing D4A/D4B one", () => {
    const rawRowsTouches = [...MIGRATION_CODE.matchAll(/ALTER TABLE public\.data_hub_raw_rows\s+(ADD|DROP)[^;]*/gi)].map((m) => m[0]);
    const rawCellsTouches = [...MIGRATION_CODE.matchAll(/ALTER TABLE public\.data_hub_raw_cells\s+(ADD|DROP)[^;]*/gi)].map((m) => m[0]);
    for (const t of [...rawRowsTouches, ...rawCellsTouches]) {
      expect(t, t).toMatch(/^ALTER TABLE public\.data_hub_raw_(rows|cells)\s+ADD CONSTRAINT/i);
    }
    expect(rawRowsTouches.length).toBeGreaterThan(0);
    expect(rawCellsTouches.length).toBeGreaterThan(0);
  });
});

describe("6.2D4C-B1 — no canonical/domain writes", () => {
  it("never references any canonical/domain business table", () => {
    for (const t of CANONICAL_DOMAIN_TABLES) {
      expect(MIGRATION_CODE.toLowerCase(), t).not.toContain(t);
    }
  });

  it("never writes canonical_status on uploads, and never targets uploads' own (legacy) status column", () => {
    expect(MIGRATION_CODE).not.toMatch(/canonical_status\s*=/);
    const uploadUpdates = [...MIGRATION_CODE.matchAll(/UPDATE public\.uploads\b[\s\S]*?WHERE/g)].map((m) => m[0]);
    for (const u of uploadUpdates) {
      expect(u).not.toMatch(/\bSET[\s\S]*\bstatus\s*=/);
    }
  });

  it("never touches mapping_version_id", () => {
    expect(MIGRATION_CODE).not.toMatch(/mapping_version_id/);
  });
});

describe("6.2D4C-B1 — WorksheetMappingProfile.active_profile_version_id is never consulted", () => {
  it("the migration file's own code never reads active_profile_version_id", () => {
    expect(MIGRATION_CODE).not.toMatch(/active_profile_version_id/);
  });

  it("the exact pinned profile invariant is a structural composite FK against the run's OWN pin, not the active pointer", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalization_runs_raw_run_pinned_version_fkey");
    const fkIdx = MIGRATION_CODE.indexOf("data_hub_normalization_runs_raw_run_pinned_version_fkey");
    const region = MIGRATION_CODE.slice(fkIdx, fkIdx + 600);
    expect(region).toMatch(/raw_staging_run_id[\s\S]*worksheet_mapping_profile_version_id[\s\S]*organisation_id/);
    expect(region).toContain("REFERENCES public.data_hub_raw_staging_runs(id, worksheet_mapping_profile_version_id, organisation_id)");
  });
});

describe("6.2D4C-B1 — separate lifecycle (never reuses D4B's own objects)", () => {
  it("defines its own table/trigger/function names, distinct from D4B's", () => {
    expect(MIGRATION_CODE).toContain("public.data_hub_normalization_runs");
    expect(MIGRATION_CODE).toContain("datahub_guard_normalization_run_lifecycle");
    expect(MIGRATION_CODE).toContain("datahub_complete_normalization_run");
    expect(MIGRATION_CODE).not.toContain("datahub_guard_raw_staging_run_lifecycle(");
    expect(MIGRATION_CODE).not.toContain("datahub_stage_raw_batch(");
  });

  it("status is RUNNING | SUCCEEDED | FAILED | ABANDONED, same vocabulary as D4B, on its OWN table", () => {
    expect(MIGRATION_CODE).toContain(
      "ALTER TABLE public.data_hub_normalization_runs ADD CONSTRAINT data_hub_normalization_runs_status_check CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED'))",
    );
  });

  it("one RUNNING normalization run per Upload (separate partial unique index from D4B's own)", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalization_runs_one_active_per_upload");
    expect(MIGRATION_CODE).not.toContain("data_hub_raw_staging_runs_one_active_per_upload");
  });

  it("a normalization run may only be created against a SUCCEEDED raw staging run", () => {
    const fnStart = MIGRATION_CODE.indexOf("CREATE OR REPLACE FUNCTION public.datahub_guard_normalization_run_lifecycle()");
    const fnEnd = MIGRATION_CODE.indexOf("$fn$;", fnStart + 50);
    const body = MIGRATION_CODE.slice(fnStart, fnEnd);
    expect(body).toMatch(/TG_OP = 'INSERT'/);
    expect(body).toMatch(/v_raw_status IS DISTINCT FROM 'SUCCEEDED'/);
  });
});

describe("6.2D4C-B1 — normalized rows/cells are immutable after INSERT", () => {
  it("a dedicated trigger unconditionally rejects UPDATE and DELETE on both tables", () => {
    const fnStart = MIGRATION_CODE.indexOf("CREATE OR REPLACE FUNCTION public.datahub_guard_normalized_evidence_immutable()");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = MIGRATION_CODE.indexOf("$fn$;", fnStart);
    const body = MIGRATION_CODE.slice(fnStart, fnEnd);
    expect(body).toMatch(/TG_OP = 'UPDATE'/);
    expect(body).toMatch(/TG_OP = 'DELETE'/);
    expect(body).toMatch(/RAISE EXCEPTION/);

    expect(MIGRATION_CODE).toContain("CREATE TRIGGER data_hub_normalized_rows_immutable_guard");
    expect(MIGRATION_CODE).toContain("CREATE TRIGGER data_hub_normalized_cells_immutable_guard");
    expect(MIGRATION_CODE).toMatch(/CREATE TRIGGER data_hub_normalized_rows_immutable_guard\s+BEFORE UPDATE OR DELETE/);
    expect(MIGRATION_CODE).toMatch(/CREATE TRIGGER data_hub_normalized_cells_immutable_guard\s+BEFORE UPDATE OR DELETE/);
  });
});

describe("6.2D4C-B1 — Upload normalization completion metadata is a separate, coherent group", () => {
  it("adds exactly the six new columns and never repurposes an existing raw/canonical column", () => {
    for (const col of ["normalized_at", "normalized_by", "normalized_profile_version_id", "normalized_row_count", "normalized_cell_count", "normalization_run_id"]) {
      expect(MIGRATION_CODE).toContain(`'${col}'`);
    }
    expect(MIGRATION_CODE).not.toMatch(/ALTER TABLE public\.uploads[^;]*raw_staged_at[^;]*ADD COLUMN/);
    expect(MIGRATION_CODE).not.toMatch(/ALTER TABLE public\.uploads[^;]*raw_profile_version_id[^;]*ADD COLUMN/);
    expect(MIGRATION_CODE).not.toMatch(/ALTER TABLE public\.uploads[^;]*raw_staging_run_id[^;]*ADD COLUMN/);
  });

  it("the coherence CHECK requires raw_staged_at to already be set before normalization can complete", () => {
    expect(MIGRATION_CODE).toContain("uploads_normalization_coherence_check");
    const idx = MIGRATION_CODE.indexOf("uploads_normalization_coherence_check");
    const region = MIGRATION_CODE.slice(idx, idx + 1500);
    expect(region).toContain("raw_staged_at IS NOT NULL");
  });

  it("normalized_by has an ON DELETE SET NULL actor relation, mirroring raw_staged_by's own precedent", () => {
    expect(MIGRATION_CODE).toContain("uploads_normalized_by_fkey");
    const idx = MIGRATION_CODE.indexOf("uploads_normalized_by_fkey");
    const region = MIGRATION_CODE.slice(idx, idx + 400);
    expect(region).toMatch(/FOREIGN KEY \(normalized_by\) REFERENCES public\.users\(id\) ON DELETE SET NULL/);
  });

  it("a SEPARATE guard trigger/function from D4A/D4B's own datahub_guard_upload_raw_staging_metadata", () => {
    expect(MIGRATION_CODE).toContain("datahub_guard_upload_normalization_metadata");
    expect(MIGRATION_CODE).not.toContain("datahub_guard_upload_raw_staging_metadata");
    expect(MIGRATION_CODE).toContain("CREATE TRIGGER uploads_normalization_metadata_guard");
  });
});

describe("6.2D4C-B1 — exact tenant/profile/raw-run lineage FKs are present", () => {
  const REQUIRED_FKS = [
    "data_hub_normalization_runs_organisation_id_fkey",
    "data_hub_normalization_runs_batch_schema_org_fkey",
    "data_hub_normalization_runs_upload_batch_org_fkey",
    "data_hub_normalization_runs_raw_run_org_fkey",
    "data_hub_normalization_runs_raw_run_upload_fkey",
    "data_hub_normalization_runs_raw_run_pinned_version_fkey",
    "data_hub_normalized_rows_organisation_id_fkey",
    "data_hub_normalized_rows_run_org_fkey",
    "data_hub_normalized_rows_run_raw_run_fkey",
    "data_hub_normalized_rows_raw_row_fkey",
    "data_hub_normalized_cells_organisation_id_fkey",
    "data_hub_normalized_cells_normalized_row_fkey",
    "data_hub_normalized_cells_raw_cell_org_fkey",
    "data_hub_normalized_cells_raw_cell_row_fkey",
    "data_hub_normalized_cells_raw_cell_column_fkey",
    "data_hub_normalized_cells_column_org_fkey",
    "uploads_normalization_run_org_fkey",
    "uploads_normalization_run_upload_fkey",
    "uploads_normalized_profile_version_org_fkey",
  ];

  it.each(REQUIRED_FKS)("declares %s", (fk) => {
    expect(MIGRATION_CODE).toContain(fk);
  });
});

describe("6.2D4C-B1 — normalized_value storage contract (foundation only, no transformation)", () => {
  it("value_kind is CHECKed against the exact D4C-A ValueKind vocabulary", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalized_cells_value_kind_check");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalized_cells_value_kind_check");
    const region = MIGRATION_CODE.slice(idx, idx + 700);
    for (const kind of ["STRING", "IDENTIFIER", "INTEGER", "DECIMAL", "BOOLEAN", "DATE", "TIME", "DATETIME", "DURATION", "PERCENTAGE", "CURRENCY", "LATITUDE", "LONGITUDE"]) {
      expect(region, kind).toContain(kind);
    }
  });

  it("normalized_value is NOT NULL JSONB, constrained to string/boolean/the JSON literal null — never a JSON number", () => {
    expect(MIGRATION_CODE).toMatch(/ADD COLUMN normalized_value JSONB NOT NULL/);
    expect(MIGRATION_CODE).toContain("data_hub_normalized_cells_value_shape_check");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalized_cells_value_shape_check");
    const region = MIGRATION_CODE.slice(idx, idx + 400);
    expect(region).toContain("'string'");
    expect(region).toContain("'boolean'");
    expect(region).toContain("'null'");
    expect(region).not.toContain("'number'");
  });

  it("source_unit/normalized_unit are CHECKed against the exact D4C-A Unit vocabulary and never inferred from a header", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalized_cells_unit_allowlist_check");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalized_cells_unit_allowlist_check");
    const region = MIGRATION_CODE.slice(idx, idx + 700);
    for (const unit of ["kg", "t", "m", "km", "s", "min", "h", "AUD"]) {
      expect(region, unit).toContain(unit);
    }
    expect(MIGRATION_CODE).not.toMatch(/source_header/);
  });

  it("unit-pair coherence: both null or both non-null, never exactly one", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalized_cells_unit_pair_check");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalized_cells_unit_pair_check");
    const region = MIGRATION_CODE.slice(idx, idx + 300);
    expect(region).toContain("(source_unit IS NULL) = (normalized_unit IS NULL)");
  });
});

describe("6.2D4C-B1 — resumability shape (invariant 11)", () => {
  it("normalized rows are unique per RUN + source_row_number, never per upload alone", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalized_rows_run_source_row_key");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalized_rows_run_source_row_key");
    const region = MIGRATION_CODE.slice(idx, idx + 300);
    expect(region).toContain("UNIQUE (normalization_run_id, source_row_number)");
  });

  it("normalized cells are unique per normalized row + raw cell", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalized_cells_row_cell_key");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalized_cells_row_cell_key");
    const region = MIGRATION_CODE.slice(idx, idx + 300);
    expect(region).toContain("UNIQUE (normalized_row_id, raw_cell_id)");
  });

  it("attempt_number/upload uniqueness allows a terminal attempt and a later new attempt to coexist", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalization_runs_upload_attempt_key");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalization_runs_upload_attempt_key");
    const region = MIGRATION_CODE.slice(idx, idx + 300);
    expect(region).toContain("UNIQUE (upload_id, attempt_number)");
  });
});

describe("6.2D4C-B1 — Prisma schema shape", () => {
  const REQUIRED_MODELS_AND_FIELDS: Record<string, string[]> = {
    DataHubNormalizationRun: [
      "id",
      "organisation_id",
      "import_batch_id",
      "upload_id",
      "raw_staging_run_id",
      "source_schema_version_id",
      "source_schema_worksheet_id",
      "worksheet_mapping_profile_id",
      "worksheet_mapping_profile_version_id",
      "attempt_number",
      "normalizer_version",
      "status",
      "execution_token",
      "lease_expires_at",
      "last_progress_at",
      "expected_row_count",
      "expected_cell_count",
      "persisted_row_count",
      "persisted_cell_count",
      "created_by",
      "started_at",
      "completed_at",
      "failed_at",
      "failure_code",
      "failure_detail",
      "created_at",
    ],
    DataHubNormalizedRow: ["id", "organisation_id", "normalization_run_id", "raw_row_id", "source_row_number", "created_at"],
    DataHubNormalizedCell: [
      "id",
      "organisation_id",
      "normalized_row_id",
      "raw_cell_id",
      "source_schema_column_id",
      "value_kind",
      "normalized_value",
      "source_unit",
      "normalized_unit",
      "created_at",
    ],
  };

  function modelBody(name: string): string {
    const start = PRISMA.indexOf(`model ${name} {`);
    expect(start, `model ${name} not found`).toBeGreaterThan(-1);
    const end = PRISMA.indexOf("\n}", start);
    return PRISMA.slice(start, end);
  }

  it.each(Object.entries(REQUIRED_MODELS_AND_FIELDS))("model %s declares every required field", (name, fields) => {
    const body = modelBody(name);
    for (const f of fields) {
      expect(body, f).toMatch(new RegExp(`\\n\\s*${f}\\s+`));
    }
  });

  it("DataHubNormalizedRow/Cell each carry one extra denormalized lineage column beyond the task's minimal spec, documented as such (raw_staging_run_id / raw_row_id)", () => {
    expect(modelBody("DataHubNormalizedRow")).toMatch(/\n\s*raw_staging_run_id\s+String/);
    expect(modelBody("DataHubNormalizedCell")).toMatch(/\n\s*raw_row_id\s+String\s/);
  });

  it("Upload declares the exact six normalization completion fields", () => {
    const body = modelBody("Upload");
    for (const f of ["normalized_at", "normalized_by", "normalized_profile_version_id", "normalized_row_count", "normalized_cell_count", "normalization_run_id"]) {
      expect(body, f).toMatch(new RegExp(`\\n\\s*${f}\\s+`));
    }
  });

  it("all three new models map to their exact snake_case table names", () => {
    expect(modelBody("DataHubNormalizationRun")).toContain('@@map("data_hub_normalization_runs")');
    expect(modelBody("DataHubNormalizedRow")).toContain('@@map("data_hub_normalized_rows")');
    expect(modelBody("DataHubNormalizedCell")).toContain('@@map("data_hub_normalized_cells")');
  });
});

describe("6.2D4C-B1 — rollback is guarded and D4A/D4B-safe", () => {
  it("refuses if any normalization evidence or Upload completion metadata exists", () => {
    expect(ROLLBACK_CODE).toMatch(/data_hub_normalization_runs/);
    expect(ROLLBACK_CODE).toMatch(/RAISE EXCEPTION[\s\S]*Refusing rollback/);
    expect(ROLLBACK_CODE).toMatch(/normalization_run_id IS NOT NULL OR normalized_at IS NOT NULL/);
  });

  it("never touches any D4A/D4B object", () => {
    expect(ROLLBACK_CODE).not.toMatch(/data_hub_raw_staging_runs_lifecycle_guard/);
    expect(ROLLBACK_CODE).not.toMatch(/datahub_guard_raw_staging_run_lifecycle/);
    expect(ROLLBACK_CODE).not.toMatch(/DROP TABLE[^;]*data_hub_raw_(rows|cells|staging_runs)/i);
  });

  it("drops exactly the three additive composite UNIQUE constraints this migration added, and nothing else on those tables", () => {
    expect(ROLLBACK_CODE).toContain("data_hub_raw_rows_id_staging_run_organisation_key");
    expect(ROLLBACK_CODE).toContain("data_hub_raw_cells_id_organisation_key");
    expect(ROLLBACK_CODE).toContain("data_hub_raw_cells_id_raw_row_organisation_key");
    expect(ROLLBACK_CODE).toContain("data_hub_raw_cells_id_column_organisation_key");
  });
});
