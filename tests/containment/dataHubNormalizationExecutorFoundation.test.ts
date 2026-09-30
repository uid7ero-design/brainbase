import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Data Hub 6.2D4B2A -- resumable normalization executor service, static
// containment. Mirrors the established idiom from
// tests/containment/dataHubRawStagingRunFoundation.test.ts (D4B's own
// analogous foundation). Live disposable-Postgres proof (concurrency,
// pinning-against-real-lifecycle, transform/persist, resume/replay) lives
// in scripts/tests/dataHubNormalizationExecutor.integration.test.ts -- this
// file only proves static shape, the pinned-profile discipline, the
// closed failure-code contract, and the absence of unsafe raw-value
// logging.

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const RUN_TS = read("lib/data-hub/normalizationExecution/dataHubNormalizationRun.ts");
const RUN_CODE = stripComments(RUN_TS);
const BATCH_TS = read("lib/data-hub/normalizationExecution/normalizeWorksheetRows.ts");
const BATCH_CODE = stripComments(BATCH_TS);
const COMPLETE_TS = read("lib/data-hub/normalizationExecution/completeNormalizationRun.ts");
const COMPLETE_CODE = stripComments(COMPLETE_TS);
const CONTRACTS_TS = read("lib/data-hub/normalization/contracts.ts");

describe("6.2D4B2A -- module shape / architecture", () => {
  it("adds exactly the three service files, none of them a route/UI/migration", () => {
    for (const rel of ["lib/data-hub/normalizationExecution/dataHubNormalizationRun.ts", "lib/data-hub/normalizationExecution/normalizeWorksheetRows.ts", "lib/data-hub/normalizationExecution/completeNormalizationRun.ts"]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
    }
    expect(fs.existsSync(path.join(ROOT, "app/api/data-hub/normalization"))).toBe(false);
  });

  it("never imports the workbook parser or any storage/blob module (no workbook/file reads in this phase)", () => {
    for (const code of [RUN_CODE, BATCH_CODE, COMPLETE_CODE]) {
      expect(code).not.toMatch(/workbookParser|readWorksheetDataRows/);
      expect(code).not.toMatch(/rawFileStore|compositionRoot|createImportBatchStorage/);
    }
  });

  it("never issues a raw CREATE TABLE / ALTER TABLE / new migration statement (no schema/migration writes)", () => {
    for (const code of [RUN_CODE, BATCH_CODE, COMPLETE_CODE]) {
      expect(code).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    }
  });

  it("never writes a canonical/domain table (illegal_dumping, service_requests, missed_collections, debtor_accounts, metrics)", () => {
    for (const code of [RUN_CODE, BATCH_CODE, COMPLETE_CODE]) {
      expect(code).not.toMatch(/INSERT\s+INTO\s+public\.(illegal_dumping|service_requests|missed_collections|debtor_accounts|metrics)/i);
    }
  });

  it("never repoints/writes WorksheetMappingProfile.active_profile_version_id (no profile activation)", () => {
    for (const code of [RUN_CODE, BATCH_CODE, COMPLETE_CODE]) {
      expect(code).not.toMatch(/active_profile_version_id\s*[:=]/);
    }
  });

  it("normalizeWorksheetRows.ts and completeNormalizationRun.ts never call createOrResumeNormalizationRun (a single orchestration entrypoint is not duplicated/invented here)", () => {
    expect(BATCH_CODE).not.toContain("createOrResumeNormalizationRun");
    expect(COMPLETE_CODE).not.toContain("createOrResumeNormalizationRun");
  });
});

describe("6.2D4B2A -- normalizer-version contract", () => {
  it("NORMALIZER_VERSION is imported from the merged B2A contracts module, never redefined", () => {
    expect(RUN_CODE).toMatch(/import\s*{[^}]*NORMALIZER_VERSION[^}]*}\s*from\s*["']\.\.\/normalization\/contracts["']/);
    expect(RUN_CODE).not.toMatch(/const\s+NORMALIZER_VERSION\s*=/);
  });

  it("a new run stores exactly NORMALIZER_VERSION as normalizer_version", () => {
    expect(RUN_CODE).toMatch(/normalizer_version:\s*NORMALIZER_VERSION/);
  });

  it("resume rejects an unsupported normalizer_version BEFORE ever returning a successful ActiveNormalizationRun, with a stable code", () => {
    // FINAL REMEDIATION note: the normalizer_version check now runs AFTER
    // the post-takeover context-resolution try/catch (which resolves the
    // plan together with the other reads, so all three share ONE narrow
    // try/catch -- see the dedicated describe block below), rather than
    // before the resolvePlanForPinnedVersion call textually. What still
    // holds, and is asserted here: the version check happens strictly
    // BEFORE the function can ever return a successful run (an unsupported
    // version can never slip through to a returned ActiveNormalizationRun).
    const existingBranchStart = RUN_CODE.indexOf("if (existing) {");
    const versionCheckIdx = RUN_CODE.indexOf("run.normalizer_version !== NORMALIZER_VERSION", existingBranchStart);
    const successReturnIdx = RUN_CODE.indexOf("alreadyNormalized: false,\n      run: {\n        id: run.id,", existingBranchStart);
    expect(existingBranchStart).toBeGreaterThan(-1);
    expect(versionCheckIdx).toBeGreaterThan(existingBranchStart);
    expect(successReturnIdx).toBeGreaterThan(versionCheckIdx);
    expect(RUN_CODE).toContain('"NORMALIZER_VERSION_UNSUPPORTED"');
  });
});

