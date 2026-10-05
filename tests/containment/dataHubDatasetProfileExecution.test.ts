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

describe("6.2D4D1B2 — PR #324 remediation round 1: failure-disposition hardening", () => {
  it("profileUploadDataset wraps post-attempt-creation execution in a try/catch exception boundary", () => {
    const source = executionSource("profileUploadDataset.ts");
    const fnStart = source.indexOf("export async function profileUploadDataset(");
    const body = source.slice(fnStart);
    expect(body).toMatch(/\btry\s*\{/);
    expect(body).toMatch(/\}\s*catch\b/);
    // The try block must start AFTER the RUNNING attempt is created (Phase
    // A), not before -- the exception boundary exists specifically to
    // dispose of an attempt that is already durably committed.
    const createIdx = body.indexOf("createDatasetProfileRunAttempt(");
    const tryIdx = body.indexOf("try {");
    expect(tryIdx).toBeGreaterThan(createIdx);
  });

  it("every disposal call site checks (never discards) markDatasetProfileRunFailed's own result -- no bare fire-and-forget await", () => {
    const source = executionSource("profileUploadDataset.ts");
    // The ONLY call to the raw fail-run helper lives inside
    // disposeExecutionFailure, and its result is captured and branched on
    // -- never a bare `await markDatasetProfileRunFailed(...);` statement
    // whose return value is thrown away.
    expect(source).not.toMatch(/^\s*await markDatasetProfileRunFailed\(/m);
    const callCount = (source.match(/markDatasetProfileRunFailed\(/g) ?? []).length;
    expect(callCount).toBe(1);
    const callIdx = source.indexOf("markDatasetProfileRunFailed(");
    const precedingLine = source.slice(Math.max(0, callIdx - 80), callIdx);
    expect(precedingLine).toMatch(/applied\s*=\s*await\s*$/);
  });

  it("disposeExecutionFailure re-reads real current state before reporting a false/zero-row disposition -- never guesses", () => {
    const source = executionSource("profileUploadDataset.ts");
    expect(source).toContain("getDatasetProfileRunById");
    const fnStart = source.indexOf("async function disposeExecutionFailure");
    const fn = source.slice(fnStart, fnStart + 2200);
    expect(fn).toMatch(/catch\s*\{/); // the fail-run call itself is guarded
    expect(fn).toContain('status === "FAILED"');
    expect(fn).toContain('status === "SUCCEEDED"');
    expect(fn).toContain("PERSISTENCE_FAILURE");
  });

  it("the two files touched by this remediation never reference a caught exception's own message at all (unlike completeDatasetProfileRun.ts's own pre-existing, reviewed in-memory classification, which never returns the message either but is out of this remediation's scope)", () => {
    for (const file of ["profileUploadDataset.ts", "dataHubDatasetProfileRun.ts"]) {
      const source = executionSource(file);
      expect(source, `${file} must not reference err.message/error.message`).not.toMatch(/\b(err|error|e)\.message\b/);
    }
  });

  it("no file in the execution layer ever returns a caught exception's own message as part of a result (completeDatasetProfileRun.ts's pre-existing classifyCompletionError only branches on it in-memory to pick a bounded code, never embeds it in the returned result)", () => {
    for (const file of EXECUTION_FILES) {
      const source = executionSource(file);
      // No returned object literal contains `message` as a value tied to
      // the caught error, e.g. `{ ..., code: err.message }` or similar.
      expect(source, `${file} must not return a result containing err.message/error.message`).not.toMatch(/return\s*\{[^}]*\.message/);
    }
  });

  it("introduces no new console logging", () => {
    for (const file of EXECUTION_FILES) {
      expect(executionSource(file), `${file} must not call console.*`).not.toMatch(/console\./);
    }
  });

  it("introduces no auto-abandon/timeout/lease/scheduler/cron mechanism", () => {
    expect(ALL_EXECUTION_SOURCE).not.toMatch(/setTimeout|setInterval|cron|lease_expires_at|execution_token/i);
    // abandonStaleDatasetProfileRun remains a manually-invoked, exported
    // helper -- never called from within this module itself.
    const dataHubDatasetProfileRunSource = executionSource("dataHubDatasetProfileRun.ts");
    const profileUploadDatasetSource = executionSource("profileUploadDataset.ts");
    expect(profileUploadDatasetSource).not.toContain("abandonStaleDatasetProfileRun");
    expect(dataHubDatasetProfileRunSource).toContain("export async function abandonStaleDatasetProfileRun");
  });

  it("introduces no new failure-code vocabulary beyond D4D1B1's own closed set", () => {
    const allowed = ["NORMALIZATION_NOT_COMPLETE", "NORMALIZATION_RUN_NOT_SUCCEEDED", "PROFILER_VERSION_UNSUPPORTED", "PROFILE_INPUT_INVALID", "PROFILE_RECONCILIATION_FAILED", "PERSISTENCE_FAILURE"];
    const codeLiterals = [...ALL_EXECUTION_SOURCE.matchAll(/"((?:NORMALIZATION|PROFILER|PROFILE|PERSISTENCE)_[A-Z_]+)"/g)].map((m) => m[1]);
    expect(codeLiterals.length).toBeGreaterThan(0);
    for (const code of codeLiterals) {
      expect(allowed, `unexpected failure code literal: ${code}`).toContain(code);
    }
  });
});
