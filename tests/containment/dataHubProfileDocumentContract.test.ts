import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseProfileDocument,
  headerRowOneBasedFromDocument,
  VALUE_KINDS,
  UNITS,
  DATE_POLICIES,
  type ColumnRuleV2,
} from "@/lib/data-hub/schemaProfiles/profileDocument";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const MODULE_SOURCE = read("lib/data-hub/schemaProfiles/profileDocument.ts");
const ELIGIBILITY_SOURCE = read("lib/data-hub/staging/eligibility.ts");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const MODULE_CODE = stripComments(MODULE_SOURCE);
const ELIGIBILITY_CODE = stripComments(ELIGIBILITY_SOURCE);

// A synthetic (NOT a real Onkaparinga assertion) column identity used purely
// as a fixture id. Real governed column ids are cuids; any non-empty string
// exercises the same validation path.
const COL = (n: string) => `synthetic-test-col-${n}`;

function validRule(overrides: Partial<ColumnRuleV2> = {}): ColumnRuleV2 {
  return { sourceSchemaColumnId: COL("a"), valueKind: "STRING", ...overrides } as ColumnRuleV2;
}

describe("6.2D4C-A profile document contract — v1 backward compatibility", () => {
  it("1. accepts the exact historical v1 document shape", () => {
    const doc = { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 3 };
    const r = parseProfileDocument(doc);
    expect(r).toEqual({ ok: true, document: { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 3 } });
  });

  it("1b. accepts the historical v1 'no tabular header' governed null", () => {
    const doc = { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: null };
    const r = parseProfileDocument(doc);
    expect(r).toEqual({ ok: true, document: { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: null } });
  });

  it("2. rejects malformed historical v1 documents", () => {
    const cases: unknown[] = [
      { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 3, extra: true },
      { documentVersion: 1, schemaStatus: "DRAFT" },
      { documentVersion: "1", schemaStatus: "DRAFT", headerRowOneBased: 3 },
      { documentVersion: 1, schemaStatus: 42, headerRowOneBased: 3 },
      { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 0 },
      { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 1.5 },
      { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: "3" },
      null,
      [1, 2, 3],
      "not an object",
    ];
    for (const doc of cases) {
      expect(parseProfileDocument(doc).ok, JSON.stringify(doc)).toBe(false);
    }
  });

  it("mutation proof: v1's exact-3-key requirement is load-bearing (temporarily relaxing it would flip this case)", () => {
    // This asserts the CURRENT (correct) behavior. Manually broadening the
    // v1 key check in profileDocument.ts to accept extra keys makes this
    // fail — confirmed by hand during development per the repo's
    // "temporarily mutate the real source" containment-test idiom.
    const doc = { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 3, columnRules: [] };
    expect(parseProfileDocument(doc).ok).toBe(false);
  });
});

