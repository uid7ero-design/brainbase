import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Data Hub 6.2D4C-B2B1 — normalization EXECUTION PERSISTENCE foundation.
// Static source-text containment, mirroring the established idiom from
// tests/containment/dataHubNormalizedStagingFoundation.test.ts. Behavioral
// proof (real Postgres: idempotency, FK tenant/lineage rejection,
// immutability, batch atomicity, lease/replay, completion gate, rollback)
// lives in scripts/tests/verify-datahub-normalization-findings.sh — this
// file only proves the static shape and the absence of forbidden patterns.

const ROOT = path.resolve(__dirname, "../..");
// Normalizes CRLF -> LF: this repo's source files are committed as LF, but a
// Windows checkout (core.autocrlf=true) can re-materialize them as CRLF in
// the working tree (e.g. after a rebase re-checks-out every commit) without
// changing the git blob's own content. Several assertions below search for
// a literal "\n" immediately after specific SQL text; without this
// normalization those searches become checkout-dependent rather than
// content-dependent.
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

const MIGRATION = read("scripts/create-datahub-normalization-findings.sql");
const MIGRATION_CODE = stripComments(MIGRATION);
const ROLLBACK = read("scripts/rollback-datahub-normalization-findings.sql");
const ROLLBACK_CODE = stripComments(ROLLBACK);
const D4A_SQL = read("scripts/create-datahub-raw-staging.sql");
const D4B_SQL = read("scripts/create-datahub-raw-staging-runs.sql");
const D4C_B1_SQL = read("scripts/create-datahub-normalized-staging.sql");
const PRISMA = read("prisma/schema.prisma");
const CONTRACTS = read("lib/data-hub/normalization/contracts.ts");

describe("6.2D4C-B2B1 — D4A/D4B/D4C-B1 are completely untouched", () => {
  it("does not modify any prior migration file (this is a new, separate file)", () => {
    expect(D4A_SQL).toContain("CREATE TABLE IF NOT EXISTS public.data_hub_raw_rows");
    expect(D4B_SQL).toContain("CREATE TABLE IF NOT EXISTS public.data_hub_raw_staging_runs");
    expect(D4C_B1_SQL).toContain("CREATE TABLE IF NOT EXISTS public.data_hub_normalization_runs");
  });

  it("never re-declares or drops any D4A/D4B/D4C-B1 table by name (purely additive)", () => {
    expect(MIGRATION_CODE).not.toMatch(/DROP TABLE[^;]*data_hub_(raw_rows|raw_cells|raw_staging_runs|normalization_runs|normalized_rows|normalized_cells)\b/i);
    expect(MIGRATION_CODE).not.toMatch(/CREATE TABLE[^(]*data_hub_(raw_rows|raw_cells|raw_staging_runs|normalization_runs|normalized_rows|normalized_cells)\b/i);
  });

  it("reuses D4C-B1's datahub_guard_normalized_evidence_immutable() verbatim — never redefines it", () => {
    expect(MIGRATION_CODE).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.datahub_guard_normalized_evidence_immutable/);
    expect(MIGRATION_CODE).toContain("EXECUTE FUNCTION public.datahub_guard_normalized_evidence_immutable()");
  });

  it("the ONLY prior-phase function this migration replaces is datahub_complete_normalization_run — via CREATE OR REPLACE, never DROP FUNCTION on it", () => {
    expect(MIGRATION_CODE).not.toMatch(/DROP FUNCTION[^;]*datahub_complete_normalization_run/);
    expect(MIGRATION_CODE).not.toMatch(/DROP FUNCTION[^;]*datahub_guard_(raw_staging_run_lifecycle|normalization_run_lifecycle|upload_raw_staging_metadata|upload_normalization_metadata)/);
  });
});

