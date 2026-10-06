import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildRelationshipClarificationPlan,
  type RelationshipDiscoveryResult,
} from "@/lib/data-hub/relationshipDiscovery";

function candidate(
  leftDatasetId: string,
  leftColumnId: string,
  rightDatasetId: string,
  rightColumnId: string,
): RelationshipDiscoveryResult["candidates"][number] {
  return {
    kind: "POTENTIAL_IDENTIFIER_JOIN",
    left: {
      datasetId: leftDatasetId,
      sourceSchemaColumnId: leftColumnId,
    },
    right: {
      datasetId: rightDatasetId,
      sourceSchemaColumnId: rightColumnId,
    },
    confidence: "MEDIUM",
    evidence: [
      "EXACT_GOVERNED_LABEL_MATCH",
      "LEFT_IDENTIFIER_CLASS",
      "RIGHT_IDENTIFIER_CLASS",
      "LEFT_RECORD_KEY_CANDIDATE",
    ],
  };
}

describe("D4D3B relationship clarification planning", () => {
  it("requires no review when discovery produced no candidates", () => {
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "NONE",
      candidates: [],
    };

    expect(buildRelationshipClarificationPlan(discovery)).toEqual({
      clarificationVersion: "v1",
      discoveryVersion: "v1",
      state: "NO_REVIEW_REQUIRED",
      candidateCount: 0,
      candidates: [],
    });
  });

  it("requires explicit confirmation for a single relationship candidate", () => {
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "ONE",
      candidates: [candidate("a", "a-id", "b", "b-id")],
    };

    expect(buildRelationshipClarificationPlan(discovery)).toEqual({
      clarificationVersion: "v1",
      discoveryVersion: "v1",
      state: "CONFIRMATION_REQUIRED",
      candidateCount: 1,
      candidates: [
        {
          candidate: {
            left: {
              datasetId: "a",
              sourceSchemaColumnId: "a-id",
            },
            right: {
              datasetId: "b",
              sourceSchemaColumnId: "b-id",
            },
          },
          state: "CONFIRMATION_REQUIRED",
          confidence: "MEDIUM",
          reasons: [
            "CANDIDATE_REQUIRES_CONFIRMATION",
            "NON_HIGH_CONFIDENCE",
          ],
        },
      ],
    });
  });

  it("adds the multiple-candidates reason without choosing among them", () => {
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "MULTIPLE",
      candidates: [
        candidate("a", "a-id", "b", "b-id"),
        candidate("a", "a-id", "c", "c-id"),
      ],
    };

    const plan = buildRelationshipClarificationPlan(discovery);

    expect(plan.state).toBe("CONFIRMATION_REQUIRED");
    expect(plan.candidateCount).toBe(2);
    expect(plan.candidates).toHaveLength(2);
    for (const item of plan.candidates) {
      expect(item.reasons).toEqual([
        "CANDIDATE_REQUIRES_CONFIRMATION",
        "NON_HIGH_CONFIDENCE",
        "MULTIPLE_CANDIDATES_PRESENT",
      ]);
    }
  });

  it("preserves discovery candidate order", () => {
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "MULTIPLE",
      candidates: [
        candidate("z", "z-id", "y", "y-id"),
        candidate("a", "a-id", "b", "b-id"),
      ],
    };

    const plan = buildRelationshipClarificationPlan(discovery);

    expect(
      plan.candidates.map((item) => [
        item.candidate.left.datasetId,
        item.candidate.right.datasetId,
      ]),
    ).toEqual([
      ["z", "y"],
      ["a", "b"],
    ]);
  });

  it("does not copy relationship evidence or governed metadata into the clarification output", () => {
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "ONE",
      candidates: [candidate("a", "a-id", "b", "b-id")],
    };

    const serialized = JSON.stringify(
      buildRelationshipClarificationPlan(discovery),
    );

    expect(serialized).not.toContain("EXACT_GOVERNED_LABEL_MATCH");
    expect(serialized).not.toContain("LEFT_RECORD_KEY_CANDIDATE");
    expect(serialized).not.toContain("governedLabel");
  });

  it("is deterministic across repeated execution", () => {
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "ONE",
      candidates: [candidate("a", "a-id", "b", "b-id")],
    };

    const first = buildRelationshipClarificationPlan(discovery);
    const second = buildRelationshipClarificationPlan(discovery);

    expect(first).toEqual(second);
  });

  it("does not mutate the discovery candidate endpoints", () => {
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "ONE",
      candidates: [candidate("a", "a-id", "b", "b-id")],
    };

    const plan = buildRelationshipClarificationPlan(discovery);
    plan.candidates[0].candidate.left.datasetId = "changed";

    expect(discovery.candidates[0].left.datasetId).toBe("a");
  });

  it("keeps clarification planning pure and dependency-bounded", () => {
    const dir = path.join(
      process.cwd(),
      "lib",
      "data-hub",
      "relationshipDiscovery",
    );
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
