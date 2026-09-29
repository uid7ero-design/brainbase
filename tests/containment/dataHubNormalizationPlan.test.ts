import { describe, expect, it } from "vitest";
import { buildNormalizationPlan } from "@/lib/data-hub/normalization/plan";
import type { ColumnRuleV2 } from "@/lib/data-hub/schemaProfiles/profileDocument";

const COL = (n: string) => `synthetic-col-${n}`;

function rule(id: string, overrides: Partial<ColumnRuleV2> = {}): ColumnRuleV2 {
  return { sourceSchemaColumnId: id, valueKind: "STRING", ...overrides } as ColumnRuleV2;
}

function v2Doc(columnRules: ColumnRuleV2[], overrides: Record<string, unknown> = {}) {
  return { documentVersion: 2, schemaStatus: "ACTIVE", headerRowOneBased: 3, columnRules, ...overrides };
}

describe("6.2D4C-B2A normalization plan contract", () => {
  it("rejects a v1 document as NORMALIZATION_INELIGIBLE_V1", () => {
    const doc = { documentVersion: 1, schemaStatus: "ACTIVE", headerRowOneBased: 3 };
    const result = buildNormalizationPlan(doc, [COL("a")]);
    expect(result).toEqual({ ok: false, findings: [{ severity: "BLOCKING_ERROR", code: "NORMALIZATION_INELIGIBLE_V1" }] });
  });

  it("rejects a structurally invalid profile document as PROFILE_DOCUMENT_INVALID", () => {
    const result = buildNormalizationPlan({ documentVersion: 3 }, [COL("a")]);
    expect(result).toEqual({ ok: false, findings: [{ severity: "BLOCKING_ERROR", code: "PROFILE_DOCUMENT_INVALID" }] });
  });

  it("rejects a non-object input as PROFILE_DOCUMENT_INVALID", () => {
    const result = buildNormalizationPlan("not an object", [COL("a")]);
    expect(result).toEqual({ ok: false, findings: [{ severity: "BLOCKING_ERROR", code: "PROFILE_DOCUMENT_INVALID" }] });
  });

  it("succeeds when v2 columnRules exactly cover every governed column, no more no less", () => {
    const doc = v2Doc([rule(COL("a")), rule(COL("b"), { valueKind: "INTEGER" })]);
    const result = buildNormalizationPlan(doc, [COL("a"), COL("b")]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.rulesByColumnId.size).toBe(2);
      expect(result.plan.rulesByColumnId.get(COL("a"))?.valueKind).toBe("STRING");
      expect(result.plan.rulesByColumnId.get(COL("b"))?.valueKind).toBe("INTEGER");
    }
  });

  it("succeeds regardless of governed column ordering (order-independent)", () => {
    const doc = v2Doc([rule(COL("b")), rule(COL("a"))]);
    const result = buildNormalizationPlan(doc, [COL("a"), COL("b")]);
    expect(result.ok).toBe(true);
  });

  it("blocks with MISSING_GOVERNED_RULE when a governed column has no rule", () => {
    const doc = v2Doc([rule(COL("a"))]);
    const result = buildNormalizationPlan(doc, [COL("a"), COL("b")]);
    expect(result).toEqual({ ok: false, findings: [{ severity: "BLOCKING_ERROR", code: "MISSING_GOVERNED_RULE", sourceSchemaColumnId: COL("b") }] });
  });

  it("blocks with UNKNOWN_RULE_COLUMN when a rule targets a column outside the governed set", () => {
    const doc = v2Doc([rule(COL("a")), rule(COL("foreign"))]);
    const result = buildNormalizationPlan(doc, [COL("a")]);
    expect(result).toEqual({ ok: false, findings: [{ severity: "BLOCKING_ERROR", code: "UNKNOWN_RULE_COLUMN", sourceSchemaColumnId: COL("foreign"), valueKind: "STRING" }] });
  });

  it("reports both MISSING_GOVERNED_RULE and UNKNOWN_RULE_COLUMN together when both defects exist", () => {
    const doc = v2Doc([rule(COL("foreign"))]);
    const result = buildNormalizationPlan(doc, [COL("a")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.findings.map((f) => f.code).sort();
      expect(codes).toEqual(["MISSING_GOVERNED_RULE", "UNKNOWN_RULE_COLUMN"]);
    }
  });

  it("never inspects a source_header-shaped field — passing one through has zero effect on the plan", () => {
    // buildNormalizationPlan's signature takes only a profile document and an
    // array of bare column-id strings; there is no parameter through which a
    // heading could even be supplied, so this is a structural (type-level)
    // guarantee, re-asserted here as a behavioral smoke test: an id that
    // happens to look like a heading is still just an opaque id.
    const doc = v2Doc([rule("Total Weight (kg)")]);
    const result = buildNormalizationPlan(doc, ["Total Weight (kg)"]);
    expect(result.ok).toBe(true);
  });

  it("rejects a document containing a raw active_profile_version_id-shaped key as an unknown top-level key (no such concept exists in this contract)", () => {
    const doc = v2Doc([rule(COL("a"))], { active_profile_version_id: "should-never-exist-here" });
    const result = buildNormalizationPlan(doc, [COL("a")]);
    expect(result).toEqual({ ok: false, findings: [{ severity: "BLOCKING_ERROR", code: "PROFILE_DOCUMENT_INVALID" }] });
  });
});