describe("6.2D4C-B2B1 — findings carry ONLY governed metadata/lineage", () => {
  it("declares exactly the task's field list, no more", () => {
    for (const col of [
      "id", "organisation_id", "normalization_run_id", "raw_row_id", "raw_cell_id",
      "source_schema_column_id", "source_row_number", "severity", "finding_code", "value_kind", "created_at",
    ]) {
      expect(MIGRATION_CODE, col).toContain(`'${col}'`);
    }
  });

  it("never declares a raw_value/message/source_header/free-form-detail column", () => {
    for (const forbidden of ["raw_value", "raw_value_type", "message", "source_header", "detail", "exception_detail", "notes", "'sample'"]) {
      expect(MIGRATION_CODE.toLowerCase(), forbidden).not.toContain(`ensure_column('data_hub_normalization_findings', '${forbidden.replace(/'/g, "")}'`.toLowerCase());
    }
  });

  it("severity is CHECKed against exactly WARNING/BLOCKING_ERROR, mirroring NormalizationFindingSeverity", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalization_findings_severity_check");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalization_findings_severity_check");
    const region = MIGRATION_CODE.slice(idx, idx + 400);
    expect(region).toContain("'WARNING'");
    expect(region).toContain("'BLOCKING_ERROR'");
  });

  it("finding_code is CHECKed against the exact NORMALIZATION_FINDING_CODES allowlist from lib/data-hub/normalization/contracts.ts", () => {
    const codesMatch = CONTRACTS.match(/NORMALIZATION_FINDING_CODES\s*=\s*\[([\s\S]*?)\]\s*as const/);
    expect(codesMatch, "could not locate NORMALIZATION_FINDING_CODES in contracts.ts").not.toBeNull();
    const codes = [...(codesMatch?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(20);
    expect(MIGRATION_CODE).toContain("data_hub_normalization_findings_code_check");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalization_findings_code_check");
    const region = MIGRATION_CODE.slice(idx, idx + 3000);
    for (const code of codes) {
      expect(region, code).toContain(`'${code}'`);
    }
  });

  it("value_kind is nullable and, when present, CHECKed against the exact D4C-A ValueKind vocabulary", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalization_findings_value_kind_check");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalization_findings_value_kind_check");
    const region = MIGRATION_CODE.slice(idx, idx + 700);
    expect(region).toContain("value_kind IS NULL");
    for (const kind of ["STRING", "IDENTIFIER", "INTEGER", "DECIMAL", "BOOLEAN", "DATE", "TIME", "DATETIME", "DURATION", "PERCENTAGE", "CURRENCY", "LATITUDE", "LONGITUDE"]) {
      expect(region, kind).toContain(kind);
    }
  });

  it("raw_cell_id and source_schema_column_id are nullable (row-level findings supported)", () => {
    expect(MIGRATION_CODE).toMatch(/ensure_column\('data_hub_normalization_findings', 'raw_cell_id', 'text', true,/);
    expect(MIGRATION_CODE).toMatch(/ensure_column\('data_hub_normalization_findings', 'source_schema_column_id', 'text', true,/);
  });
});