describe("6.2D4B2A -- pinned-profile / new-run-vs-resume discipline (mirrors D4B's own precedent)", () => {
  it("createOrResumeNormalizationRun's EXISTING-run branch never reads Upload.raw_staging_run_id or resolves new-run eligibility fields", () => {
    const fnStart = RUN_CODE.indexOf("export async function createOrResumeNormalizationRun(");
    const existingBranchStart = RUN_CODE.indexOf("if (existing) {", fnStart);
    const newRunSectionIdx = RUN_CODE.indexOf("upload.raw_staged_at === null", existingBranchStart);
    expect(existingBranchStart).toBeGreaterThan(-1);
    expect(newRunSectionIdx).toBeGreaterThan(existingBranchStart);
    const existingBranchBody = RUN_CODE.slice(existingBranchStart, newRunSectionIdx);
    expect(existingBranchBody).not.toContain("upload.raw_staging_run_id");
    expect(existingBranchBody).not.toContain("upload.raw_profile_version_id");
  });

  it("the resumed-run branch resolves its plan from the run's OWN pinned worksheet_mapping_profile_version_id, never from a freshly-looked-up active pointer", () => {
    const fnStart = RUN_CODE.indexOf("export async function createOrResumeNormalizationRun(");
    const existingBranchStart = RUN_CODE.indexOf("if (existing) {", fnStart);
    const newRunSectionIdx = RUN_CODE.indexOf("upload.raw_staged_at === null", existingBranchStart);
    const existingBranchBody = RUN_CODE.slice(existingBranchStart, newRunSectionIdx);
    expect(existingBranchBody).toMatch(/resolvePlanForPinnedVersion\(\{\s*organisationId,\s*worksheetMappingProfileId:\s*run\.worksheet_mapping_profile_id,\s*worksheetMappingProfileVersionId:\s*run\.worksheet_mapping_profile_version_id/);
  });

  it("resolvePlanForPinnedVersion's own CODE never reads active_profile_version_id, and never queries WorksheetMappingProfile's own active-pointer field", () => {
    const fnStart = RUN_CODE.indexOf("async function resolvePlanForPinnedVersion(");
    const fnEnd = RUN_CODE.indexOf("\n}\n", fnStart);
    const fnBody = RUN_CODE.slice(fnStart, fnEnd);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnBody).not.toContain("active_profile_version_id");
    expect(fnBody).not.toMatch(/prisma\.worksheetMappingProfile\.(findFirst|findUnique|findMany)/);
    expect(fnBody).toContain("prisma.worksheetMappingProfileVersion.findFirst");
  });

  it("mutation proof: the ONLY occurrence(s) of active_profile_version_id in the whole file's real CODE live in a comment-adjacent identifier check, never in resolvePlanForPinnedVersion or the existing-run branch -- changing resume to read the active pointer would require introducing a NEW occurrence this test would catch", () => {
    const occurrences = (RUN_CODE.match(/active_profile_version_id/g) ?? []).length;
    // The only legitimate occurrence is the new-run-eligibility comment's
    // own prose being stripped already (comments removed) -- so in the
    // real CODE, there must be ZERO occurrences at all: a genuinely new run
    // is pinned from the RAW RUN's own already-pinned IDs (never reads
    // WorksheetMappingProfile.active_profile_version_id itself), exactly
    // like D4B's own resolveStagingEligibility precedent but one layer
    // removed (B2B2A pins from the raw run, not from the profile's active
    // pointer directly).
    expect(occurrences).toBe(0);
  });

  it("normalizeWorksheetRows.ts never calls createOrResumeNormalizationRun nor resolves eligibility -- it derives everything from the caller-supplied ActiveNormalizationRun", () => {
    expect(BATCH_CODE).not.toContain("createOrResumeNormalizationRun");
    expect(BATCH_CODE).not.toContain("resolvePlanForPinnedVersion");
    expect(BATCH_CODE).not.toContain("active_profile_version_id");
  });
});

describe("6.2D4B2A -- new-run eligibility gate", () => {
  it("requires lineage_kind DATA_HUB and every listed raw-staging completion field before allowing a new run", () => {
    const fnStart = RUN_CODE.indexOf("export async function createOrResumeNormalizationRun(");
    const uploadQueryIdx = RUN_CODE.indexOf("prisma.upload.findFirst(", fnStart);
    const region = RUN_CODE.slice(uploadQueryIdx, uploadQueryIdx + 400);
    expect(region).toContain('lineage_kind: "DATA_HUB"');
    for (const field of ["raw_staged_at", "raw_staging_run_id", "raw_profile_version_id", "raw_row_count", "raw_cell_count", "normalized_at"]) {
      expect(RUN_CODE, field).toContain(field);
    }
  });

  it("loads the EXACT Upload.raw_staging_run_id -- never searches for another SUCCEEDED raw run by any other means", () => {
    const newRunSectionIdx = RUN_CODE.indexOf("upload.raw_staged_at === null");
    const rawRunQueryIdx = RUN_CODE.indexOf("prisma.dataHubRawStagingRun.findFirst(", newRunSectionIdx);
    const region = RUN_CODE.slice(rawRunQueryIdx, rawRunQueryIdx + 300);
    expect(region).toContain("id: upload.raw_staging_run_id");
    expect(region).toContain("upload_id: uploadId");
    // No orderBy/status-only search pattern that would pick "some" SUCCEEDED run.
    expect(RUN_CODE.slice(newRunSectionIdx)).not.toMatch(/dataHubRawStagingRun\.findFirst\(\s*\{\s*where:\s*\{\s*organisation_id[^}]*status:\s*["']SUCCEEDED["'][^}]*\}\s*,\s*orderBy/);
  });

  it("pins exactly the raw run's six lineage IDs onto the new normalization run", () => {
    const createIdx = RUN_CODE.indexOf("prisma.dataHubNormalizationRun.create(");
    const createRegion = RUN_CODE.slice(createIdx, createIdx + 900);
    for (const field of ["import_batch_id: rawRun.import_batch_id", "raw_staging_run_id: upload.raw_staging_run_id", "source_schema_version_id: rawRun.source_schema_version_id", "source_schema_worksheet_id: rawRun.source_schema_worksheet_id", "worksheet_mapping_profile_id: rawRun.worksheet_mapping_profile_id", "worksheet_mapping_profile_version_id: rawRun.worksheet_mapping_profile_version_id"]) {
      expect(createRegion, field).toContain(field);
    }
  });

  it("expected counts come from the raw run's own durable persisted counts, never a rescan", () => {
    expect(RUN_CODE).toMatch(/expectedRowCount\s*=\s*rawRun\.persisted_row_count/);
    expect(RUN_CODE).toMatch(/expectedCellCount\s*=\s*rawRun\.persisted_cell_count/);
  });

  it("attempt_number uses max prior attempt_number for this upload + 1 (D4B lifecycle convention)", () => {
    expect(RUN_CODE).toMatch(/_max:\s*\{\s*attempt_number:\s*true\s*\}/);
    expect(RUN_CODE).toMatch(/attemptAgg\._max\.attempt_number\s*\?\?\s*0\)\s*\+\s*1/);
  });

  it("does not create a RUNNING run until the plan is known valid -- plan resolution happens before prisma.dataHubNormalizationRun.create", () => {
    const newRunSectionIdx = RUN_CODE.indexOf("upload.raw_staged_at === null");
    const planIdx = RUN_CODE.indexOf("resolvePlanForPinnedVersion(", newRunSectionIdx);
    const createIdx = RUN_CODE.indexOf("prisma.dataHubNormalizationRun.create(", newRunSectionIdx);
    expect(planIdx).toBeGreaterThan(newRunSectionIdx);
    expect(createIdx).toBeGreaterThan(planIdx);
  });
});

describe("6.2D4B2A -- resume-cursor contract", () => {
  it("derives the resume cursor from MAX(source_row_number) on data_hub_normalized_rows, scoped by run + organisation -- never persisted_row_count", () => {
    expect(BATCH_CODE).toMatch(/SELECT max\(source_row_number\) AS m FROM data_hub_normalized_rows/);
    expect(BATCH_CODE).toMatch(/WHERE normalization_run_id = \$\{run\.id\} AND organisation_id = \$\{run\.organisationId\}/);
    // The cursor query itself must not reference persisted_row_count.
    const cursorQueryIdx = BATCH_CODE.indexOf("SELECT max(source_row_number)");
    const cursorQueryEnd = BATCH_CODE.indexOf("`", cursorQueryIdx);
    expect(BATCH_CODE.slice(cursorQueryIdx, cursorQueryEnd)).not.toContain("persisted_row_count");
  });

  it("fetches raw rows with source_row_number strictly greater than the cursor, ordered ascending", () => {
    expect(BATCH_CODE).toMatch(/orderBy:\s*\{\s*source_row_number:\s*["']asc["']\s*\}/);
    expect(BATCH_CODE).toMatch(/source_row_number:\s*\{\s*gt:\s*afterSourceRowNumber\s*\}/);
  });
});

describe("6.2D4B2A -- raw-row batching / raw-input contract", () => {
  it("loads raw rows/cells directly from data_hub_raw_rows/data_hub_raw_cells (Prisma models), scoped to organisation + pinned raw_staging_run + pinned worksheet/version lineage", () => {
    const fnStart = BATCH_CODE.indexOf("async function loadRawRowBatch(");
    const fnEnd = BATCH_CODE.indexOf("\n}\n", fnStart);
    const fnBody = BATCH_CODE.slice(fnStart, fnEnd);
    expect(fnBody).toContain("prisma.dataHubRawRow.findMany(");
    expect(fnBody).toContain("organisation_id: run.organisationId");
    expect(fnBody).toContain("staging_run_id: run.rawStagingRunId");
    expect(fnBody).toContain("source_schema_worksheet_id: run.sourceSchemaWorksheetId");
    expect(fnBody).toContain("source_schema_version_id: run.sourceSchemaVersionId");
  });

  it("builds B2A raw inputs from exactly rawValueType/rawValue/sourceSchemaColumnId -- no coercion before B2A", () => {
    expect(BATCH_CODE).toMatch(/rawValueType:\s*c\.rawValueType,\s*rawValue:\s*c\.rawValue/);
  });

  it("never references Upload preview/columns_detected/field_mappings JSON or any workbook parser type", () => {
    expect(BATCH_CODE).not.toMatch(/preview_rows|columns_detected|field_mappings/);
    expect(BATCH_CODE).not.toMatch(/WorksheetDataRow|readWorksheetDataRows/);
  });

  it("batch sizing reuses the existing staging config convention (resolveTargetCellsPerBatch/resolveLeaseSeconds), never a hard-coded duplicate constant module", () => {
    expect(BATCH_CODE).toMatch(/import\s*{\s*resolveLeaseSeconds,\s*resolveTargetCellsPerBatch\s*}\s*from\s*["']\.\.\/staging\/stagingConfig["']/);
  });

  it("always attempts at least one batch before checking the time budget (never returns RUNNING with zero progress purely because maxDurationMs was small)", () => {
    const budgetCheckIdx = BATCH_CODE.indexOf("Date.now() - startedAt > maxDurationMs");
    const firstLoadIdx = BATCH_CODE.indexOf("loadRawRowBatch(run, resumeCursor, rowsPerCall)");
    expect(firstLoadIdx).toBeGreaterThan(-1);
    expect(budgetCheckIdx).toBeGreaterThan(firstLoadIdx);
  });
});

describe("6.2D4B2A -- transform/persistence contract", () => {
  it("transforms each raw row via the merged B2A transformRow, never a locally-reimplemented transform", () => {
    expect(BATCH_CODE).toMatch(/import\s*{\s*transformRow,\s*type RawCellForColumn\s*}\s*from\s*["']\.\.\/normalization\/transformRow["']/);
    expect(BATCH_CODE).toContain("transformRow({ rawRowId: rawRow.id, sourceRowNumber: rawRow.sourceRowNumber }, cellsForColumn, run.plan)");
  });

  it("every transformed batch persists through exactly ONE call to datahub_stage_normalized_batch, never individual Prisma creates for normalized rows/cells/findings", () => {
    const occurrences = (BATCH_CODE.match(/datahub_stage_normalized_batch/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(BATCH_CODE).not.toMatch(/prisma\.dataHubNormalizedRow\.create/);
    expect(BATCH_CODE).not.toMatch(/prisma\.dataHubNormalizedCell\.create/);
    expect(BATCH_CODE).not.toMatch(/prisma\.dataHubNormalizationFinding\.create/);
  });

  it("passes normalization run id, organisation, execution token, normalized payload, finding payload, and lease seconds -- in that call", () => {
    const callIdx = BATCH_CODE.indexOf("datahub_stage_normalized_batch(");
    const callRegion = BATCH_CODE.slice(callIdx, callIdx + 300);
    expect(callRegion).toContain("run.id");
    expect(callRegion).toContain("run.organisationId");
    expect(callRegion).toContain("run.executionToken");
    expect(callRegion).toContain("normalizedPayload");
    expect(callRegion).toContain("findingPayload");
    expect(callRegion).toContain("leaseSeconds");
  });

  it("normalized cell payload carries fresh ids and copies sourceUnit/normalizedUnit only from the B2A output (never re-derived from source_header or anywhere else)", () => {
    const cellMapIdx = BATCH_CODE.indexOf("cells: result.outputs.map(");
    const cellMapRegion = BATCH_CODE.slice(cellMapIdx, cellMapIdx + 400);
    expect(cellMapRegion).toContain("sourceUnit: o.sourceUnit");
    expect(cellMapRegion).toContain("normalizedUnit: o.normalizedUnit");
    expect(cellMapRegion).not.toMatch(/source_header|sourceHeader/);
  });
});

describe("6.2D4B2A -- blocking-row behaviour (point 9)", () => {
  it("a row with any BLOCKING_ERROR finding is EXCLUDED from the normalized payload -- findings pushed and the row loop breaks BEFORE the normalized-payload push", () => {
    const hasBlockingIdx = BATCH_CODE.indexOf("const hasBlocking =");
    const findingPushIdx = BATCH_CODE.indexOf("findingPayload.push(", hasBlockingIdx);
    const breakIdx = BATCH_CODE.indexOf("blockingEncountered = true", hasBlockingIdx);
    const normalizedPushIdx = BATCH_CODE.indexOf("normalizedPayload.push(", hasBlockingIdx);
    expect(hasBlockingIdx).toBeGreaterThan(-1);
    expect(findingPushIdx).toBeGreaterThan(hasBlockingIdx);
    expect(breakIdx).toBeGreaterThan(findingPushIdx);
    expect(normalizedPushIdx).toBeGreaterThan(breakIdx);
  });

  it("earlier successful rows in the SAME batch persist together with the blocking row's findings in one atomic call (no separate early flush)", () => {
    // The single datahub_stage_normalized_batch call happens AFTER the
    // per-row for-loop (which may break early on a blocking row) -- not
    // inside the loop -- so any normalizedPayload entries accumulated
    // before the break are included in the SAME call as the blocking
    // finding.
    const loopEnd = BATCH_CODE.indexOf("if (normalizedPayload.length > 0 || findingPayload.length > 0)");
    const forLoopStart = BATCH_CODE.indexOf("for (const rawRow of rawRows)");
    expect(forLoopStart).toBeGreaterThan(-1);
    expect(loopEnd).toBeGreaterThan(forLoopStart);
  });

  it("after a blocking row's evidence is persisted, the run transitions to FAILED under the SAME live lease with a stable, bounded, non-PII failure code/detail", () => {
    expect(BATCH_CODE).toMatch(/import\s*{\s*markNormalizationRunFailed,\s*releaseNormalizationLeaseForYield\s*}\s*from\s*["']\.\/dataHubNormalizationRun["']/);
    expect(BATCH_CODE).toContain('failureCode: "NORMALIZATION_BLOCKED"');
    expect(BATCH_CODE).toContain('failureDetail: "One or more blocking normalization findings were persisted."');
    // The failure-transition call happens strictly AFTER the persistence call.
    const persistIdx = BATCH_CODE.indexOf("datahub_stage_normalized_batch(");
    const markFailedIdx = BATCH_CODE.indexOf("markNormalizationRunFailed(", persistIdx);
    expect(markFailedIdx).toBeGreaterThan(persistIdx);
  });

  it("once blockingEncountered is true, the function returns immediately -- no later batch/page is fetched (does not continue to later source rows)", () => {
    const blockingBranchIdx = BATCH_CODE.indexOf("if (blockingEncountered) {");
    const returnBlockedIdx = BATCH_CODE.indexOf('code: "NORMALIZATION_BLOCKED"', blockingBranchIdx);
    const nextLoadIdx = BATCH_CODE.indexOf("loadRawRowBatch(", blockingBranchIdx);
    expect(blockingBranchIdx).toBeGreaterThan(-1);
    expect(returnBlockedIdx).toBeGreaterThan(blockingBranchIdx);
    // No further loadRawRowBatch call exists after the blocking branch --
    // it always returns out of the outer loop.
    expect(nextLoadIdx).toBe(-1);
  });

  it("mutation proof: removing the blockingEncountered break is caught -- the break statement is the only thing preventing a blocking row's sibling rows in the SAME page from also being transformed", () => {
    const hasBlockingIdx = BATCH_CODE.indexOf("if (hasBlocking) {");
    const breakStmtIdx = BATCH_CODE.indexOf("break;", hasBlockingIdx);
    const nextForIterationBoundary = BATCH_CODE.indexOf("normalizedPayload.push(", hasBlockingIdx);
    expect(hasBlockingIdx).toBeGreaterThan(-1);
    expect(breakStmtIdx).toBeGreaterThan(hasBlockingIdx);
    expect(breakStmtIdx).toBeLessThan(nextForIterationBoundary);
  });
});

describe("6.2D4B2A -- failure/yield lease semantics", () => {
  it("markNormalizationRunFailed requires exact run id, organisation, RUNNING, exact execution token, and a live unexpired lease", () => {
    const fnStart = RUN_CODE.indexOf("export async function markNormalizationRunFailed(");
    const fnEnd = RUN_CODE.indexOf("\n}\n", fnStart);
    const fnBody = RUN_CODE.slice(fnStart, fnEnd);
    expect(fnBody).toContain("status = 'RUNNING' AND execution_token = ${context.executionToken}");
    expect(fnBody).toContain("AND lease_expires_at > now()");
    expect(fnBody).toMatch(/return rows\.length === 1/);
  });

  it("releaseNormalizationLeaseForYield sets lease_expires_at = now() only for the exact run/organisation/token/RUNNING", () => {
    const fnStart = RUN_CODE.indexOf("export async function releaseNormalizationLeaseForYield(");
    const fnEnd = RUN_CODE.indexOf("\n}\n", fnStart);
    const fnBody = RUN_CODE.slice(fnStart, fnEnd);
    expect(fnBody).toContain("SET lease_expires_at = now()");
    expect(fnBody).toContain("execution_token = ${context.executionToken} AND status = 'RUNNING'");
  });

  it("normalizeWorksheetRows releases the lease for yield ONLY when more work remains (pageExhausted is false) and the time budget is spent -- never on a small maxDurationMs with zero remaining work", () => {
    const yieldIdx = BATCH_CODE.indexOf("releaseNormalizationLeaseForYield(");
    const pageExhaustedCheckIdx = BATCH_CODE.indexOf("if (pageExhausted) {");
    expect(pageExhaustedCheckIdx).toBeGreaterThan(-1);
    expect(yieldIdx).toBeGreaterThan(pageExhaustedCheckIdx);
  });

  it("a failed lease release after yield reports LEASE_LOST rather than a now-untrue RUNNING", () => {
    const yieldIdx = BATCH_CODE.indexOf("releaseNormalizationLeaseForYield(");
    const region = BATCH_CODE.slice(yieldIdx, yieldIdx + 300);
    expect(region).toContain("if (!released)");
    expect(region).toContain('code: "LEASE_LOST"');
  });

  it("a persistence-call exception classifies known lease/token RAISE text as LEASE_LOST, and never leaks the raw error message into the returned code", () => {
    const fnStart = BATCH_CODE.indexOf("function classifyPersistenceError(");
    const fnEnd = BATCH_CODE.indexOf("\n}\n", fnStart);
    const fnBody = BATCH_CODE.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/lease not held before insert\|lease lost before progress commit/);
    expect(fnBody).toContain('"PERSISTENCE_FAILURE"');
    // The classifier returns a closed code, never the message itself.
    expect(fnBody).not.toMatch(/return\s+message/);
  });
});

describe("6.2D4B2A -- completion semantics", () => {
  it("calls the existing datahub_complete_normalization_run with exactly run id, organisation, actor user id, execution token -- never duplicates its reconciliation logic", () => {
    expect(COMPLETE_CODE).toMatch(/datahub_complete_normalization_run\(\$\{runId\},\s*\$\{organisationId\},\s*\$\{completedByUserId\},\s*\$\{executionToken\}\)/);
    // No local reimplementation of row/cell count reconciliation.
    expect(COMPLETE_CODE).not.toMatch(/actual_row_count|expected_row_count|blocking_finding_count/);
  });

  it("does not read/write Upload.normalized_* columns directly -- the SQL function remains the sole writer", () => {
    expect(COMPLETE_CODE).not.toMatch(/normalized_row_count\s*[:=]|normalized_cell_count\s*[:=]|normalized_profile_version_id\s*[:=]/);
  });

  it("a lease pre-check runs before the completion call, and never leaks the raw caught DB error into the returned result", () => {
    const preCheckIdx = COMPLETE_CODE.indexOf("prisma.dataHubNormalizationRun.findFirst(");
    const completionCallIdx = COMPLETE_CODE.indexOf("datahub_complete_normalization_run(");
    expect(preCheckIdx).toBeGreaterThan(-1);
    expect(completionCallIdx).toBeGreaterThan(preCheckIdx);
    expect(COMPLETE_CODE).toMatch(/catch\s*\{\s*[\s\S]*?return\s*\{\s*ok:\s*false,\s*code:\s*"COMPLETION_REJECTED"\s*\}/);
  });
});

describe("6.2D4B2A -- already-normalized short-circuit", () => {
  it("returns {ok:true, alreadyNormalized:true} without creating a run or altering completed metadata when Upload.normalized_at is already set", () => {
    const idx = RUN_CODE.indexOf("upload.normalized_at !== null");
    expect(idx).toBeGreaterThan(-1);
    const region = RUN_CODE.slice(idx, idx + 100);
    expect(region).toMatch(/return\s*\{\s*ok:\s*true,\s*alreadyNormalized:\s*true\s*\}/);
    // This check happens BEFORE any run lookup/creation.
    const existingLookupIdx = RUN_CODE.indexOf("prisma.dataHubNormalizationRun.findFirst(");
    expect(existingLookupIdx).toBeGreaterThan(idx);
  });
});

describe("6.2D4B2A -- closed failure-code contract", () => {
  it("CreateOrResumeNormalizationFailureCode is a closed union containing every required code", () => {
    const typeIdx = RUN_CODE.indexOf("export type CreateOrResumeNormalizationFailureCode =");
    const typeEnd = RUN_CODE.indexOf(";", typeIdx);
    const region = RUN_CODE.slice(typeIdx, typeEnd);
    for (const code of ["INVALID_STATE", "RAW_STAGING_NOT_COMPLETE", "RAW_RUN_NOT_SUCCEEDED", "NORMALIZATION_INELIGIBLE", "PROFILE_DOCUMENT_INVALID", "NORMALIZATION_PLAN_INVALID", "NORMALIZER_VERSION_UNSUPPORTED", "RUN_ALREADY_IN_PROGRESS"]) {
      expect(region, code).toContain(code);
    }
  });

  it("NormalizeBatchesFailureCode and CompleteNormalizationRunFailureCode are each closed unions with the required codes", () => {
    expect(BATCH_CODE).toMatch(/export type NormalizeBatchesFailureCode = "LEASE_LOST" \| "PERSISTENCE_FAILURE" \| "NORMALIZATION_BLOCKED"/);
    expect(COMPLETE_CODE).toMatch(/export type CompleteNormalizationRunFailureCode = "INVALID_STATE" \| "LEASE_LOST" \| "COMPLETION_REJECTED"/);
  });
});

describe("6.2D4B2A -- privacy / purity (point 20)", () => {
  it("no console.log/console.error/logger call anywhere in the three service files", () => {
    for (const code of [RUN_CODE, BATCH_CODE, COMPLETE_CODE]) {
      expect(code).not.toMatch(/console\.(log|error|warn|info|debug)\s*\(/);
      expect(code).not.toMatch(/\blogger\s*\(/);
    }
  });

  it("no raw cell value (c.rawValue/cell.value/rawValue) is ever interpolated into a string template outside the transform input construction itself", () => {
    // The ONLY legitimate occurrence of `rawValue` as an object VALUE
    // (not a bare identifier read) is the RawCellInput construction that
    // feeds it to the pure B2A transformer -- never into a string/error.
    const rawValueUsages = [...BATCH_CODE.matchAll(/rawValue[^,\n]*/g)].map((m) => m[0]);
    for (const usage of rawValueUsages) {
      expect(usage).not.toMatch(/RAISE|Error\(|throw|`.*\$\{.*rawValue/);
    }
  });

  it("failure_detail passed to markNormalizationRunFailed is a fixed, bounded literal string -- never a template built from row/cell/finding content", () => {
    const callIdx = BATCH_CODE.indexOf("markNormalizationRunFailed({");
    const callRegion = BATCH_CODE.slice(callIdx, callIdx + 300);
    expect(callRegion).toMatch(/failureDetail:\s*"[^`$]*"/);
  });

  it("finding payload never carries a message/detail/raw-value field -- only the closed governed-metadata set", () => {
    const findingPushRegion = BATCH_CODE.slice(BATCH_CODE.indexOf("findingPayload.push({"), BATCH_CODE.indexOf("findingPayload.push({") + 300);
    expect(findingPushRegion).not.toMatch(/message|detail|rawValue/);
  });
});

describe("6.2D4B2A -- ActiveNormalizationRun contract shape", () => {
  it("declares every field the task's own contract lists, and carries a resolved NormalizationPlan (not raw profile_document)", () => {
    const ifaceStart = RUN_CODE.indexOf("export interface ActiveNormalizationRun {");
    const ifaceEnd = RUN_CODE.indexOf("}", ifaceStart);
    const iface = RUN_CODE.slice(ifaceStart, ifaceEnd);
    for (const field of ["id", "organisationId", "importBatchId", "uploadId", "rawStagingRunId", "sourceSchemaVersionId", "sourceSchemaWorksheetId", "worksheetMappingProfileId", "worksheetMappingProfileVersionId", "normalizerVersion", "executionToken", "expectedRowCount", "expectedCellCount", "persistedRowCount", "persistedCellCount", "plan"]) {
      expect(iface, field).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(iface).toContain("plan: NormalizationPlan");
  });
});

describe("6.2D4B2A -- B2A contracts consumed verbatim (sanity cross-check against the merged sibling module)", () => {
  it("NORMALIZER_VERSION is exported as a literal, exactly what the run-lifecycle module imports", () => {
    expect(CONTRACTS_TS).toMatch(/export const NORMALIZER_VERSION = "v1" as const/);
  });
});

describe("6.2D4B2A REMEDIATION (blocker 1) -- resume pinned-context failures durably dispose of the run", () => {
  it("LEASE_LOST and PERSISTENCE_FAILURE are part of the closed failure-code union", () => {
    const typeIdx = RUN_CODE.indexOf("export type CreateOrResumeNormalizationFailureCode =");
    const typeEnd = RUN_CODE.indexOf(";", typeIdx);
    const region = RUN_CODE.slice(typeIdx, typeEnd);
    expect(region).toContain("LEASE_LOST");
    expect(region).toContain("PERSISTENCE_FAILURE");
  });

  it("failResumedRunAndReturn durably fails the run via markNormalizationRunFailed, and reports LEASE_LOST if that transition cannot apply", () => {
    const fnStart = RUN_CODE.indexOf("async function failResumedRunAndReturn(");
    const fnEnd = RUN_CODE.indexOf("\n}\n", fnStart);
    const fnBody = RUN_CODE.slice(fnStart, fnEnd);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnBody).toContain("markNormalizationRunFailed({");
    expect(fnBody).toMatch(/if \(!failed\) \{\s*return \{ ok: false, code: "LEASE_LOST" \};/);
    // failureDetail is never passed -- no profile contents, raw values, or
    // exception text; the closed failure code is the ONLY signal recorded.
    expect(fnBody).not.toContain("failureDetail");
  });

  it("all three pinned-context validation failure sites in the resume branch route through failResumedRunAndReturn, never a bare return", () => {
    const existingBranchStart = RUN_CODE.indexOf("if (existing) {");
    const newRunSectionIdx = RUN_CODE.indexOf("upload.raw_staged_at === null", existingBranchStart);
    const existingBranchBody = RUN_CODE.slice(existingBranchStart, newRunSectionIdx);
    const occurrences = (existingBranchBody.match(/failResumedRunAndReturn\(/g) ?? []).length;
    expect(occurrences).toBe(3); // normalizer_version, raw run status, plan resolution
    // No bare `return { ok: false, code: ... }` for any of these three
    // checks -- every one goes through the durable-disposition helper.
    expect(existingBranchBody).not.toMatch(/normalizer_version !== NORMALIZER_VERSION\) \{\s*return \{ ok: false/);
    expect(existingBranchBody).not.toMatch(/RAW_RUN_NOT_SUCCEEDED" \};\s*\}\s*\n\s*\/\/ PINNED_RESUME_PLAN_BEGIN/);
  });

  it("mutation proof: the TERMINAL_DISPOSITION markers bound exactly the durable-failure logic -- stripping between them (as the live harness mutation does) removes the markNormalizationRunFailed call entirely", () => {
    const beginIdx = RUN_TS.indexOf("// TERMINAL_DISPOSITION_BEGIN");
    const endIdx = RUN_TS.indexOf("// TERMINAL_DISPOSITION_END");
    expect(beginIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(beginIdx);
    const insideBlock = RUN_TS.slice(beginIdx, endIdx);
    expect(insideBlock).toContain("markNormalizationRunFailed(");
    const outsideBlock = RUN_TS.slice(0, beginIdx) + RUN_TS.slice(endIdx);
    // markNormalizationRunFailed's own DEFINITION (further down the file)
    // still legitimately contains "markNormalizationRunFailed" in its own
    // `export async function markNormalizationRunFailed(` signature -- so
    // this asserts the CALL SITE specifically (with parens immediately
    // after, matching a function invocation) is gone outside the block.
    expect(outsideBlock).not.toMatch(/[^n]\bmarkNormalizationRunFailed\(\{/);
  });
});

describe("6.2D4B2A REMEDIATION (blocker 2) -- new-run create-race is translated, never leaked", () => {
  it("imports Prisma's typed known-request-error mechanism, never string-matches raw driver text", () => {
    expect(RUN_CODE).toMatch(/import\s*{\s*Prisma\s*}\s*from\s*["']@prisma\/client["']/);
    expect(RUN_CODE).toContain("err instanceof Prisma.PrismaClientKnownRequestError");
    expect(RUN_CODE).toContain('err.code === "P2002"');
  });

  it("the create() call is wrapped in try/catch, and a P2002 is INDEPENDENTLY verified against current DB state before concluding RUN_ALREADY_IN_PROGRESS", () => {
    const createIdx = RUN_CODE.indexOf("await prisma.dataHubNormalizationRun.create(");
    const catchIdx = RUN_CODE.indexOf("} catch (err) {", createIdx);
    expect(createIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(createIdx);
    const catchBody = RUN_CODE.slice(catchIdx, RUN_CODE.indexOf("\n  }", catchIdx));
    expect(catchBody).toMatch(/prisma\.dataHubNormalizationRun\.findFirst\(\{\s*where:\s*\{\s*organisation_id:\s*organisationId,\s*upload_id:\s*uploadId,\s*status:\s*"RUNNING"/);
    expect(catchBody).toContain('code: "RUN_ALREADY_IN_PROGRESS"');
  });

  it("never blindly maps every create() failure to RUN_ALREADY_IN_PROGRESS -- a P2002 without a confirmed RUNNING row, or any other exception, falls through to PERSISTENCE_FAILURE", () => {
    const catchIdx = RUN_CODE.indexOf("} catch (err) {");
    const catchBody = RUN_CODE.slice(catchIdx, RUN_CODE.indexOf("\n  }", catchIdx));
    // The RUN_ALREADY_IN_PROGRESS return sits INSIDE the `if (nowRunning)`
    // branch; the function's own final statement (reached whenever that
    // branch doesn't return) is the PERSISTENCE_FAILURE fallback.
    const nowRunningIdx = catchBody.indexOf("if (nowRunning)");
    const fallbackIdx = catchBody.lastIndexOf('code: "PERSISTENCE_FAILURE"');
    expect(nowRunningIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(nowRunningIdx);
  });

  it("mutation proof: the CREATE_RACE_TRANSLATION markers bound exactly the P2002-translation logic -- stripping between them (as the live harness mutation does) removes the typed-error check entirely", () => {
    const beginIdx = RUN_TS.indexOf("// CREATE_RACE_TRANSLATION_BEGIN");
    const endIdx = RUN_TS.indexOf("// CREATE_RACE_TRANSLATION_END");
    expect(beginIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(beginIdx);
    const insideBlock = RUN_TS.slice(beginIdx, endIdx);
    expect(insideBlock).toContain("Prisma.PrismaClientKnownRequestError");
    expect(insideBlock).toContain('"RUN_ALREADY_IN_PROGRESS"');
  });
});

describe("6.2D4B2A REMEDIATION (hardening 3) -- completion race window classifies via a DB re-check, never SQL-error text", () => {
  it("on a caught completion exception, re-reads the run by exact organisation+run id (never parses/inspects the caught error's own text)", () => {
    const catchIdx = COMPLETE_CODE.indexOf("} catch {");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBody = COMPLETE_CODE.slice(catchIdx);
    expect(catchBody).toMatch(/prisma\.dataHubNormalizationRun\.findFirst\(\{\s*where:\s*\{\s*id:\s*runId,\s*organisation_id:\s*organisationId\s*\}/);
  });

  it("classifies LEASE_LOST when the re-read state no longer proves this caller owns the lease, COMPLETION_REJECTED otherwise -- the DB function remains the sole reconciliation authority (no local count/blocking-finding logic)", () => {
    const catchIdx = COMPLETE_CODE.indexOf("} catch {");
    const catchBody = COMPLETE_CODE.slice(catchIdx);
    expect(catchBody).toMatch(/current\.status !== "RUNNING" \|\| current\.execution_token !== executionToken \|\| current\.lease_expires_at\.getTime\(\) <= Date\.now\(\)/);
    expect(catchBody).toContain('code: "LEASE_LOST"');
    expect(catchBody).toContain('code: "COMPLETION_REJECTED"');
    expect(COMPLETE_CODE).not.toMatch(/actual_row_count|expected_row_count|blocking_finding_count/);
  });
});

describe("6.2D4B2A FINAL REMEDIATION -- post-takeover DB/Prisma read failure never escapes, never falsely durably fails the run", () => {
  it("declares the narrow releaseClaimAfterResolutionFailure helper, distinct from failResumedRunAndReturn -- releases the SAME lease, never calls markNormalizationRunFailed", () => {
    const fnStart = RUN_CODE.indexOf("async function releaseClaimAfterResolutionFailure(");
    const fnEnd = RUN_CODE.indexOf("\n}\n", fnStart);
    const fnBody = RUN_CODE.slice(fnStart, fnEnd);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnBody).toContain("releaseNormalizationLeaseForYield(");
    expect(fnBody).not.toContain("markNormalizationRunFailed(");
    expect(fnBody).toMatch(/if \(!released\) \{\s*return \{ ok: false, code: "LEASE_LOST" \};/);
    expect(fnBody).toContain('code: "PERSISTENCE_FAILURE"');
  });

  it("the three post-takeover context-resolution reads (run reread, raw-run read, plan resolution) are wrapped in ONE try/catch that routes exclusively through releaseClaimAfterResolutionFailure", () => {
    const beginIdx = RUN_TS.indexOf("POST_TAKEOVER_DB_FAILURE_BEGIN");
    const endIdx = RUN_TS.indexOf("// POST_TAKEOVER_DB_FAILURE_END");
    expect(beginIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(beginIdx);
    const block = RUN_TS.slice(beginIdx, endIdx);
    expect(block).toContain("findFirstOrThrow(");
    expect(block).toContain("dataHubRawStagingRun.findFirst(");
    expect(block).toContain("resolvePlanForPinnedVersion(");
    expect(block).toMatch(/try\s*\{/);
    expect(block).toMatch(/\}\s*catch\s*\{\s*return await releaseClaimAfterResolutionFailure\(organisationId, existing\.id, newToken\);\s*\}/);
  });

  it("deterministic validation checks (normalizer_version, raw run status, plan result) sit OUTSIDE the try/catch -- a non-throwing failure code is never caught/reclassified as transient", () => {
    const endIdx = RUN_TS.indexOf("// POST_TAKEOVER_DB_FAILURE_END");
    const afterBlock = RUN_TS.slice(endIdx, endIdx + 800);
    expect(afterBlock).toContain("failResumedRunAndReturn(organisationId, run.id, newToken, \"NORMALIZER_VERSION_UNSUPPORTED\")");
    expect(afterBlock).toContain("failResumedRunAndReturn(organisationId, run.id, newToken, \"RAW_RUN_NOT_SUCCEEDED\")");
    expect(afterBlock).toContain("failResumedRunAndReturn(organisationId, run.id, newToken, planResult.code)");
  });

  it("never exposes Prisma/driver/SQL error text -- the catch clause discards the caught error entirely (no error variable, no message interpolation)", () => {
    const beginIdx = RUN_TS.indexOf("POST_TAKEOVER_DB_FAILURE_BEGIN");
    const endIdx = RUN_TS.indexOf("// POST_TAKEOVER_DB_FAILURE_END");
    const block = RUN_TS.slice(beginIdx, endIdx);
    expect(block).toMatch(/\}\s*catch\s*\{/); // no bound error identifier
    expect(block).not.toMatch(/catch\s*\(\s*\w+\s*\)/);
  });

  it("mutation proof marker sanity: the post-takeover DB-failure block markers exist and bound exactly the three reads", () => {
    expect(RUN_TS).toContain("POST_TAKEOVER_DB_FAILURE_BEGIN");
    expect(RUN_TS).toContain("POST_TAKEOVER_DB_FAILURE_END");
  });
});
