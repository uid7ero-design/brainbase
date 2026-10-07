import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolveRelationshipCandidates,
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

describe("D4D3C relationship resolution", () => {
  it("resolves an empty discovery without decisions", () => {
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "NONE",
      candidates: [],
    };

    expect(resolveRelationshipCandidates(discovery)).toEqual({
      ok: true,
      resolved: {
        resolutionVersion: "v1",
        discoveryVersion: "v1",
        candidateCount: 0,
        confirmedCount: 0,
        rejectedCount: 0,
        relationships: [],
      },
    });
  });

  it("requires an explicit decision for every candidate", () => {
    const c = candidate("a", "a-id", "b", "b-id");
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "ONE",
      candidates: [c],
    };

    expect(resolveRelationshipCandidates(discovery)).toEqual({
      ok: false,
      code: "DECISION_REQUIRED",
      left: c.left,
      right: c.right,
    });
  });

  it("confirms only an explicitly confirmed candidate", () => {
    const c = candidate("a", "a-id", "b", "b-id");
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "ONE",
      candidates: [c],
    };

    expect(
      resolveRelationshipCandidates(discovery, [
        { left: c.left, right: c.right, decision: "CONFIRM" },
      ]),
    ).toEqual({
      ok: true,
      resolved: {
        resolutionVersion: "v1",
        discoveryVersion: "v1",
        candidateCount: 1,
        confirmedCount: 1,
        rejectedCount: 0,
        relationships: [
          {
            kind: "CONFIRMED_IDENTIFIER_JOIN",
            left: c.left,
            right: c.right,
            confidence: "MEDIUM",
            evidence: c.evidence,
            resolutionSource: "CLARIFIED_CONFIRMATION",
          },
        ],
      },
    });
  });

  it("records rejection counts without emitting a relationship", () => {
    const c = candidate("a", "a-id", "b", "b-id");
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "ONE",
      candidates: [c],
    };

    expect(
      resolveRelationshipCandidates(discovery, [
        { left: c.left, right: c.right, decision: "REJECT" },
      ]),
    ).toEqual({
      ok: true,
      resolved: {
        resolutionVersion: "v1",
        discoveryVersion: "v1",
        candidateCount: 1,
        confirmedCount: 0,
        rejectedCount: 1,
        relationships: [],
      },
    });
  });

  it("supports mixed confirm/reject decisions while preserving candidate order", () => {
    const first = candidate("a", "a-id", "b", "b-id");
    const second = candidate("a", "a-id", "c", "c-id");
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "MULTIPLE",
      candidates: [first, second],
    };

    const result = resolveRelationshipCandidates(discovery, [
      { left: second.left, right: second.right, decision: "REJECT" },
      { left: first.left, right: first.right, decision: "CONFIRM" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);

    expect(result.resolved.confirmedCount).toBe(1);
    expect(result.resolved.rejectedCount).toBe(1);
    expect(result.resolved.relationships.map((relationship) => [
      relationship.left.datasetId,
      relationship.right.datasetId,
    ])).toEqual([["a", "b"]]);
  });

  it("rejects duplicate and unknown candidate decisions", () => {
    const c = candidate("a", "a-id", "b", "b-id");
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "ONE",
      candidates: [c],
    };

    expect(
      resolveRelationshipCandidates(discovery, [
        { left: c.left, right: c.right, decision: "CONFIRM" },
        { left: c.left, right: c.right, decision: "REJECT" },
      ]),
    ).toMatchObject({
      ok: false,
      code: "DUPLICATE_DECISION",
    });

    expect(
      resolveRelationshipCandidates(discovery, [
        {
          left: { datasetId: "x", sourceSchemaColumnId: "x-id" },
          right: c.right,
          decision: "CONFIRM",
        },
      ]),
    ).toMatchObject({
      ok: false,
      code: "UNKNOWN_CANDIDATE",
    });
  });

  it("is deterministic, clones resolved evidence, and exposes no free-form rationale", () => {
    const c = candidate("a", "a-id", "b", "b-id");
    const discovery: RelationshipDiscoveryResult = {
      discoveryVersion: "v1",
      state: "ONE",
      candidates: [c],
    };
    const decisions = [
      { left: c.left, right: c.right, decision: "CONFIRM" as const },
    ];

    const first = resolveRelationshipCandidates(discovery, decisions);
    const second = resolveRelationshipCandidates(discovery, decisions);

    expect(first).toEqual(second);
    if (!first.ok) throw new Error(first.code);

    first.resolved.relationships[0].evidence.push(
      "RIGHT_RECORD_KEY_CANDIDATE",
    );
    expect(discovery.candidates[0].evidence).not.toContain(
      "RIGHT_RECORD_KEY_CANDIDATE",
    );

    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("governedLabel");
    expect(serialized).not.toContain("message");
  });

  it("keeps relationship resolution pure and dependency-bounded", () => {
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
