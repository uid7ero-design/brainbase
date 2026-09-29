import { describe, expect, it } from "vitest";
import { transformRow } from "@/lib/data-hub/normalization/transformRow";
import { buildNormalizationPlan } from "@/lib/data-hub/normalization/plan";
import type { RawCellForColumn } from "@/lib/data-hub/normalization/transformRow";

const COL_A = "synthetic-col-a";
const COL_B = "synthetic-col-b";

function plan() {
  const doc = {
    documentVersion: 2,
    schemaStatus: "ACTIVE",
    headerRowOneBased: 3,
    columnRules: [
      { sourceSchemaColumnId: COL_A, valueKind: "STRING" },
      { sourceSchemaColumnId: COL_B, valueKind: "INTEGER" },
    ],
  };
  const result = buildNormalizationPlan(doc, [COL_A, COL_B]);
  if (!result.ok) throw new Error("test fixture plan build failed");
  return result.plan;
}

describe("6.2D4C-B2A transformRow — pure row helper", () => {
  it("transforms every cell for a row and returns successful outputs plus no findings when all succeed", () => {
    const cells: RawCellForColumn[] = [
      { sourceSchemaColumnId: COL_A, cell: { rawValueType: "STRING", rawValue: "hello" } },
      { sourceSchemaColumnId: COL_B, cell: { rawValueType: "NUMBER", rawValue: 42 } },
    ];
    const result = transformRow({ rawRowId: "row-1", sourceRowNumber: 5 }, cells, plan());
    expect(result.findings).toEqual([]);
    expect(result.outputs).toHaveLength(2);
    expect(result.outputs.find((o) => o.sourceSchemaColumnId === COL_A)?.normalizedValue).toBe("hello");
    expect(result.outputs.find((o) => o.sourceSchemaColumnId === COL_B)?.normalizedValue).toBe("42");
    expect(result.row).toEqual({ rawRowId: "row-1", sourceRowNumber: 5 });
  });

  it("collects findings per-cell without stopping at the first failure", () => {
    const cells: RawCellForColumn[] = [
      { sourceSchemaColumnId: COL_A, cell: { rawValueType: "NUMBER", rawValue: 1 } }, // STRING rule, wrong type
      { sourceSchemaColumnId: COL_B, cell: { rawValueType: "STRING", rawValue: "not-an-integer" } }, // INTEGER rule, malformed
    ];
    const result = transformRow({ rawRowId: "row-2", sourceRowNumber: 6 }, cells, plan());
    expect(result.outputs).toEqual([]);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.code).sort()).toEqual(["MALFORMED_NUMERIC_STRING", "UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND"]);
  });

  it("reports UNKNOWN_RULE_COLUMN for a cell whose column has no rule in the plan, without throwing", () => {
    const cells: RawCellForColumn[] = [{ sourceSchemaColumnId: "not-in-plan", cell: { rawValueType: "STRING", rawValue: "x" } }];
    const result = transformRow({ rawRowId: "row-3", sourceRowNumber: 7 }, cells, plan());
    expect(result.findings).toEqual([{ severity: "BLOCKING_ERROR", code: "UNKNOWN_RULE_COLUMN", sourceSchemaColumnId: "not-in-plan" }]);
  });

  it("never mutates the cells/row objects it is given", () => {
    const row = { rawRowId: "row-4", sourceRowNumber: 8 };
    const cells: RawCellForColumn[] = [{ sourceSchemaColumnId: COL_A, cell: { rawValueType: "STRING", rawValue: "hello" } }];
    const rowSnapshot = JSON.stringify(row);
    const cellsSnapshot = JSON.stringify(cells);
    transformRow(row, cells, plan());
    expect(JSON.stringify(row)).toBe(rowSnapshot);
    expect(JSON.stringify(cells)).toBe(cellsSnapshot);
  });

  it("produces a deep-equal result for identical repeated input", () => {
    const cells: RawCellForColumn[] = [{ sourceSchemaColumnId: COL_A, cell: { rawValueType: "STRING", rawValue: "x" } }];
    const a = transformRow({ rawRowId: "row-5", sourceRowNumber: 9 }, cells, plan());
    const b = transformRow({ rawRowId: "row-5", sourceRowNumber: 9 }, cells, plan());
    expect(a).toEqual(b);
  });
});
