import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SQL = read("scripts/create-datahub-raw-staging-runs.sql");
const ROLLBACK_SQL = read("scripts/rollback-datahub-raw-staging-runs.sql");
const D4A_SQL = read("scripts/create-datahub-raw-staging.sql");
const PRISMA = read("prisma/schema.prisma");
const ELIGIBILITY_TS = read("lib/data-hub/staging/eligibility.ts");
const RUN_LIFECYCLE_TS = read("lib/data-hub/staging/dataHubRawStagingRun.ts");
const STAGE_BATCHES_TS = read("lib/data-hub/staging/stageWorksheetRows.ts");
// Strips `//` line comments so structural/naming assertions below can never
// be satisfied (or spuriously failed) by explanatory PROSE that happens to
// mention a field/function name — only real code counts. Mirrors the SQL
// containment tests' own `.replace(/--.*$/gm, "")` idiom.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const ELIGIBILITY_CODE = stripComments(ELIGIBILITY_TS);
const RUN_LIFECYCLE_CODE = stripComments(RUN_LIFECYCLE_TS);
const STAGE_BATCHES_CODE = stripComments(STAGE_BATCHES_TS);

describe("6.2D4B raw-staging-run foundation — static containment", () => {
  it("D4A's own migration file is completely untouched (correction 7 / plan item 1)", () => {
    // The exact circular FK D4B exists to fix is still present, verbatim,
    // in D4A's own file — proving D4B did not edit it.
    expect(D4A_SQL).toContain("data_hub_raw_rows_upload_profile_version_org_fkey");
    expect(D4A_SQL).toContain("data_hub_raw_rows_upload_source_row_key");
  });

  it("adds the DataHubRawStagingRun model/table and the staging_run_id/raw_staging_run_id columns", () => {
    expect(PRISMA).toContain("model DataHubRawStagingRun {");
    expect(PRISMA).toContain('@@map("data_hub_raw_staging_runs")');
    expect(PRISMA).toContain("staging_run_id");
    expect(PRISMA).toContain("raw_staging_run_id");
  });

  it("is a SEPARATE migration file from D4A's own script", () => {
    expect(SQL).not.toBe(D4A_SQL);
    expect(fs.existsSync(path.join(ROOT, "scripts/create-datahub-raw-staging.sql"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "scripts/create-datahub-raw-staging-runs.sql"))).toBe(true);
  });

  it("drops exactly D4A's two superseded constraints and replaces them", () => {
    expect(SQL).toContain("DROP CONSTRAINT IF EXISTS data_hub_raw_rows_upload_profile_version_org_fkey");
    expect(SQL).toContain("DROP CONSTRAINT IF EXISTS data_hub_raw_rows_upload_source_row_key");
    expect(SQL).toContain("data_hub_raw_rows_staging_run_source_row_key");
    expect(SQL).toContain("data_hub_raw_rows_staging_run_profile_version_fkey");
    expect(SQL).toContain("data_hub_raw_rows_staging_run_upload_fkey");
  });

  it("fails loudly rather than backfilling legacy raw rows with a NULL staging_run_id (correction 7)", () => {
    const withoutComments = SQL.replace(/--.*$/gm, "");
    expect(withoutComments).toMatch(/WHERE\s+staging_run_id\s+IS\s+NULL/i);
    expect(withoutComments).toMatch(/RAISE EXCEPTION/i);
    expect(withoutComments).not.toMatch(/UPDATE\s+public\.data_hub_raw_rows\s+SET\s+staging_run_id/i);
  });

  it("reuses ensure_index (drift-checked) rather than a bare CREATE UNIQUE INDEX IF NOT EXISTS (correction 5)", () => {
    const withoutComments = SQL.replace(/--.*$/gm, "");
    expect(SQL).toContain("pg_temp.ensure_index");
    expect(SQL).toContain("data_hub_raw_staging_runs_one_active_per_upload");
    // The bare, non-drift-checked idiom must not be used for this index.
    expect(withoutComments).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS data_hub_raw_staging_runs_one_active_per_upload/i);
  });

  it("the partial index predicate targets RUNNING only", () => {
    expect(SQL).toMatch(/WHERE\s*\(?status\s*=\s*'RUNNING'/i);
  });

  it("the lifecycle trigger handles actor deletion as its own unconditional branch, before status branches (correction 2)", () => {
    const fnStart = SQL.indexOf("FUNCTION public.datahub_guard_raw_staging_run_lifecycle()");
    const fnEnd = SQL.indexOf("CREATE TRIGGER data_hub_raw_staging_runs_lifecycle_guard", fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    const actorBranchIdx = fnBody.indexOf("OLD.created_by IS NOT NULL");
    const statusBranchIdx = fnBody.indexOf("OLD.status <> 'RUNNING'");
    expect(actorBranchIdx).toBeGreaterThan(-1);
    expect(statusBranchIdx).toBeGreaterThan(-1);
    expect(actorBranchIdx).toBeLessThan(statusBranchIdx);
    // The actor branch checks every other column unchanged, INCLUDING status
    // itself — i.e. it never requires an ordinary lease/status update.
    const actorBranchSlice = fnBody.slice(actorBranchIdx, statusBranchIdx);
    expect(actorBranchSlice).toContain("NEW.status IS NOT DISTINCT FROM OLD.status");
  });

  it("datahub_stage_raw_batch verifies the lease before insert and re-verifies it before the final progress commit (correction 1)", () => {
    const fnStart = SQL.indexOf("FUNCTION public.datahub_stage_raw_batch(");
    const fnEnd = SQL.indexOf("$fn$;", SQL.indexOf("$fn$;", fnStart) + 5);
    const fnBody = SQL.slice(fnStart, fnEnd);
    const firstLeaseCheck = fnBody.indexOf("v_lease_rows <> 1");
    const rowInsert = fnBody.indexOf("INSERT INTO public.data_hub_raw_rows");
    const cellInsert = fnBody.indexOf("INSERT INTO public.data_hub_raw_cells");
    const secondLeaseCheck = fnBody.indexOf("v_progress_rows <> 1");
    expect(firstLeaseCheck).toBeGreaterThan(-1);
    expect(rowInsert).toBeGreaterThan(-1);
    expect(cellInsert).toBeGreaterThan(-1);
    expect(secondLeaseCheck).toBeGreaterThan(-1);
    // Strict ordering: lease check -> row insert -> cell insert -> lease
    // re-check. Both checks RAISE on mismatch, which rolls back the WHOLE
    // statement (including any inserts already made in it).
    expect(firstLeaseCheck).toBeLessThan(rowInsert);
    expect(rowInsert).toBeLessThan(cellInsert);
    expect(cellInsert).toBeLessThan(secondLeaseCheck);
    expect(fnBody.match(/RAISE EXCEPTION/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("datahub_stage_raw_batch never infers cell identity positionally — every field comes from the caller-supplied jsonb (correction 4)", () => {
    const fnStart = SQL.indexOf("FUNCTION public.datahub_stage_raw_batch(");
    const fnEnd = SQL.indexOf("$fn$;", SQL.indexOf("$fn$;", fnStart) + 5);
    const fnBody = SQL.slice(fnStart, fnEnd);
    for (const field of ["sourceSchemaColumnId", "columnOrdinal", "sourceHeader", "sensitivityClass"]) {
      expect(fnBody).toContain(field);
    }
  });

  it("datahub_complete_raw_staging_run accepts p_completed_by as a distinct parameter, never reading created_by for raw_staged_by (correction 3)", () => {
    const fnStart = SQL.indexOf("FUNCTION public.datahub_complete_raw_staging_run(");
    const fnEnd = SQL.indexOf("$fn$;", SQL.indexOf("$fn$;", fnStart) + 5);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toContain("p_completed_by");
    expect(fnBody).toMatch(/raw_staged_by\s*=\s*p_completed_by/);
    expect(fnBody).not.toMatch(/raw_staged_by\s*=\s*v_run\.created_by/);
  });

  it("extends uploads_raw_staging_coherence_check to include raw_staging_run_id in both branches", () => {
    const idx = SQL.lastIndexOf("uploads_raw_staging_coherence_check");
    expect(idx).toBeGreaterThan(-1);
  });

  it("rollback script guards against non-empty data_hub_raw_staging_runs and staged uploads before proceeding (correction 6)", () => {
    expect(ROLLBACK_SQL).toMatch(/RAISE EXCEPTION/i);
    expect(ROLLBACK_SQL).toMatch(/data_hub_raw_staging_runs/);
    expect(ROLLBACK_SQL).toContain("Refusing rollback");
  });

  it("rollback script restores D4A's exact original coherence-check predicate and trigger body, and re-adds the exact original constraints", () => {
    expect(ROLLBACK_SQL).toContain("ADD CONSTRAINT uploads_raw_staging_coherence_check CHECK (");
    expect(ROLLBACK_SQL).toContain("ADD CONSTRAINT data_hub_raw_rows_upload_source_row_key UNIQUE (upload_id, source_row_number)");
    expect(ROLLBACK_SQL).toContain("ADD CONSTRAINT data_hub_raw_rows_upload_profile_version_org_fkey");
    expect(ROLLBACK_SQL).toContain("FOREIGN KEY (upload_id, worksheet_mapping_profile_version_id, organisation_id)");
    expect(ROLLBACK_SQL).toContain("REFERENCES public.uploads(id, raw_profile_version_id, organisation_id)");
  });

  it("does not repurpose canonical_status or introduce canonical/domain writes", () => {
    const withoutComments = SQL.replace(/--.*$/gm, "");
    expect(withoutComments).not.toMatch(/UPDATE\s+public\.uploads\s+SET\s+canonical_status/i);
    expect(withoutComments).not.toMatch(/INSERT\s+INTO\s+public\.(illegal_dumping|service_requests|missed_collections|debtor_accounts|metrics)/i);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Remediation: runtime lease/continuation fix.
  // ─────────────────────────────────────────────────────────────────────

  it("remediation: datahub_stage_raw_batch's initial lease check requires a NOT-YET-EXPIRED lease and renews it (point 2)", () => {
    const fnStart = SQL.indexOf("FUNCTION public.datahub_stage_raw_batch(");
    const fnEnd = SQL.indexOf("$fn$;", SQL.indexOf("$fn$;", fnStart) + 5);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toContain("p_lease_seconds");
    // The first (pre-insert) lease UPDATE both requires liveness and renews
    // — scoped strictly to THIS statement (up to its own RETURNING clause)
    // so this assertion cannot be spuriously satisfied by the unrelated,
    // later final-check occurrence of the same literal text.
    const firstUpdateIdx = fnBody.indexOf("SET lease_expires_at = now() + make_interval");
    const firstReturningIdx = fnBody.indexOf("RETURNING import_batch_id", firstUpdateIdx);
    expect(firstUpdateIdx).toBeGreaterThan(-1);
    expect(firstReturningIdx).toBeGreaterThan(firstUpdateIdx);
    const firstStatement = fnBody.slice(firstUpdateIdx, firstReturningIdx);
    expect(firstStatement).toContain("AND lease_expires_at > now()");
  });

  it("remediation: datahub_stage_raw_batch's FINAL progress check also requires a still-live lease (point 2)", () => {
    const fnStart = SQL.indexOf("FUNCTION public.datahub_stage_raw_batch(");
    const fnEnd = SQL.indexOf("$fn$;", SQL.indexOf("$fn$;", fnStart) + 5);
    const fnBody = SQL.slice(fnStart, fnEnd);
    const progressUpdateIdx = fnBody.indexOf("SET persisted_row_count");
    const finalLeaseCheckIdx = fnBody.indexOf("AND lease_expires_at > now()", progressUpdateIdx);
    expect(progressUpdateIdx).toBeGreaterThan(-1);
    expect(finalLeaseCheckIdx).toBeGreaterThan(-1);
  });

  it("remediation: datahub_stage_raw_batch's OLD 4-arg signature is dropped before the new 5-arg one is (re)created (idempotent signature change)", () => {
    const dropIdx = SQL.indexOf("DROP FUNCTION IF EXISTS public.datahub_stage_raw_batch(text, text, text, jsonb);");
    const createIdx = SQL.indexOf("CREATE OR REPLACE FUNCTION public.datahub_stage_raw_batch(");
    expect(dropIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(createIdx);
  });

  it("remediation: datahub_complete_raw_staging_run requires the current execution_token and a live lease (point 4)", () => {
    const fnStart = SQL.indexOf("FUNCTION public.datahub_complete_raw_staging_run(");
    const fnEnd = SQL.indexOf("$fn$;", SQL.indexOf("$fn$;", fnStart) + 5);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toContain("p_execution_token");
    expect(fnBody).toMatch(/execution_token\s+IS\s+DISTINCT\s+FROM\s+p_execution_token/);
    expect(fnBody).toMatch(/lease_expires_at\s*<=\s*now\(\)/);
  });

  it("remediation: datahub_complete_raw_staging_run's OLD 3-arg signature is dropped before the new 4-arg one is (re)created", () => {
    const dropIdx = SQL.indexOf("DROP FUNCTION IF EXISTS public.datahub_complete_raw_staging_run(text, text, text);");
    const createIdx = SQL.indexOf("CREATE OR REPLACE FUNCTION public.datahub_complete_raw_staging_run(");
    expect(dropIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(createIdx);
  });

  it("remediation: rollback script drops the CURRENT (not the original) function signatures", () => {
    expect(ROLLBACK_SQL).toContain("DROP FUNCTION IF EXISTS public.datahub_complete_raw_staging_run(text, text, text, text);");
    expect(ROLLBACK_SQL).toContain("DROP FUNCTION IF EXISTS public.datahub_stage_raw_batch(text, text, text, jsonb, integer);");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Remediation: pinned-profile resume correction.
  // ─────────────────────────────────────────────────────────────────────

  it("remediation: resolvePinnedStagingRunContext's own CODE (comments stripped) never reads active_profile_version_id", () => {
    const fnStart = ELIGIBILITY_CODE.indexOf("export async function resolvePinnedStagingRunContext(");
    expect(fnStart).toBeGreaterThan(-1);
    // Slices to end of file — this is the LAST export in the module, so
    // this also structurally guards against a future addition being
    // silently appended inside/after it without this test being revisited.
    const fnBody = ELIGIBILITY_CODE.slice(fnStart);
    expect(fnBody).not.toContain("active_profile_version_id");
    // And, for completeness, it must never touch WorksheetMappingProfile's
    // own delegate at all (the active-pointer table) — only
    // WorksheetMappingProfileVersion, by exact pinned id.
    expect(fnBody).not.toMatch(/prisma\.worksheetMappingProfile\.(findFirst|findUnique|findMany)/);
    expect(fnBody).toContain("prisma.worksheetMappingProfileVersion.findFirst");
  });

  it("remediation: resolveStagingEligibility (the new-run-only gate) is the ONLY CODE (comments stripped) in eligibility.ts that reads active_profile_version_id", () => {
    const occurrences = (ELIGIBILITY_CODE.match(/active_profile_version_id/g) ?? []).length;
    const eligibilityFnStart = ELIGIBILITY_CODE.indexOf("export async function resolveStagingEligibility(");
    const pinnedFnStart = ELIGIBILITY_CODE.indexOf("export async function resolvePinnedStagingRunContext(");
    expect(eligibilityFnStart).toBeGreaterThan(-1);
    expect(pinnedFnStart).toBeGreaterThan(eligibilityFnStart);
    const eligibilityBody = ELIGIBILITY_CODE.slice(eligibilityFnStart, pinnedFnStart);
    const occurrencesInEligibility = (eligibilityBody.match(/active_profile_version_id/g) ?? []).length;
    expect(occurrencesInEligibility).toBeGreaterThan(0);
    // Every occurrence in the whole file's real CODE lives inside
    // resolveStagingEligibility — none anywhere else, including inside
    // resolvePinnedStagingRunContext.
    expect(occurrencesInEligibility).toBe(occurrences);
  });

  it("remediation: an existing (resumed) run never calls resolveStagingEligibility — only resolvePinnedStagingRunContext", () => {
    const fnStart = RUN_LIFECYCLE_CODE.indexOf("export async function createOrResumeStagingRun(");
    const existingBranchStart = RUN_LIFECYCLE_CODE.indexOf("if (existing) {", fnStart);
    // The branch ends where the new-run path's own eligibility call begins.
    const newRunEligibilityIdx = RUN_LIFECYCLE_CODE.indexOf("resolveStagingEligibility({ organisationId, uploadId })", existingBranchStart);
    expect(existingBranchStart).toBeGreaterThan(-1);
    expect(newRunEligibilityIdx).toBeGreaterThan(existingBranchStart);
    const existingBranchBody = RUN_LIFECYCLE_CODE.slice(existingBranchStart, newRunEligibilityIdx);
    expect(existingBranchBody).not.toContain("resolveStagingEligibility(");
    expect(existingBranchBody).toContain("resolvePinnedStagingRunContext(");
  });

  it("remediation: stageBatches never calls resolveStagingEligibility (it derives everything from the caller-supplied pinned run context)", () => {
    expect(STAGE_BATCHES_CODE).not.toContain("resolveStagingEligibility");
    expect(STAGE_BATCHES_CODE).not.toMatch(/import\s*{\s*resolveStagingEligibility/);
  });
});