describe("6.2D4C-B2B1 REMEDIATION — two-shape lineage contract (Blocker 2)", () => {
  it("declares the row-level/cell-level two-shape CHECK constraint with the exact expected definition", () => {
    expect(MIGRATION_CODE).toContain("data_hub_normalization_findings_cell_column_pair_check");
    const idx = MIGRATION_CODE.indexOf("data_hub_normalization_findings_cell_column_pair_check");
    const region = MIGRATION_CODE.slice(idx, idx + 700);
    expect(region).toContain("raw_cell_id IS NULL");
    expect(region).toContain("source_schema_column_id IS NULL");
    expect(region).toContain("raw_cell_id IS NOT NULL");
    expect(region).toContain("source_schema_column_id IS NOT NULL");
  });

  it("is drift-checked via pg_temp.ensure_check, not a bare CREATE/ALTER", () => {
    const idx = MIGRATION_CODE.indexOf("data_hub_normalization_findings_cell_column_pair_check");
    const region = MIGRATION_CODE.slice(Math.max(0, idx - 200), idx);
    expect(region).toContain("pg_temp.ensure_check(");
  });

  it("mutation proof: removing either half of the two-shape OR-clause is caught (the check text requires BOTH the NULL/NULL and NOT NULL/NOT NULL shapes to be present together)", () => {
    const idx = MIGRATION_CODE.indexOf("data_hub_normalization_findings_cell_column_pair_check");
    const region = MIGRATION_CODE.slice(idx, idx + 700);
    // A mutated constraint dropping the "OR" (only permitting ROW-level
    // findings, say) would no longer contain this exact substring — proving
    // this assertion actually depends on the CELL-level branch surviving.
    expect(region).toMatch(/raw_cell_id IS NOT NULL AND source_schema_column_id IS NOT NULL/);
    // Likewise for the ROW-level branch.
    expect(region).toMatch(/raw_cell_id IS NULL AND source_schema_column_id IS NULL/);
  });

  it("Prisma's DataHubNormalizationFinding doc comment documents the exact two-shape contract", () => {
    const idx = PRISMA.indexOf("model DataHubNormalizationFinding {");
    expect(idx).toBeGreaterThan(-1);
    const docComment = PRISMA.slice(Math.max(0, idx - 1600), idx);
    expect(docComment).toContain("data_hub_normalization_findings_cell_column_pair_check");
    expect(docComment).toMatch(/ROW-level finding/);
    expect(docComment).toMatch(/CELL-level finding/);
  });
});

describe("6.2D4C-B2B1 REMEDIATION — finding logical-identity uniqueness (Replay Review)", () => {
  it("declares a drift-checked UNIQUE INDEX over the full logical-identity tuple, COALESCE-normalizing the two nullable columns", () => {
    expect(MIGRATION_CODE).toContain("idx_data_hub_normalization_findings_logical_identity_unique");
    const idx = MIGRATION_CODE.indexOf("idx_data_hub_normalization_findings_logical_identity_unique");
    const region = MIGRATION_CODE.slice(idx, idx + 900);
    expect(region).toContain("CREATE UNIQUE INDEX");
    expect(region).toContain("organisation_id");
    expect(region).toContain("normalization_run_id");
    expect(region).toContain("raw_row_id");
    expect(region).toContain("COALESCE(raw_cell_id");
    expect(region).toContain("finding_code");
    expect(region).toContain("severity");
    expect(region).toContain("COALESCE(value_kind");
  });

  it("is drift-checked via pg_temp.ensure_index, not a bare CREATE UNIQUE INDEX", () => {
    const idx = MIGRATION_CODE.indexOf("idx_data_hub_normalization_findings_logical_identity_unique");
    const region = MIGRATION_CODE.slice(Math.max(0, idx - 100), idx);
    expect(region).toContain("pg_temp.ensure_index(");
  });

  it("the migration's own comment documents WHY a natural uniqueness constraint was added (genuine reasoning, not a bare assertion)", () => {
    const idx = MIGRATION.indexOf("idx_data_hub_normalization_findings_logical_identity_unique");
    expect(idx).toBeGreaterThan(-1);
    const commentRegion = MIGRATION.slice(Math.max(0, idx - 2200), idx);
    expect(commentRegion).toMatch(/REPLAY REVIEW/);
    expect(commentRegion).toMatch(/transformValue/);
    expect(commentRegion).toMatch(/at most one finding/i);
  });
});

