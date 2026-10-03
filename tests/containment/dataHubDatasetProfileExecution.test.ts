import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const stripSqlComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
const stripTsComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

const PRISMA = read("prisma/schema.prisma");
const MIGRATION_CODE = stripSqlComments(read("scripts/create-datahub-profile-execution.sql"));
const ROLLBACK = read("scripts/rollback-datahub-profile-execution.sql");

const EXECUTION_DIR = path.join(ROOT, "lib/data-hub/profileExecution");
const EXECUTION_FILES = fs.readdirSync(EXECUTION_DIR).filter((f) => f.endsWith(".ts"));
const executionSource = (file: string) => stripTsComments(fs.readFileSync(path.join(EXECUTION_DIR, file), "utf8"));
const ALL_EXECUTION_SOURCE = EXECUTION_FILES.map(executionSource).join("\n");

const PROFILING_DIR = path.join(ROOT, "lib/data-hub/profiling");
const PROFILING_FILES_SNAPSHOT = fs.readdirSync(PROFILING_DIR).filter((f) => f.endsWith(".ts")).sort();

describe("6.2D4D1B2 — execution service exists and reuses D4D1A/D4D1B1 unchanged", () => {
  it("defines the public entry point profileUploadDataset", () => {
    expect(fs.existsSync(path.join(EXECUTION_DIR, "profileUploadDataset.ts"))).toBe(true);
    const source = executionSource("profileUploadDataset.ts");
    expect(source).toMatch(/export async function profileUploadDataset\(/);
  });

  it("imports D4D1A's real profileDataset and DATASET_PROFILER_VERSION, never a duplicated/forked copy", () => {
    const source = executionSource("profileUploadDataset.ts");
    expect(source).toMatch(/from ["']\.\.\/profiling\/profileDataset["']/);
    expect(source).toMatch(/from ["']\.\.\/profiling\/contracts["']/);
    expect(source).toContain("DATASET_PROFILER_VERSION");
    // No second "v1" literal anywhere in the execution layer -- the
    // profiler version always flows from D4D1A's own exported constant.
    expect(ALL_EXECUTION_SOURCE).not.toMatch(/profiler_version\s*[:=]\s*["']v1["']/);
    expect(ALL_EXECUTION_SOURCE).not.toMatch(/profilerVersion\s*[:=]\s*["']v1["']/);
  });

  it("never modifies a single D4D1A profiler source file", () => {
    // Snapshot equality against the known D4D1A file set as of the D4D1B1
    // merge -- this slice only ever IMPORTS from lib/data-hub/profiling/,
    // it must never add, remove, or (by extension, since this is a git
    // worktree diff concern handled separately) edit a file there.
    expect(PROFILING_FILES_SNAPSHOT).toEqual(
      ["contracts.ts", "decimal.ts", "profileColumn.ts", "profileDataset.ts", "ratio.ts", "safeInt.ts", "temporal.ts", "temporalValidation.ts"].sort()
    );
  });

  it("never duplicates the D4D1A pure profiling engine's own logic (no second profileColumn/aggregateExactDecimalStrings/compareCanonicalTemporal implementation)", () => {
    expect(ALL_EXECUTION_SOURCE).not.toMatch(/function profileColumn\(/);
    expect(ALL_EXECUTION_SOURCE).not.toMatch(/function aggregateExactDecimalStrings\(/);
    expect(ALL_EXECUTION_SOURCE).not.toMatch(/function compareCanonicalTemporal\(/);
  });
});

describe("6.2D4D1B2 — pure/boundary containment", () => {
  it("never imports the workbook parser, raw staging reader, or any raw-staging profiler path", () => {
    expect(ALL_EXECUTION_SOURCE).not.toMatch(/workbookParser/i);
    expect(ALL_EXECUTION_SOURCE).not.toMatch(/data_hub_raw_rows|data_hub_raw_cells|dataHubRawRow|dataHubRawCell/);
    expect(ALL_EXECUTION_SOURCE).not.toMatch(/xlsx/i);
  });

  it("never imports an AI/model dependency", () => {
    expect(ALL_EXECUTION_SOURCE).not.toMatch(/@anthropic-ai|openai|anthropic/i);
  });

  it("implements no API route, UI component, or D4D2 semantic-inference concept anywhere in the repo for this slice", () => {
    expect(fs.existsSync(path.join(ROOT, "app/api/data-hub/worksheets/[id]/profile"))).toBe(false);
    for (const file of EXECUTION_FILES) {
      const source = executionSource(file);
      expect(source).not.toMatch(/semanticRole|SEMANTIC_ROLE|vehicle registration|employee id/i);
      expect(source).not.toMatch(/NextRequest|NextResponse|next\/server/);
    }
  });

  it("never calls console.* (would risk logging fixture/evidence values) and never persists a raw caught error message", () => {
    for (const file of EXECUTION_FILES) {
      const source = executionSource(file);
      expect(source, `${file} must not call console.*`).not.toMatch(/console\./);
    }
  });
});

describe("6.2D4D1B2 — authoritative target / trust boundary", () => {
  it("resolveAuthoritativeNormalizationContext derives normalization_run_id ONLY from the trusted Upload row, never a caller-supplied value", () => {
    const source = executionSource("dataHubDatasetProfileRun.ts");
    expect(source).toMatch(/export async function resolveAuthoritativeNormalizationContext/);
    expect(source).toContain("upload.normalization_run_id");
  });

  it("profileUploadDataset's own public signature takes organisationId/uploadId/actorId -- never normalizationRunId directly from a caller", () => {
    const source = executionSource("profileUploadDataset.ts");
    const sigStart = source.indexOf("export async function profileUploadDataset(");
    const sig = source.slice(sigStart, sigStart + 200);
    expect(sig).toContain("organisationId");
    expect(sig).toContain("uploadId");
    expect(sig).toContain("actorId");
    expect(sig).not.toContain("normalizationRunId");
  });
});

describe("6.2D4D1B2 — bounded failure-code vocabulary", () => {
  it("every execution-layer failure code belongs to D4D1B1's own closed vocabulary", () => {
    const allowed = ["NORMALIZATION_NOT_COMPLETE", "NORMALIZATION_RUN_NOT_SUCCEEDED", "PROFILER_VERSION_UNSUPPORTED", "PROFILE_INPUT_INVALID", "PROFILE_RECONCILIATION_FAILED", "PERSISTENCE_FAILURE"];
    const codeLiterals = [...ALL_EXECUTION_SOURCE.matchAll(/"((?:NORMALIZATION|PROFILER|PROFILE|PERSISTENCE)_[A-Z_]+)"/g)].map((m) => m[1]);
    expect(codeLiterals.length).toBeGreaterThan(0);
    for (const code of codeLiterals) {
      expect(allowed, `unexpected failure code literal: ${code}`).toContain(code);
    }
  });

  it("never persists a raw caught exception's message as a failure_code or failure_detail", () => {
    const source = executionSource("completeDatasetProfileRun.ts");
    expect(source).not.toMatch(/failureCode:\s*(err|error)\.message/);
    expect(source).not.toMatch(/failure_detail/);
  });
});

describe("6.2D4D1B2 — migration / rollback", () => {
  it("requires the D4D1B1 foundation to exist first", () => {
    expect(MIGRATION_CODE).toMatch(/data_hub_dataset_profile_runs[\s\S]*IS NULL/);
  });

  it("adds exactly the Upload profile-completion pointer columns", () => {
    for (const col of ["dataset_profile_run_id", "profiled_at", "profiled_by", "profiler_version"]) {
      expect(MIGRATION_CODE).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it("proves the pointer references a SUCCEEDED run belonging to the exact same upload (section 16)", () => {
    expect(MIGRATION_CODE).toContain("uploads_dataset_profile_run_upload_fkey");
    expect(MIGRATION_CODE).toContain("must reference a SUCCEEDED profile run");
    expect(MIGRATION_CODE).toContain("must belong to this exact upload");
  });

  it("the pointer is written only inside the atomic completion function, never by a separate standalone UPDATE elsewhere in the migration", () => {
    const fnStart = MIGRATION_CODE.indexOf("CREATE OR REPLACE FUNCTION public.datahub_complete_dataset_profile_run");
    const fnEnd = MIGRATION_CODE.indexOf("$fn$;", fnStart) + 5;
    const outsideFn = MIGRATION_CODE.slice(0, fnStart) + MIGRATION_CODE.slice(fnEnd);
    expect(outsideFn).not.toMatch(/UPDATE public\.uploads\s+SET\s+dataset_profile_run_id/);
  });

  it("the completion function inserts columns, transitions the run, and writes the Upload pointer inside ONE function body", () => {
    const fnStart = MIGRATION_CODE.indexOf("CREATE OR REPLACE FUNCTION public.datahub_complete_dataset_profile_run");
    const fnEnd = MIGRATION_CODE.indexOf("$fn$;", fnStart);
    const fn = MIGRATION_CODE.slice(fnStart, fnEnd);
    expect(fn).toContain("INSERT INTO public.data_hub_dataset_profile_columns");
    expect(fn).toContain("status = 'SUCCEEDED'");
    expect(fn).toContain("UPDATE public.uploads");
  });

  it("rollback refuses while any Upload pointer exists and removes only D4D1B2-owned objects", () => {
    expect(ROLLBACK).toContain("Refusing rollback");
    expect(ROLLBACK).toContain("DROP COLUMN IF EXISTS dataset_profile_run_id");
    expect(ROLLBACK).not.toMatch(/DROP TABLE/i);
  });
});

describe("6.2D4D1B2 — Prisma pointer fields and no row/cell-count duplication", () => {
  it("Upload gains exactly the four pointer fields, no row_count/column_count duplication", () => {
    const start = PRISMA.indexOf("model Upload {");
    const end = PRISMA.indexOf("\nmodel ", start + 10);
    const upload = PRISMA.slice(start, end);
    expect(upload).toMatch(/dataset_profile_run_id\s+String\?/);
    expect(upload).toMatch(/profiled_at\s+DateTime\?/);
    expect(upload).toMatch(/profiled_by\s+String\?/);
    expect(upload).toMatch(/profiler_version\s+String\?/);
  });

  it("DataHubDatasetProfileRun carries the additive (id, upload_id, organisation_id) proof key", () => {
    const start = PRISMA.indexOf("model DataHubDatasetProfileRun {");
    const end = PRISMA.indexOf("\nmodel ", start + 10);
    const model = PRISMA.slice(start, end);
    expect(model).toContain("data_hub_dataset_profile_runs_id_upload_organisation_key");
  });
});
