import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildDataQualityReviewPlan,
  resolveDataQualityReview,
  type DataQualityAssessment,
} from "@/lib/data-hub/dataQuality";

function assessment(
  observations: DataQualityAssessment["observations"],
): DataQualityAssessment {
  const status = observations.some(
    (observation) => observation.severity === "REVIEW_REQUIRED",
  )
    ? "REVIEW_REQUIRED"
    : observations.length > 0
      ? "OBSERVATIONS_PRESENT"
      : "CLEAN";

  return {
    qualityVersion: "v1",
    profilerVersion: "v1",
    schemaVersion: "v1",
    status,
    observations,
  };
}

describe("D4D4C data quality review resolution", () => {
  it("resolves a clean plan without decisions", () => {
    const plan = buildDataQualityReviewPlan(assessment([]));

    expect(resolveDataQualityReview(plan)).toEqual({
      ok: true,
      resolved: {
        resolutionVersion: "v1",
        reviewVersion: "v1",
        qualityVersion: "v1",
        profilerVersion: "v1",
        schemaVersion: "v1",
        state: "READY",
        itemCount: 0,
        acknowledgedNoticeCount: 0,
        continuedReviewCount: 0,
        heldReviewCount: 0,
        items: [],
      },
    });
  });

  it("requires acknowledgement for NOTICE items", () => {
    const plan = buildDataQualityReviewPlan(
      assessment([
        {
          code: "COLUMN_CONSTANT",
          severity: "NOTICE",
          scope: "COLUMN",
          sourceSchemaColumnId: "c1",
        },
      ]),
    );

    expect(resolveDataQualityReview(plan)).toMatchObject({
      ok: false,
      code: "DECISION_REQUIRED",
    });

    expect(
      resolveDataQualityReview(plan, [
        {
          code: "COLUMN_CONSTANT",
          scope: "COLUMN",
          sourceSchemaColumnId: "c1",
          decision: "ACKNOWLEDGE",
        },
      ]),
    ).toMatchObject({
      ok: true,
      resolved: {
        state: "READY_WITH_ACKNOWLEDGED_NOTICES",
        acknowledgedNoticeCount: 1,
        continuedReviewCount: 0,
        heldReviewCount: 0,
      },
    });
  });

  it("requires CONTINUE or HOLD for mandatory review items", () => {
    const plan = buildDataQualityReviewPlan(
      assessment([
        {
          code: "COLUMN_ALL_NULL",
          severity: "REVIEW_REQUIRED",
          scope: "COLUMN",
          sourceSchemaColumnId: "c1",
        },
      ]),
    );

    expect(
      resolveDataQualityReview(plan, [
        {
          code: "COLUMN_ALL_NULL",
          scope: "COLUMN",
          sourceSchemaColumnId: "c1",
          decision: "ACKNOWLEDGE",
        },
      ]),
    ).toMatchObject({
      ok: false,
      code: "INVALID_DECISION_FOR_REQUIRED_REVIEW",
    });

    expect(
      resolveDataQualityReview(plan, [
        {
          code: "COLUMN_ALL_NULL",
          scope: "COLUMN",
          sourceSchemaColumnId: "c1",
          decision: "CONTINUE",
        },
      ]),
    ).toMatchObject({
      ok: true,
      resolved: {
        state: "READY",
        continuedReviewCount: 1,
        heldReviewCount: 0,
      },
    });
  });

  it("holds continuation when any required review is held", () => {
    const plan = buildDataQualityReviewPlan(
      assessment([
        {
          code: "EMPTY_DATASET",
          severity: "REVIEW_REQUIRED",
          scope: "DATASET",
        },
        {
          code: "COLUMN_PARTIALLY_NULL",
          severity: "NOTICE",
          scope: "COLUMN",
          sourceSchemaColumnId: "c1",
        },
      ]),
    );

    const result = resolveDataQualityReview(plan, [
      {
        code: "EMPTY_DATASET",
        scope: "DATASET",
        decision: "HOLD",
      },
      {
        code: "COLUMN_PARTIALLY_NULL",
        scope: "COLUMN",
        sourceSchemaColumnId: "c1",
        decision: "ACKNOWLEDGE",
      },
    ]);

    expect(result).toMatchObject({
      ok: true,
      resolved: {
        state: "HOLD_FOR_REMEDIATION",
        acknowledgedNoticeCount: 1,
        continuedReviewCount: 0,
        heldReviewCount: 1,
      },
    });
  });

  it("rejects invalid decision types for NOTICE items", () => {
    const plan = buildDataQualityReviewPlan(
      assessment([
        {
          code: "COLUMN_PARTIALLY_NULL",
          severity: "NOTICE",
          scope: "COLUMN",
          sourceSchemaColumnId: "c1",
        },
      ]),
    );

    expect(
      resolveDataQualityReview(plan, [
        {
          code: "COLUMN_PARTIALLY_NULL",
          scope: "COLUMN",
          sourceSchemaColumnId: "c1",
          decision: "CONTINUE",
        },
      ]),
    ).toMatchObject({
      ok: false,
      code: "INVALID_DECISION_FOR_NOTICE",
    });
  });

  it("rejects duplicate and unknown decisions", () => {
    const plan = buildDataQualityReviewPlan(
      assessment([
        {
          code: "COLUMN_CONSTANT",
          severity: "NOTICE",
          scope: "COLUMN",
          sourceSchemaColumnId: "c1",
        },
      ]),
    );

    const duplicate = {
      code: "COLUMN_CONSTANT" as const,
      scope: "COLUMN" as const,
      sourceSchemaColumnId: "c1",
      decision: "ACKNOWLEDGE" as const,
    };

    expect(resolveDataQualityReview(plan, [duplicate, duplicate])).toMatchObject({
      ok: false,
      code: "DUPLICATE_DECISION",
    });

    expect(
      resolveDataQualityReview(plan, [
        {
          code: "COLUMN_CONSTANT",
          scope: "COLUMN",
          sourceSchemaColumnId: "unknown",
          decision: "ACKNOWLEDGE",
        },
      ]),
    ).toMatchObject({
      ok: false,
      code: "UNKNOWN_REVIEW_ITEM",
    });
  });

  it("preserves review-item order and clones resolved decisions", () => {
    const plan = buildDataQualityReviewPlan(
      assessment([
        {
          code: "COLUMN_CONSTANT",
          severity: "NOTICE",
          scope: "COLUMN",
          sourceSchemaColumnId: "a",
        },
        {
          code: "RECORD_KEY_CANDIDATE_INCOMPLETE",
          severity: "REVIEW_REQUIRED",
          scope: "COLUMN",
          sourceSchemaColumnId: "b",
        },
      ]),
    );

    const result = resolveDataQualityReview(plan, [
      {
        code: "RECORD_KEY_CANDIDATE_INCOMPLETE",
        scope: "COLUMN",
        sourceSchemaColumnId: "b",
        decision: "CONTINUE",
      },
      {
        code: "COLUMN_CONSTANT",
        scope: "COLUMN",
        sourceSchemaColumnId: "a",
        decision: "ACKNOWLEDGE",
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);

    expect(result.resolved.items.map((item) => item.code)).toEqual([
      "COLUMN_CONSTANT",
      "RECORD_KEY_CANDIDATE_INCOMPLETE",
    ]);

    result.resolved.items[0].sourceSchemaColumnId = "changed";
    expect(plan.items[0].sourceSchemaColumnId).toBe("a");
  });

  it("keeps quality review resolution pure and dependency-bounded", () => {
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
