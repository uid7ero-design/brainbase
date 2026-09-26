// Data Hub 6.2D3E — static containment for the governed schema
// activation/immutability migration and the Onkaparinga v1 activation
// script. Behavioral proof (triggers actually rejecting/allowing writes,
// the activation script's own transactional behavior) lives in the
// real-Postgres proofs (tests/postgres-proof/datahubGovernedSchema
// Immutability.postgres-proof.test.ts,
// datahubOnkaparingaSchemaV1Activation.postgres-proof.test.ts,
// datahubOnkaparingaSchemaV1RealShapeD3CD3D.postgres-proof.test.ts) —
// this file proves static, source-text-level facts that don't require a
// database: file shape, manifest byte-identity across all three copies,
// and that this phase touches nothing outside its own scope.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])--.*$/gm, "$1");

const IMMUTABILITY_SQL = "scripts/create-datahub-governed-schema-immutability.sql";
const ACTIVATE_SQL = "scripts/activate-datahub-onkaparinga-schema-v1.sql";
const SEED_SQL = "scripts/seed-datahub-onkaparinga-schema-v1.sql";
const CONFIG_JSON = "config/data-hub/onkaparinga-monthly-operations-v1.json";

function extractManifest(sqlSource: string): string {
  const start = sqlSource.indexOf("$manifest$");
  const end = sqlSource.indexOf("$manifest$", start + 1);
  if (start === -1 || end === -1) throw new Error("manifest markers not found");
  // Line endings are a checkout/tooling artifact (git autocrlf vs. a
  // freshly-written file), never a content difference Postgres cares
  // about — normalize before comparing.
  return sqlSource.slice(start + "$manifest$".length, end).replace(/\r\n/g, "\n");
}