describe("6.2D4C-A profile document contract — v2 acceptance and structural invariants", () => {
  it("3. accepts a representative valid v2 document", () => {
    const doc = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [
        validRule({ sourceSchemaColumnId: COL("id"), valueKind: "IDENTIFIER", preserveLeadingZeros: true }),
        validRule({ sourceSchemaColumnId: COL("date"), valueKind: "DATE", datePolicy: "AU_DD_MM_YYYY" }),
        // Synthetic test fixture only — NOT an asserted real Onkaparinga unit.
        validRule({ sourceSchemaColumnId: COL("weight"), valueKind: "DECIMAL", sourceUnit: "kg", normalizedUnit: "kg" }),
        validRule({ sourceSchemaColumnId: COL("lat"), valueKind: "LATITUDE" }),
        validRule({ sourceSchemaColumnId: COL("lng"), valueKind: "LONGITUDE" }),
      ],
    };
    const r = parseProfileDocument(doc);
    expect(r.ok).toBe(true);
    if (r.ok && r.document.documentVersion === 2) {
      expect(r.document.columnRules).toHaveLength(5);
    }
  });

  it("4. rejects duplicate sourceSchemaColumnId within one document", () => {
    const doc = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [validRule({ sourceSchemaColumnId: COL("dup") }), validRule({ sourceSchemaColumnId: COL("dup"), valueKind: "BOOLEAN" })],
    };
    const r = parseProfileDocument(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/duplicate sourceSchemaColumnId/);
  });

  it("mutation proof: duplicate-id rejection is load-bearing (two distinct ids pass)", () => {
    const doc = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [validRule({ sourceSchemaColumnId: COL("x") }), validRule({ sourceSchemaColumnId: COL("y") })],
    };
    expect(parseProfileDocument(doc).ok).toBe(true);
  });

  it("5. rejects an unknown valueKind", () => {
    const doc = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [validRule({ valueKind: "MONEY_BAGS" as never })],
    };
    const r = parseProfileDocument(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/valueKind/);
  });

  it("6. rejects invalid DD/MM/YYYY-vs-ISO policy combinations", () => {
    const badPolicy = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [validRule({ valueKind: "DATE", datePolicy: "US_MM_DD_YYYY" as never })],
    };
    expect(parseProfileDocument(badPolicy).ok).toBe(false);

    const missingPolicy = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [validRule({ valueKind: "DATETIME" })],
    };
    expect(parseProfileDocument(missingPolicy).ok).toBe(false);

    const policyOnWrongKind = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [validRule({ valueKind: "STRING", datePolicy: "ISO_8601" as never })],
    };
    expect(parseProfileDocument(policyOnWrongKind).ok).toBe(false);

    for (const policy of DATE_POLICIES) {
      const ok = {
        documentVersion: 2,
        schemaStatus: "DRAFT",
        headerRowOneBased: 3,
        columnRules: [validRule({ valueKind: "DATE", datePolicy: policy })],
      };
      expect(parseProfileDocument(ok).ok, policy).toBe(true);
    }
  });

  it("7. rejects an invalid/unallowlisted unit and incompatible unit families", () => {
    const unknownUnit = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [validRule({ valueKind: "DECIMAL", sourceUnit: "furlongs" as never })],
    };
    expect(parseProfileDocument(unknownUnit).ok).toBe(false);

    const crossFamily = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      // kg (MASS) -> km (LENGTH) is not a semantically compatible conversion.
      columnRules: [validRule({ valueKind: "DECIMAL", sourceUnit: "kg", normalizedUnit: "km" })],
    };
    expect(parseProfileDocument(crossFamily).ok).toBe(false);

    const wrongKindForUnit = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      // PERCENTAGE valueKind may only declare the '%' family, not MASS.
      columnRules: [validRule({ valueKind: "PERCENTAGE", sourceUnit: "kg" as never })],
    };
    expect(parseProfileDocument(wrongKindForUnit).ok).toBe(false);

    const kindForUnit: Record<(typeof UNITS)[number], "DECIMAL" | "DURATION" | "PERCENTAGE" | "CURRENCY"> = {
      kg: "DECIMAL",
      t: "DECIMAL",
      m: "DECIMAL",
      km: "DECIMAL",
      s: "DURATION",
      min: "DURATION",
      h: "DURATION",
      "%": "PERCENTAGE",
      AUD: "CURRENCY",
    };
    for (const unit of UNITS) {
      const doc = {
        documentVersion: 2,
        schemaStatus: "DRAFT",
        headerRowOneBased: 3,
        columnRules: [validRule({ valueKind: kindForUnit[unit], sourceUnit: unit, normalizedUnit: unit })],
      };
      expect(parseProfileDocument(doc).ok, unit).toBe(true);
    }
  });

  it("8. IDENTIFIER leading-zero policy is represented without any numeric coercion", () => {
    const good = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [validRule({ valueKind: "IDENTIFIER", preserveLeadingZeros: true, sourceSchemaColumnId: COL("acct") })],
    };
    const r = parseProfileDocument(good);
    expect(r.ok).toBe(true);
    if (r.ok && r.document.documentVersion === 2) {
      expect(r.document.columnRules[0]).toEqual({
        sourceSchemaColumnId: COL("acct"),
        valueKind: "IDENTIFIER",
        preserveLeadingZeros: true,
      });
    }

    // preserveLeadingZeros must be the literal `true` — never `false`, and
    // IDENTIFIER can never additionally declare a unit (which would imply
    // numeric semantics).
    expect(parseProfileDocument({ documentVersion: 2, schemaStatus: "DRAFT", headerRowOneBased: 3, columnRules: [validRule({ valueKind: "IDENTIFIER", preserveLeadingZeros: false as never })] }).ok).toBe(false);
    expect(parseProfileDocument({ documentVersion: 2, schemaStatus: "DRAFT", headerRowOneBased: 3, columnRules: [validRule({ valueKind: "IDENTIFIER" })] }).ok).toBe(false);
    expect(
      parseProfileDocument({
        documentVersion: 2,
        schemaStatus: "DRAFT",
        headerRowOneBased: 3,
        columnRules: [validRule({ valueKind: "IDENTIFIER", preserveLeadingZeros: true, sourceUnit: "kg" as never })],
      }).ok,
    ).toBe(false);

    // Non-IDENTIFIER kinds must not declare preserveLeadingZeros at all.
    expect(
      parseProfileDocument({
        documentVersion: 2,
        schemaStatus: "DRAFT",
        headerRowOneBased: 3,
        columnRules: [validRule({ valueKind: "STRING", preserveLeadingZeros: true as never })],
      }).ok,
    ).toBe(false);
  });

  it("9. a unit is never inferred from a header — the module never receives header text as input", () => {
    // Structural proof: the parser's public signature and internal logic
    // take no header/heading argument anywhere, and the module never
    // references source_header/sourceHeader.
    expect(MODULE_CODE).not.toMatch(/source_header|sourceHeader/);
    // Behavioral proof: two rules with identical, header-free identities
    // and no explicit unit produce no unit at all (never guessed).
    const doc = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [validRule({ valueKind: "DECIMAL", sourceSchemaColumnId: COL("no-unit") })],
    };
    const r = parseProfileDocument(doc);
    expect(r.ok).toBe(true);
    if (r.ok && r.document.documentVersion === 2) {
      expect(r.document.columnRules[0].sourceUnit).toBeUndefined();
      expect(r.document.columnRules[0].normalizedUnit).toBeUndefined();
    }
  });

  it("10. LATITUDE/LONGITUDE validation rules — accepted bare, unit declarations rejected", () => {
    for (const kind of ["LATITUDE", "LONGITUDE"] as const) {
      const bare = {
        documentVersion: 2,
        schemaStatus: "DRAFT",
        headerRowOneBased: 3,
        columnRules: [validRule({ valueKind: kind, sourceSchemaColumnId: COL(kind) })],
      };
      expect(parseProfileDocument(bare).ok, kind).toBe(true);

      const withUnit = {
        documentVersion: 2,
        schemaStatus: "DRAFT",
        headerRowOneBased: 3,
        columnRules: [validRule({ valueKind: kind, sourceUnit: "km" as never })],
      };
      expect(parseProfileDocument(withUnit).ok, kind).toBe(false);

      const withDatePolicy = {
        documentVersion: 2,
        schemaStatus: "DRAFT",
        headerRowOneBased: 3,
        columnRules: [validRule({ valueKind: kind, datePolicy: "ISO_8601" as never })],
      };
      expect(parseProfileDocument(withDatePolicy).ok, kind).toBe(false);
    }
  });

  it("11. unknown/executable/transformation-expression fields are rejected at every level", () => {
    const topLevel = {
      documentVersion: 2,
      schemaStatus: "DRAFT",
      headerRowOneBased: 3,
      columnRules: [],
      expression: "1+1",
    };
    expect(parseProfileDocument(topLevel).ok).toBe(false);

    for (const key of ["expression", "formula", "code", "sql", "js", "transform", "fn"]) {
      const doc = {
        documentVersion: 2,
        schemaStatus: "DRAFT",
        headerRowOneBased: 3,
        columnRules: [{ ...validRule(), [key]: "SELECT * FROM users" }],
      };
      expect(parseProfileDocument(doc).ok, key).toBe(false);
    }

    // No field in the schema is ever expected to hold executable content —
    // the module contains no eval/Function/require/child_process surface.
    expect(MODULE_CODE).not.toMatch(/\beval\s*\(|\bnew Function\s*\(|require\s*\(|child_process/);
  });

  it("structural invariant: profile document must be a plain JSON object, and documentVersion outside {1,2} is rejected", () => {
    expect(parseProfileDocument(undefined).ok).toBe(false);
    expect(parseProfileDocument({ documentVersion: 3, schemaStatus: "DRAFT", headerRowOneBased: null, columnRules: [] }).ok).toBe(false);
  });

  it("structural invariant: columnRules must be an array", () => {
    const doc = { documentVersion: 2, schemaStatus: "DRAFT", headerRowOneBased: 3, columnRules: {} };
    expect(parseProfileDocument(doc).ok).toBe(false);
  });

  it("every value kind in the allowlisted vocabulary is individually constructible with its own minimal companion fields", () => {
    const minimalRuleFor = (kind: (typeof VALUE_KINDS)[number]): ColumnRuleV2 => {
      if (kind === "IDENTIFIER") return { sourceSchemaColumnId: COL(kind), valueKind: kind, preserveLeadingZeros: true };
      if (kind === "DATE" || kind === "DATETIME") return { sourceSchemaColumnId: COL(kind), valueKind: kind, datePolicy: "ISO_8601" };
      return { sourceSchemaColumnId: COL(kind), valueKind: kind };
    };
    for (const kind of VALUE_KINDS) {
      const doc = { documentVersion: 2, schemaStatus: "DRAFT", headerRowOneBased: 3, columnRules: [minimalRuleFor(kind)] };
      expect(parseProfileDocument(doc).ok, kind).toBe(true);
    }
  });
});

describe("6.2D4C-A — D4B integration: shared helper preserves exact prior contract", () => {
  it("12/13. headerRowOneBasedFromDocument accepts both v1 and v2 documents, returning only the header row", () => {
    expect(headerRowOneBasedFromDocument({ documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 3 })).toBe(3);
    expect(headerRowOneBasedFromDocument({ documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: null })).toBeNull();
    expect(
      headerRowOneBasedFromDocument({
        documentVersion: 2,
        schemaStatus: "DRAFT",
        headerRowOneBased: 5,
        columnRules: [validRule({ sourceSchemaColumnId: COL("z") })],
      }),
    ).toBe(5);
    expect(headerRowOneBasedFromDocument({ documentVersion: 2, schemaStatus: "DRAFT", headerRowOneBased: null, columnRules: [] })).toBeNull();
    expect(headerRowOneBasedFromDocument({ documentVersion: 1, schemaStatus: "DRAFT" })).toBeUndefined();
    expect(headerRowOneBasedFromDocument({ documentVersion: 2, schemaStatus: "DRAFT", headerRowOneBased: 3 })).toBeUndefined();
  });

  it("D4B (eligibility.ts) delegates to the shared parser and no longer contains its own inline profile-document validation", () => {
    expect(ELIGIBILITY_CODE).toMatch(/from ["']\.\.\/schemaProfiles\/profileDocument["']/);
    expect(ELIGIBILITY_CODE).toContain("headerRowOneBasedFromDocument(profileVersion.profile_document)");
    // The old private validator's own literal name must be gone — proves the
    // logic was actually moved, not merely duplicated.
    expect(ELIGIBILITY_CODE).not.toContain("function headerRowFromProfileDocument");
    // D4B must never inspect columnRules or import the rule/valueKind vocabulary.
    expect(ELIGIBILITY_CODE).not.toMatch(/columnRules|ColumnRuleV2|ValueKind|parseProfileDocument/);
  });

  it("17 (module-scoped): the profile-document contract module has no Prisma/DB access and cannot itself resolve active_profile_version_id", () => {
    expect(MODULE_CODE).not.toMatch(/prisma|active_profile_version_id/);
  });
});
