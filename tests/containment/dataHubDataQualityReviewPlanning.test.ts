import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildDataQualityReviewPlan,
  type DataQualityAssessment,
} from "@/lib/data-hub/dataQuality";

function assessment(
  overrides: Partial<DataQualityAssessment> = {},
): DataQualityAssessment {
  return {
    qualityVersion: "v1",
    profilerVersion: "v1",
    schemaVersion: "v1",
    status: "CLEAN",
    observations: [],
    ...overrides,
  };
}

describe("D4D4B data quality review planning", () => {
  it("returns no review required for a clean assessment", () => {
    expect(buildDataQualityReviewPlan(assessment())).toEqual({
      reviewVersion: "v1",
      qualityVersion: "v1",
      profilerVersion: "v1",
      schemaVersion: "v1",
      state: "NO_REVIEW_REQUIRED",
      itemCount: 0,
      requiredReviewCount: 0,
      noticeCount: 0,
      items: [],
    });
  });

  it("maps NOTICE observations to acknowledgement without escalation", () => {
    const plan = buildDataQualityReviewPlan(
      assessment({
        status: "OBSERVATIONS_PRESENT",
        observations: [
          {
            code: "COLUMN_PARTIALLY_NULL",
            severity: "NOTICE",
            scope: "COLUMN",
            sourceSchemaColumnId: "col-a",
          },
        ],
      }),
    );

    expect(plan).toMatchObject({
      state: "NOTICE_ACKNOWLEDGEMENT_AVAILABLE",
      itemCount: 1,
      requiredReviewCount: 0,
      noticeCount: 1,
      items: [
        {
          code: "COLUMN_PARTIALLY_NULL",
          action: "ACKNOWLEDGE_NOTICE",
          scope: "COLUMN",
          sourceSchemaColumnId: "col-a",
        },
      ],
    });
  });

  it("maps dataset-level REVIEW_REQUIRED observations to dataset review", () => {
    const plan = buildDataQualityReviewPlan(
      assessment({
        status: "REVIEW_REQUIRED",
        observations: [
          {
            code: "EMPTY_DATASET",
            severity: "REVIEW_REQUIRED",
            scope: "DATASET",
          },
        ],
      }),
    );

    expect(plan).toMatchObject({
      state: "REVIEW_REQUIRED",
      requiredReviewCount: 1,
      noticeCount: 0,
      items: [
        {
          code: "EMPTY_DATASET",
          action: "REVIEW_DATASET",
          scope: "DATASET",
        },
      ],
    });
    expect(plan.items[0]).not.toHaveProperty("sourceSchemaColumnId");
  });

  it("maps column-level REVIEW_REQUIRED observations to column review", () => {
    const plan = buildDataQualityReviewPlan(
      assessment({
        status: "REVIEW_REQUIRED",
        observations: [
          {
            code: "RECORD_KEY_CANDIDATE_INCOMPLETE",
            severity: "REVIEW_REQUIRED",
            scope: "COLUMN",
            sourceSchemaColumnId: "asset-id",
          },
        ],
      }),
    );

    expect(plan.items).toEqual([
      {
        code: "RECORD_KEY_CANDIDATE_INCOMPLETE",
        action: "REVIEW_COLUMN",
        scope: "COLUMN",
        sourceSchemaColumnId: "asset-id",
      },
    ]);
  });

  it("preserves observation order and counts mixed notice/review items", () => {
    const plan = buildDataQualityReviewPlan(
      assessment({
        status: "REVIEW_REQUIRED",
        observations: [
          {
            code: "COLUMN_CONSTANT",
            severity: "NOTICE",
            scope: "COLUMN",
            sourceSchemaColumnId: "a",
          },
          {
            code: "MULTIPLE_RECORD_KEY_CANDIDATES",
            severity: "REVIEW_REQUIRED",
            scope: "DATASET",
          },
          {
            code: "COLUMN_PARTIALLY_NULL",
            severity: "NOTICE",
            scope: "COLUMN",
            sourceSchemaColumnId: "b",
          },
        ],
      }),
    );

    expect(plan.state).toBe("REVIEW_REQUIRED");
    expect(plan.itemCount).toBe(3);
    expect(plan.requiredReviewCount).toBe(1);
    expect(plan.noticeCount).toBe(2);
    expect(plan.items.map((item) => item.code)).toEqual([
      "COLUMN_CONSTANT",
      "MULTIPLE_RECORD_KEY_CANDIDATES",
      "COLUMN_PARTIALLY_NULL",
    ]);
  });

  it("is deterministic across repeated execution", () => {
    const input = assessment({
      status: "REVIEW_REQUIRED",
      observations: [
        {
          code: "COLUMN_ALL_NULL",
          severity: "REVIEW_REQUIRED",
          scope: "COLUMN",
          sourceSchemaColumnId: "x",
        },
      ],
    });

    expect(buildDataQualityReviewPlan(input)).toEqual(
      buildDataQualityReviewPlan(input),
    );
  });

  it("does not mutate the assessment observations", () => {
    const input = assessment({
      status: "OBSERVATIONS_PRESENT",
      observations: [
        {
          code: "COLUMN_CONSTANT",
          severity: "NOTICE",
          scope: "COLUMN",
          sourceSchemaColumnId: "x",
        },
      ],
    });

    const before = JSON.stringify(input);
    const plan = buildDataQualityReviewPlan(input);
    plan.items[0].sourceSchemaColumnId = "changed";

    expect(JSON.stringify(input)).toBe(before);
  });

  it("keeps review planning pure and dependency-bounded", () => {
    const dir = path.join(process.cwd(), "lib", "data-hub", "dataQuality");
    const source = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
      .join("\n")
      .toLowerCase();

    for (const forbidden of [
      "@prisma",
      "lib/db",
      "lib/prisma",
      "node:fs",
      "node:path",
      "fetch(",
      "axios",
      "openai",
      "anthropic",
      "date.now",
      "math.random",
      "process.env",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