describe("6.2D3E — governed schema immutability migration (static)", () => {
  const src = read(IMMUTABILITY_SQL);

  it("creates exactly the five expected trigger functions and triggers, one per governed table, with the R1/R2-correct event set", () => {
    for (const [table, fn, events] of [
      // source_schema_versions has no INSERT concern (a new version is
      // always created DRAFT — see the D3B seed — so R1/R2's "block
      // structural INSERT into ACTIVE/RETIRED" gap never applied here).
      ["source_schema_versions", "datahub_guard_source_schema_version_write", "BEFORE UPDATE OR DELETE"],
      // R1: worksheets/columns now also guard INSERT.
      ["source_schema_worksheets", "datahub_guard_source_schema_worksheet_write", "BEFORE INSERT OR UPDATE OR DELETE"],
      ["source_schema_columns", "datahub_guard_source_schema_column_write", "BEFORE INSERT OR UPDATE OR DELETE"],
      // Untouched by R1/R2 — already unconditionally immutable post-INSERT.
      ["worksheet_mapping_profile_versions", "datahub_guard_worksheet_mapping_profile_version_write", "BEFORE UPDATE OR DELETE"],
      // R2: profiles now also guard INSERT.
      ["worksheet_mapping_profiles", "datahub_guard_worksheet_mapping_profile_write", "BEFORE INSERT OR UPDATE OR DELETE"],
    ] as const) {
      expect(src, `${table} function`).toContain(`CREATE OR REPLACE FUNCTION public.${fn}()`);
      expect(src, `${table} trigger`).toMatch(new RegExp(`CREATE TRIGGER ${fn}\\s+${events} ON public\\.${table}`));
    }
  });

  it("R1/R2 — the worksheet/column/profile trigger functions each branch on TG_OP = 'INSERT' and resolve lifecycle from NEW, never OLD, for that branch", () => {
    for (const fn of ["datahub_guard_source_schema_worksheet_write", "datahub_guard_source_schema_column_write", "datahub_guard_worksheet_mapping_profile_write"]) {
      const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}()`);
      const end = src.indexOf("$fn$;", src.indexOf("$fn$", start) + 4);
      const body = src.slice(start, end).replace(/\r\n/g, "\n");
      expect(body, fn).toMatch(/IF TG_OP = 'INSERT' THEN/);
      const insertStart = body.indexOf("IF TG_OP = 'INSERT' THEN");
      const insertBranch = body.slice(insertStart, body.indexOf("RETURN NEW;\n  END IF;", insertStart) + "RETURN NEW;\n  END IF;".length);
      expect(insertBranch, fn).not.toMatch(/\bOLD\./);
    }
  });

  it("worksheet_mapping_profile_versions' own INSERT-allowed / UPDATE-DELETE-forbidden policy is untouched by R1/R2 (no TG_OP = 'INSERT' branch exists there — INSERT is simply never gated)", () => {
    const start = src.indexOf("CREATE OR REPLACE FUNCTION public.datahub_guard_worksheet_mapping_profile_version_write()");
    const end = src.indexOf("$fn$;", src.indexOf("$fn$", start) + 4);
    const body = src.slice(start, end);
    expect(body).not.toMatch(/TG_OP = 'INSERT'/);
    expect(body).toMatch(/RAISE EXCEPTION 'worksheet_mapping_profile_versions:.*DELETE is never permitted/);
    expect(body).toMatch(/RAISE EXCEPTION 'worksheet_mapping_profile_versions:.*UPDATE is never permitted/);
  });

  it("is wrapped in exactly one BEGIN/COMMIT (transaction-safe apply)", () => {
    expect((src.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((src.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
  });

  it("never performs a data UPDATE/DELETE/INSERT itself — additive governance only, non-destructive to existing DRAFT rows", () => {
    const withoutFunctionBodies = src.replace(/\$fn\$[\s\S]*?\$fn\$/g, "");
    expect(withoutFunctionBodies).not.toMatch(/^\s*(INSERT INTO|UPDATE public\.(?!source_schema|worksheet_mapping)|DELETE FROM)/im);
  });

  it("the lifecycle transition matrix matches the spec exactly: DRAFT->ACTIVE, DRAFT->RETIRED, ACTIVE->RETIRED allowed; ACTIVE->DRAFT, RETIRED->* rejected", () => {
    expect(src).toMatch(/OLD\.status = 'DRAFT' AND NEW\.status = 'ACTIVE'/);
    expect(src).toMatch(/OLD\.status = 'DRAFT' AND NEW\.status = 'RETIRED'/);
    expect(src).toMatch(/OLD\.status = 'ACTIVE' AND NEW\.status = 'RETIRED'/);
    expect(src).toMatch(/OLD\.status = 'ACTIVE' AND NEW\.status = 'DRAFT'[\s\S]{0,80}RAISE EXCEPTION/);
    expect(src).toMatch(/OLD\.status = 'RETIRED'[\s\S]{0,120}RAISE EXCEPTION/);
  });

  it("never modifies confirmWorksheet.ts / reconciliation.ts / illegalDumpingMapper.ts / CSV / Upload.canonical_status semantics (this is a pure schema-governance script)", () => {
    // Documentation prose may explain what this migration does NOT
    // affect (and does, in its own header) — what matters is that no
    // actual SQL statement references these tables/columns.
    const withoutComments = stripComments(src);
    expect(withoutComments).not.toMatch(/canonical_status|import_batches|uploads\b/i);
  });
});

describe("6.2D3E — Onkaparinga v1 activation script (static)", () => {
  const src = read(ACTIVATE_SQL);

  it("requires an actor_user_id psql variable and fails before any read of governed state if absent", () => {
    expect(src).toMatch(/\\if :\{\?actor_user_id\}/);
    expect(src).toMatch(/\\quit/);
  });

  it("validates the actor exists AND belongs to the target organisation before any mutation", () => {
    const beforeFirstUpdate = src.slice(0, src.indexOf("UPDATE public.source_schema_versions"));
    expect(beforeFirstUpdate).toMatch(/FROM public\.users WHERE id = v_actor_user_id AND organisation_id = v_org_id/);
    expect(beforeFirstUpdate).toMatch(/RAISE EXCEPTION 'D3E activation: actor_user_id/);
  });

  it("never invents a fake/system user — the actor id comes only from the psql variable, never a hard-coded literal", () => {
    expect(src).not.toMatch(/v_actor_user_id\s*:?=\s*'[^:]/); // no literal string assignment other than via current_setting(...)
    expect(src).toContain("current_setting('datahub.d3e_actor_user_id', true)");
  });

  it("is a single transaction (exactly one BEGIN/COMMIT) and never auto-executes (no reference to CI/Vercel/migration-runner invocation)", () => {
    expect((src.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((src.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(src).not.toMatch(/require\(|import |package\.json|postinstall/);
  });

  it("writes exactly one audit_logs row with the required columns and the specified action/resource identity", () => {
    expect(src).toMatch(/INSERT INTO public\.audit_logs \(id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state, created_at\)/);
    expect(src).toContain("'DATA_HUB_SOURCE_SCHEMA_ACTIVATED'");
    expect(src).toContain("'source_schema_version'");
    expect(src).toContain("c_sv_id");
  });

  it("never records raw workbook data, PII, credentials or secrets in the audit before/after state — only a compact lifecycle document", () => {
    const beforeAfterBlock = src.slice(src.indexOf("v_before := jsonb_build_object"), src.indexOf("v_audit_id :="));
    // Only the three fixed, compact lifecycle keys are ever built — never
    // workbook/PII/schema-content fields.
    const quotedTokens = [...beforeAfterBlock.matchAll(/'(\w+)',/g)].map((m) => m[1]);
    expect(new Set(quotedTokens)).toEqual(new Set(["status", "activatedAt", "activeProfileCount", "ACTIVE"]));
    expect(beforeAfterBlock).not.toMatch(/source_header|logical_field_key|sensitivity_class|profile_document|PERSONALLY_IDENTIFIABLE/);
  });

  it("idempotency: an already-ACTIVE version with the exact expected state is a zero-mutation no-op with zero new audit event", () => {
    expect(src).toMatch(/no-op, zero mutation, zero new audit event/);
    expect(src).toMatch(/RETURN;/);
  });

  it("RETIRED is refused outright — activation never reactivates a RETIRED version", () => {
    expect(src).toMatch(/RETIRED[\s\S]{0,80}RAISE EXCEPTION 'D3E activation:.*terminal/);
  });

  it("never touches ImportBatch/Upload/SourceSystem(beyond the read-only lookup)/SourceMapping/MappingVersion/reporting-period fields/canonical domain tables", () => {
    const withoutComments = stripComments(src);
    expect(withoutComments).not.toMatch(/\bimport_batches\b|\buploads\b|\bsource_mappings\b|\bmapping_versions\b|\breporting_period_required\b|\billegal_dumping\b/i);
    // source_systems appears ONLY in the read-only natural-key lookup (SELECT), never in an UPDATE/INSERT/DELETE against it.
    expect(withoutComments).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM)\s+public\.source_systems\b/i);
    expect(withoutComments).toMatch(/FROM public\.source_systems WHERE name = v_ss_name AND active/);
  });

  it("only writes to source_schema_versions, worksheet_mapping_profiles, and audit_logs — never source_schema_worksheets/columns/worksheet_mapping_profile_versions/dataset_types (immutable/pre-existing, never touched by activation)", () => {
    const withoutComments = stripComments(src);
    const writes = [...withoutComments.matchAll(/\b(UPDATE|INSERT INTO)\s+public\.(\w+)/g)].map((m) => m[2]);
    expect(new Set(writes)).toEqual(new Set(["source_schema_versions", "worksheet_mapping_profiles", "audit_logs"]));
  });
});

describe("6.2D3E — manifest stays byte-identical across all three copies (config JSON, D3B seed, D3E activation script)", () => {
  it("the activation script's embedded manifest is byte-identical to the D3B seed's own and to the config JSON", () => {
    const configText = read(CONFIG_JSON).trim();
    const seedManifest = extractManifest(read(SEED_SQL)).trim();
    const activateManifest = extractManifest(read(ACTIVATE_SQL)).trim();
    expect(activateManifest).toBe(seedManifest);
    expect(JSON.parse(activateManifest)).toEqual(JSON.parse(configText));
  });
});

describe("6.2D3E — D3C/D3D/CSV/6.1B remain untouched by this phase (Section 25)", () => {
  it("governedSchema.ts, matchImportBatchSchema.ts, and schemaMatcher.ts contain zero code-level coupling to the new triggers/scripts (D3C stays untouched)", () => {
    for (const rel of [
      "lib/data-hub/schemaMatch/governedSchema.ts",
      "lib/data-hub/schemaMatch/matchImportBatchSchema.ts",
      "lib/data-hub/schemaMatch/schemaMatcher.ts",
      "lib/data-hub/schemaMatch/establishImportBatchSchemaLineage.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/datahub_guard_|create-datahub-governed-schema-immutability|activate-datahub-onkaparinga-schema-v1/);
    }
  });

  it("confirmWorksheet.ts / reconciliation.ts / illegalDumpingMapper.ts keep their existing CSV-only gate and know nothing of 6.2D3E", () => {
    const src = read("lib/data-hub/importBatch/confirmWorksheet.ts").replace(/\r\n/g, "\n");
    expect(src).toMatch(/if \(batch\.content_type !== "csv"\) \{\s*\n\s*return fail\("UNSUPPORTED_FORMAT"\);/);
    for (const rel of [
      "lib/data-hub/importBatch/confirmWorksheet.ts",
      "lib/data-hub/importBatch/reconciliation.ts",
      "lib/data-hub/importBatch/illegalDumpingMapper.ts",
    ]) {
      expect(read(rel), rel).not.toMatch(/datahub_guard_|activate-datahub-onkaparinga|create-datahub-governed-schema-immutability|DATA_HUB_SOURCE_SCHEMA_ACTIVATED/);
    }
  });

  it("Upload.canonical_status semantics are untouched — no D3E script's actual SQL references it", () => {
    for (const rel of [IMMUTABILITY_SQL, ACTIVATE_SQL]) {
      expect(stripComments(read(rel)), rel).not.toMatch(/canonical_status/);
    }
  });
});
