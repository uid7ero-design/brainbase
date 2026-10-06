import type {
  RelationshipCandidate,
  RelationshipDiscoveryResult,
  RelationshipEndpoint,
  RelationshipEvidenceCode,
} from "./contracts";

export const RELATIONSHIP_RESOLUTION_VERSION = "v1" as const;

export const RELATIONSHIP_DECISIONS = ["CONFIRM", "REJECT"] as const;
export type RelationshipDecision = (typeof RELATIONSHIP_DECISIONS)[number];

export const RELATIONSHIP_RESOLUTION_ERROR_CODES = [
  "DECISION_REQUIRED",
  "DUPLICATE_DECISION",
  "UNKNOWN_CANDIDATE",
] as const;
export type RelationshipResolutionErrorCode =
  (typeof RELATIONSHIP_RESOLUTION_ERROR_CODES)[number];

export interface RelationshipDecisionInput {
  left: RelationshipEndpoint;
  right: RelationshipEndpoint;
  decision: RelationshipDecision;
}

export interface ResolvedRelationship {
  kind: "CONFIRMED_IDENTIFIER_JOIN";
  left: RelationshipEndpoint;
  right: RelationshipEndpoint;
  confidence: RelationshipCandidate["confidence"];
  evidence: RelationshipEvidenceCode[];
  resolutionSource: "CLARIFIED_CONFIRMATION";
}

export interface RelationshipResolution {
  resolutionVersion: typeof RELATIONSHIP_RESOLUTION_VERSION;
  discoveryVersion: RelationshipDiscoveryResult["discoveryVersion"];
  candidateCount: number;
  confirmedCount: number;
  rejectedCount: number;
  relationships: ResolvedRelationship[];
}

export type ResolveRelationshipCandidatesResult =
  | { ok: true; resolved: RelationshipResolution }
  | {
      ok: false;
      code: RelationshipResolutionErrorCode;
      left: RelationshipEndpoint;
      right: RelationshipEndpoint;
    };

function candidateKey(
  left: RelationshipEndpoint,
  right: RelationshipEndpoint,
): string {
  return [
    left.datasetId,
    left.sourceSchemaColumnId,
    right.datasetId,
    right.sourceSchemaColumnId,
  ].join("\u0000");
}

export function resolveRelationshipCandidates(
  discovery: RelationshipDiscoveryResult,
  decisions: readonly RelationshipDecisionInput[] = [],
): ResolveRelationshipCandidatesResult {
  const candidateByKey = new Map<string, RelationshipCandidate>();
  for (const candidate of discovery.candidates) {
    candidateByKey.set(
      candidateKey(candidate.left, candidate.right),
      candidate,
    );
  }

  const decisionByKey = new Map<string, RelationshipDecisionInput>();
  for (const decision of decisions) {
    const key = candidateKey(decision.left, decision.right);

    if (decisionByKey.has(key)) {
      return {
        ok: false,
        code: "DUPLICATE_DECISION",
        left: { ...decision.left },
        right: { ...decision.right },
      };
    }

    if (!candidateByKey.has(key)) {
      return {
        ok: false,
        code: "UNKNOWN_CANDIDATE",
        left: { ...decision.left },
        right: { ...decision.right },
      };
    }

    decisionByKey.set(key, decision);
  }

  const relationships: ResolvedRelationship[] = [];
  let rejectedCount = 0;

  for (const candidate of discovery.candidates) {
    const key = candidateKey(candidate.left, candidate.right);
    const decision = decisionByKey.get(key);

    if (!decision) {
      return {
        ok: false,
        code: "DECISION_REQUIRED",
        left: { ...candidate.left },
        right: { ...candidate.right },
      };
    }

    if (decision.decision === "REJECT") {
      rejectedCount += 1;
      continue;
    }

    relationships.push({
      kind: "CONFIRMED_IDENTIFIER_JOIN",
      left: { ...candidate.left },
      right: { ...candidate.right },
      confidence: candidate.confidence,
      evidence: [...candidate.evidence],
      resolutionSource: "CLARIFIED_CONFIRMATION",
    });
  }

  return {
    ok: true,
    resolved: {
      resolutionVersion: RELATIONSHIP_RESOLUTION_VERSION,
      discoveryVersion: discovery.discoveryVersion,
      candidateCount: discovery.candidates.length,
      confirmedCount: relationships.length,
      rejectedCount,
      relationships,
    },
  };
}
