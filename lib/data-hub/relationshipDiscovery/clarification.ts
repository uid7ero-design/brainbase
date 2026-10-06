import type {
  RelationshipCandidate,
  RelationshipDiscoveryResult,
  RelationshipEndpoint,
} from "./contracts";

export const RELATIONSHIP_CLARIFICATION_VERSION = "v1" as const;

export const RELATIONSHIP_CLARIFICATION_REASONS = [
  "CANDIDATE_REQUIRES_CONFIRMATION",
  "NON_HIGH_CONFIDENCE",
  "MULTIPLE_CANDIDATES_PRESENT",
] as const;

export type RelationshipClarificationReason =
  (typeof RELATIONSHIP_CLARIFICATION_REASONS)[number];

export type RelationshipClarificationState =
  | "NO_REVIEW_REQUIRED"
  | "CONFIRMATION_REQUIRED";

export interface RelationshipCandidateReference {
  left: RelationshipEndpoint;
  right: RelationshipEndpoint;
}

export interface RelationshipCandidateClarification {
  candidate: RelationshipCandidateReference;
  state: "CONFIRMATION_REQUIRED";
  confidence: RelationshipCandidate["confidence"];
  reasons: RelationshipClarificationReason[];
}

export interface RelationshipClarificationPlan {
  clarificationVersion: typeof RELATIONSHIP_CLARIFICATION_VERSION;
  discoveryVersion: RelationshipDiscoveryResult["discoveryVersion"];
  state: RelationshipClarificationState;
  candidateCount: number;
  candidates: RelationshipCandidateClarification[];
}

function candidateReasons(
  candidate: RelationshipCandidate,
  multipleCandidates: boolean,
): RelationshipClarificationReason[] {
  const reasons: RelationshipClarificationReason[] = [
    "CANDIDATE_REQUIRES_CONFIRMATION",
  ];

  if (candidate.confidence !== "HIGH") {
    reasons.push("NON_HIGH_CONFIDENCE");
  }

  if (multipleCandidates) {
    reasons.push("MULTIPLE_CANDIDATES_PRESENT");
  }

  return reasons;
}

export function buildRelationshipClarificationPlan(
  discovery: RelationshipDiscoveryResult,
): RelationshipClarificationPlan {
  const multipleCandidates = discovery.candidates.length > 1;
  const candidates: RelationshipCandidateClarification[] =
    discovery.candidates.map((candidate) => ({
      candidate: {
        left: { ...candidate.left },
        right: { ...candidate.right },
      },
      state: "CONFIRMATION_REQUIRED",
      confidence: candidate.confidence,
      reasons: candidateReasons(candidate, multipleCandidates),
    }));

  return {
    clarificationVersion: RELATIONSHIP_CLARIFICATION_VERSION,
    discoveryVersion: discovery.discoveryVersion,
    state:
      candidates.length === 0
        ? "NO_REVIEW_REQUIRED"
        : "CONFIRMATION_REQUIRED",
    candidateCount: candidates.length,
    candidates,
  };
}