describe("6.2D4C-B2B1 REMEDIATION — cross-call row consistency (Blocker 1)", () => {
  function fnBody(): string {
    const start = MIGRATION_CODE.indexOf("CREATE OR REPLACE FUNCTION public.datahub_stage_normalized_batch(");
    expect(start).toBeGreaterThan(-1);
    const end = MIGRATION_CODE.indexOf("\n$fn$;", start);
    return MIGRATION_CODE.slice(start, end);
  }

  it("retains the original same-call overlap check as an earlier, clearer guard", () => {
    const body = fnBody();
    expect(body).toMatch(/appear in both the normalized payload and a BLOCKING_ERROR finding in this same batch/);
  });

  it("Check A: rejects a normalized-payload raw row that already has a persisted BLOCKING_ERROR finding for this run, scoped by (normalization_run_id, organisation_id, raw_row_id)", () => {
    const body = fnBody();
    expect(body).toMatch(/v_cross_call_a_count/);
    expect(body).toMatch(/existing_f\.normalization_run_id = p_normalization_run_id/);
    expect(body).toMatch(/existing_f\.organisation_id = p_organisation_id/);
    expect(body).toMatch(/existing_f\.severity = 'BLOCKING_ERROR'/);
    expect(body).toMatch(/already have a BLOCKING_ERROR finding persisted for this run from an earlier call/);
  });

  it("Check B: rejects a BLOCKING_ERROR finding-payload raw row that already has a persisted normalized row for this run, scoped by (normalization_run_id, organisation_id, raw_row_id)", () => {
    const body = fnBody();
    expect(body).toMatch(/v_cross_call_b_count/);
    expect(body).toMatch(/existing_r\.normalization_run_id = p_normalization_run_id/);
    expect(body).toMatch(/existing_r\.organisation_id = p_organisation_id/);
    expect(body).toMatch(/already have a normalized row persisted for this run from an earlier call/);
  });

  it("both cross-call checks run BEFORE the normalized-row insert AND before the finding insert (structural, same statement/transaction)", () => {
    const body = fnBody();
    const checkAIdx = body.indexOf("v_cross_call_a_count");
    const checkBIdx = body.indexOf("v_cross_call_b_count");
    const normalizedRowInsertIdx = body.indexOf("INSERT INTO public.data_hub_normalized_rows");
    const findingInsertIdx = body.indexOf("INSERT INTO public.data_hub_normalization_findings");
    expect(checkAIdx).toBeGreaterThan(-1);
    expect(checkBIdx).toBeGreaterThan(checkAIdx);
    expect(normalizedRowInsertIdx).toBeGreaterThan(checkBIdx);
    expect(findingInsertIdx).toBeGreaterThan(checkBIdx);
  });

  it("mutation proof: the guard block is delimited by CROSS_CALL_GUARD_BEGIN/END markers in the real source, and stripping that exact block removes both checks (live-proven against real Postgres in scripts/tests/verify-datahub-normalization-findings.sh's MUTATION PROOF section — this assertion pins the markers the bash harness's sed strip depends on)", () => {
    expect(MIGRATION).toContain("CROSS_CALL_GUARD_BEGIN");
    expect(MIGRATION).toContain("CROSS_CALL_GUARD_END");
    const beginIdx = MIGRATION.indexOf("-- CROSS_CALL_GUARD_BEGIN");
    const endIdx = MIGRATION.indexOf("-- CROSS_CALL_GUARD_END");
    expect(endIdx).toBeGreaterThan(beginIdx);
    const strippedRegion = MIGRATION.slice(beginIdx, endIdx);
    expect(strippedRegion).toContain("v_cross_call_a_count");
    expect(strippedRegion).toContain("v_cross_call_b_count");
    // Everything outside the marked block must NOT contain the guard's own
    // exception text — i.e. stripping exactly this block removes BOTH
    // checks in full, with nothing left half-mutated outside the markers.
    const outsideRegion = MIGRATION.slice(0, beginIdx) + MIGRATION.slice(endIdx);
    expect(outsideRegion).not.toContain("already have a BLOCKING_ERROR finding persisted for this run from an earlier call");
    expect(outsideRegion).not.toContain("already have a normalized row persisted for this run from an earlier call");
  });

  it("the migration's own scope-note comment no longer claims cross-call scanning is unimplemented", () => {
    expect(MIGRATION).not.toMatch(/structurally cannot, without an additional\s+cross-call scan/);
  });
});

describe("6.2D4C-B2B1 — exact tenant/lineage FKs are present", () => {
  const REQUIRED_FKS = [
    "data_hub_normalization_findings_organisation_id_fkey",
    "data_hub_normalization_findings_run_org_fkey",
    "data_hub_normalization_findings_run_raw_run_fkey",
    "data_hub_normalization_findings_raw_row_fkey",
    "data_hub_normalization_findings_raw_cell_org_fkey",
    "data_hub_normalization_findings_raw_cell_row_fkey",
    "data_hub_normalization_findings_raw_cell_column_fkey",
    "data_hub_normalization_findings_column_org_fkey",
  ];

  it.each(REQUIRED_FKS)("declares %s", (fk) => {
    expect(MIGRATION_CODE).toContain(fk);
  });

  it("the raw-row FK proves physical source-row identity (raw_row_id, raw_staging_run_id, source_row_number, organisation_id)", () => {
    const idx = MIGRATION_CODE.indexOf("data_hub_normalization_findings_raw_row_fkey");
    const region = MIGRATION_CODE.slice(idx, idx + 700);
    expect(region).toContain("FOREIGN KEY (raw_row_id, raw_staging_run_id, source_row_number, organisation_id)");
    expect(region).toContain("REFERENCES public.data_hub_raw_rows(id, staging_run_id, source_row_number, organisation_id)");
  });

  it("mutation proof: dropping source_row_number from the raw-row FK is caught", () => {
    const idx = MIGRATION_CODE.indexOf("data_hub_normalization_findings_raw_row_fkey");
    const region = MIGRATION_CODE.slice(idx, idx + 700);
    expect(region).toMatch(/FOREIGN KEY \(raw_row_id, raw_staging_run_id, source_row_number, organisation_id\)/);
  });
});

describe("6.2D4C-B2B1 — findings are immutable after INSERT", () => {
  it("attaches its own trigger to the shared D4C-B1 immutability guard function", () => {
    expect(MIGRATION_CODE).toContain("CREATE TRIGGER data_hub_normalization_findings_immutable_guard");
    expect(MIGRATION_CODE).toMatch(/CREATE TRIGGER data_hub_normalization_findings_immutable_guard\s+BEFORE UPDATE OR DELETE ON public\.data_hub_normalization_findings/);
  });
});

describe("6.2D4C-B2B1 — datahub_stage_normalized_batch atomic semantics", () => {
  function fnBody(): string {
    const start = MIGRATION_CODE.indexOf("CREATE OR REPLACE FUNCTION public.datahub_stage_normalized_batch(");
    expect(start).toBeGreaterThan(-1);
    const end = MIGRATION_CODE.indexOf("\n$fn$;", start);
    return MIGRATION_CODE.slice(start, end);
  }

  it("verifies AND renews the lease before any evidence insert, mirroring datahub_stage_raw_batch's own precedent", () => {
    const body = fnBody();
    const leaseIdx = body.indexOf("UPDATE public.data_hub_normalization_runs");
    const firstInsertIdx = body.indexOf("INSERT INTO public.data_hub_normalized_rows");
    expect(leaseIdx).toBeGreaterThan(-1);
    expect(firstInsertIdx).toBeGreaterThan(leaseIdx);
    expect(body.slice(leaseIdx, leaseIdx + 400)).toMatch(/status = 'RUNNING' AND execution_token = p_execution_token/);
    expect(body.slice(leaseIdx, leaseIdx + 400)).toMatch(/lease_expires_at > now\(\)/);
  });

  it("verifies the pinned raw_staging_run is still SUCCEEDED before inserting evidence", () => {
    const body = fnBody();
    expect(body).toMatch(/pinned raw_staging_run is no longer SUCCEEDED/);
  });

  it("refuses a batch where the same raw row appears as both a normalized row and a BLOCKING_ERROR finding (no partial row success)", () => {
    const body = fnBody();
    expect(body).toMatch(/severity'\s*=\s*'BLOCKING_ERROR'/);
    expect(body).toMatch(/appear in both the normalized payload and a BLOCKING_ERROR finding/);
  });

  it("re-verifies the SAME lease while recording progress, AFTER every insert — a mismatch rolls back the whole statement", () => {
    const body = fnBody();
    const lastInsertIdx = body.lastIndexOf("INSERT INTO public.data_hub_normalization_findings");
    const progressIdx = body.indexOf("persisted_row_count = persisted_row_count");
    expect(progressIdx).toBeGreaterThan(lastInsertIdx);
    expect(body.slice(progressIdx - 50, progressIdx + 400)).toMatch(/status = 'RUNNING' AND execution_token = p_execution_token/);
    expect(body.slice(progressIdx - 50, progressIdx + 400)).toMatch(/lease_expires_at > now\(\)/);
    expect(body).toMatch(/lease lost before progress commit/);
  });

  it("cell/row/finding identity is never inferred positionally — every insert selects explicit jsonb fields", () => {
    const body = fnBody();
    expect(body).not.toMatch(/ROW_NUMBER\(\)\s+OVER/);
    expect(body).toMatch(/r ->> 'id'/);
    expect(body).toMatch(/c ->> 'id'/);
    expect(body).toMatch(/f ->> 'id'/);
  });
});

describe("6.2D4C-B2B1 — blocking-findings completion gate (extends datahub_complete_normalization_run)", () => {
  function fnBody(): string {
    const start = MIGRATION_CODE.indexOf("CREATE OR REPLACE FUNCTION public.datahub_complete_normalization_run(");
    expect(start).toBeGreaterThan(-1);
    const end = MIGRATION_CODE.indexOf("\n$fn$;", start);
    return MIGRATION_CODE.slice(start, end);
  }

  it("counts BLOCKING_ERROR findings for the run and raises before any state change if any exist", () => {
    const body = fnBody();
    const countIdx = body.indexOf("v_blocking_finding_count");
    const firstUpdateIdx = body.indexOf("UPDATE public.data_hub_normalization_runs\n  SET status = 'SUCCEEDED'");
    expect(countIdx).toBeGreaterThan(-1);
    expect(firstUpdateIdx).toBeGreaterThan(countIdx);
    expect(body).toMatch(/WHERE normalization_run_id = p_normalization_run_id AND severity = 'BLOCKING_ERROR'/);
    expect(body).toMatch(/blocking finding\(s\) exist for this run; completion is not possible/);
  });

  it("every other D4C-B1 invariant (lease/token/expiry, actor tenant check, raw-run-still-SUCCEEDED, row/cell count reconciliation) is preserved verbatim", () => {
    const body = fnBody();
    expect(body).toMatch(/caller does not hold the current lease token/);
    expect(body).toMatch(/lease has expired/);
    expect(body).toMatch(/completing actor does not belong to this organisation/);
    expect(body).toMatch(/pinned raw_staging_run is no longer SUCCEEDED/);
    expect(body).toMatch(/row count mismatch/);
    expect(body).toMatch(/cell count mismatch/);
  });

  it("mutation proof: removing the blocking-findings gate is caught", () => {
    const body = fnBody();
    expect(body).toContain("v_blocking_finding_count > 0");
  });
});

describe("6.2D4C-B2B1 — no active/current profile pointer anywhere", () => {
  it("never reads active_profile_version_id", () => {
    expect(MIGRATION_CODE).not.toMatch(/active_profile_version_id/);
  });
});

describe("6.2D4C-B2B1 — every index is drift-checked (established convention, extended to this migration)", () => {
  it("contains ZERO active CREATE INDEX IF NOT EXISTS statements", () => {
    const activeStatements = MIGRATION_CODE.split("\n").filter((line) => /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i.test(line));
    expect(activeStatements).toEqual([]);
  });

  it("every plain index is created via pg_temp.ensure_index", () => {
    const REQUIRED_INDEXES = [
      "idx_data_hub_normalization_findings_run_severity",
      "idx_data_hub_normalization_findings_org_run",
      "idx_data_hub_normalization_findings_raw_row",
      "idx_data_hub_normalization_findings_logical_identity_unique",
    ];
    for (const name of REQUIRED_INDEXES) {
      const idx = MIGRATION_CODE.indexOf(name);
      expect(idx, name).toBeGreaterThan(-1);
      const region = MIGRATION_CODE.slice(Math.max(0, idx - 100), idx + 50);
      expect(region, name).toContain("pg_temp.ensure_index(");
    }
  });
});

describe("6.2D4C-B2B1 — Prisma schema shape", () => {
  function modelBody(name: string): string {
    const start = PRISMA.indexOf(`model ${name} {`);
    expect(start, `model ${name} not found`).toBeGreaterThan(-1);
    const end = PRISMA.indexOf("\n}", start);
    return PRISMA.slice(start, end);
  }

  it("DataHubNormalizationFinding declares every required field", () => {
    const body = modelBody("DataHubNormalizationFinding");
    for (const f of [
      "id", "organisation_id", "normalization_run_id", "raw_staging_run_id", "raw_row_id",
      "source_row_number", "raw_cell_id", "source_schema_column_id", "severity", "finding_code", "value_kind", "created_at",
    ]) {
      expect(body, f).toMatch(new RegExp(`\\n\\s*${f}\\s+`));
    }
  });

  it("raw_cell_id/source_schema_column_id/value_kind are optional (nullable) in the Prisma model", () => {
    const body = modelBody("DataHubNormalizationFinding");
    expect(body).toMatch(/raw_cell_id\s+String\?/);
    expect(body).toMatch(/source_schema_column_id\s+String\?/);
    expect(body).toMatch(/value_kind\s+String\?/);
  });

  it("maps to the exact snake_case table name", () => {
    expect(modelBody("DataHubNormalizationFinding")).toContain('@@map("data_hub_normalization_findings")');
  });
});

describe("6.2D4C-B2B1 — rollback is guarded and restores the exact prior function", () => {
  it("refuses if any finding evidence exists", () => {
    expect(ROLLBACK_CODE).toMatch(/data_hub_normalization_findings/);
    expect(ROLLBACK_CODE).toMatch(/RAISE EXCEPTION[\s\S]*Refusing rollback/);
  });

  it("restores datahub_complete_normalization_run() WITHOUT the blocking-findings gate — identical to D4C-B1's own body modulo whitespace", () => {
    const d4cB1Start = D4C_B1_SQL.indexOf("CREATE OR REPLACE FUNCTION public.datahub_complete_normalization_run(");
    const d4cB1End = D4C_B1_SQL.indexOf("\n$fn$;", d4cB1Start);
    // Collapses all whitespace runs to a single space before comparing —
    // deliberately more forgiving than a byte-identical diff (this repo's
    // own CRLF/LF checkout behavior can otherwise vary invisible
    // whitespace between two reads of the "same" file), while still
    // proving every token/line of actual SQL logic is unchanged.
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    const d4cB1Body = normalize(D4C_B1_SQL.slice(d4cB1Start, d4cB1End));

    const rollbackStart = ROLLBACK.indexOf("CREATE OR REPLACE FUNCTION public.datahub_complete_normalization_run(");
    const rollbackEnd = ROLLBACK.indexOf("\n$fn$;", rollbackStart);
    const rollbackBody = normalize(ROLLBACK.slice(rollbackStart, rollbackEnd));

    expect(rollbackBody).toBe(d4cB1Body);
    expect(rollbackBody).not.toMatch(/blocking finding/);
  });

  it("never touches any D4A/D4B/D4C-B1 object", () => {
    expect(ROLLBACK_CODE).not.toMatch(/DROP TABLE[^;]*data_hub_(raw_rows|raw_cells|raw_staging_runs|normalization_runs|normalized_rows|normalized_cells)\b/i);
    expect(ROLLBACK_CODE).not.toMatch(/datahub_guard_raw_staging_run_lifecycle|datahub_guard_normalization_run_lifecycle/);
  });

  it("6.2D4C-B2B1 REMEDIATION — needs no separate DROP for the new CHECK/UNIQUE INDEX: dropping the whole findings table removes both, and the migration's own comment documents this reasoning", () => {
    expect(ROLLBACK_CODE).toMatch(/DROP TABLE IF EXISTS public\.data_hub_normalization_findings/);
    expect(ROLLBACK).toMatch(/needs? no separate DROP/i);
  });
});
