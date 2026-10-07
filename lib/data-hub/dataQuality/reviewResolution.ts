import type {
  DataQualityReviewItem,
  DataQualityReviewPlan,
} from "./reviewPlanning";

export const DATA_QUALITY_REVIEW_RESOLUTION_VERSION = "v1" as const;

export const DATA_QUALITY_REVIEW_DECISIONS = [
  "ACKNOWLEDGE",
  "CONTINUE",
  "HOLD",
] as const;

export type DataQualityReviewDecision =
  (typeof DATA_QUALITY_REVIEW_DECISIONS)[number];

export const DATA_QUALITY_REVIEW_RESOLUTION_ERROR_CODES = [
  "DECISION_REQUIRED",
  "DUPLICATE_DECISION",
  "UNKNOWN_REVIEW_ITEM",
  "INVALID_DECISION_FOR_NOTICE",
  "INVALID_DECISION_FOR_REQUIRED_REVIEW",
] as const;

export type DataQualityReviewResolutionErrorCode =
  (typeof DATA_QUALITY_REVIEW_RESOLUTION_ERROR_CODES)[number];

export interface DataQualityReviewDecisionInput {
  code: DataQualityReviewItem["code"];
  scope: DataQualityReviewItem["scope"];
  sourceSchemaColumnId?: string;
  decision: DataQualityReviewDecision;
}

export type DataQualityContinuationState =
  | "READY"
  | "READY_WITH_ACKNOWLEDGED_NOTICES"
  | "HOLD_FOR_REMEDIATION";

export interface ResolvedDataQualityReviewItem {
  code: DataQualityReviewItem["code"];
  scope: DataQualityReviewItem["scope"];
  sourceSchemaColumnId?: string;
  decision: DataQualityReviewDecision;
}

export interface DataQualityReviewResolution {
  resolutionVersion: typeof DATA_QUALITY_REVIEW_RESOLUTION_VERSION;
  reviewVersion: DataQualityReviewPlan["reviewVersion"];
  qualityVersion: DataQualityReviewPlan["qualityVersion"];
  profilerVersion: DataQualityReviewPlan["profilerVersion"];
  schemaVersion: DataQualityReviewPlan["schemaVersion"];
  state: DataQualityContinuationState;
  itemCount: number;
  acknowledgedNoticeCount: number;
  continuedReviewCount: number;
  heldReviewCount: number;
  items: ResolvedDataQualityReviewItem[];
}

export type ResolveDataQualityReviewResult =
  | { ok: true; resolved: DataQualityReviewResolution }
  | {
      ok: false;
      code: DataQualityReviewResolutionErrorCode;
      item: Omit<DataQualityReviewDecisionInput, "decision">;
    };

function itemKey(
  item: Pick<
    DataQualityReviewItem | DataQualityReviewDecisionInput,
    "code" | "scope" | "sourceSchemaColumnId"
  >,
): string {
  return [
    item.code,
    item.scope,
    item.sourceSchemaColumnId ?? "",
  ].join("\u0000");
}

function itemIdentity(
  item: Pick<
    DataQualityReviewItem | DataQualityReviewDecisionInput,
    "code" | "scope" | "sourceSchemaColumnId"
  >,
): Omit<DataQualityReviewDecisionInput, "decision"> {
  return {
    code: item.code,
    scope: item.scope,
    ...(item.sourceSchemaColumnId === undefined
      ? {}
      : { sourceSchemaColumnId: item.sourceSchemaColumnId }),
  };
}

export function resolveDataQualityReview(
  plan: DataQualityReviewPlan,
  decisions: readonly DataQualityReviewDecisionInput[] = [],
): ResolveDataQualityReviewResult {
  const planItemByKey = new Map<string, DataQualityReviewItem>();
  for (const item of plan.items) {
    planItemByKey.set(itemKey(item), item);
  }

  const decisionByKey = new Map<string, DataQualityReviewDecisionInput>();
  for (const decision of decisions) {
    const key = itemKey(decision);

    if (decisionByKey.has(key)) {
      return {
        ok: false,
        code: "DUPLICATE_DECISION",
        item: itemIdentity(decision),
      };
    }

    if (!planItemByKey.has(key)) {
      return {
        ok: false,
        code: "UNKNOWN_REVIEW_ITEM",
        item: itemIdentity(decision),
      };
    }

    decisionByKey.set(key, decision);
  }

  const resolvedItems: ResolvedDataQualityReviewItem[] = [];
  let acknowledgedNoticeCount = 0;
  let continuedReviewCount = 0;
  let heldReviewCount = 0;

  for (const item of plan.items) {
    const key = itemKey(item);
    const decision = decisionByKey.get(key);

    if (!decision) {
      return {
        ok: false,
        code: "DECISION_REQUIRED",
        item: itemIdentity(item),
      };
    }

    if (item.action === "ACKNOWLEDGE_NOTICE") {
      if (decision.decision !== "ACKNOWLEDGE") {
        return {
          ok: false,
          code: "INVALID_DECISION_FOR_NOTICE",
          item: itemIdentity(item),
        };
      }
      acknowledgedNoticeCount += 1;
    } else {
      if (
        decision.decision !== "CONTINUE" &&
        decision.decision !== "HOLD"
      ) {
        return {
          ok: false,
          code: "INVALID_DECISION_FOR_REQUIRED_REVIEW",
          item: itemIdentity(item),
        };
      }

      if (decision.decision === "CONTINUE") {
        continuedReviewCount += 1;
      } else {
        heldReviewCount += 1;
      }
    }

    resolvedItems.push({
      code: item.code,
      scope: item.scope,
      ...(item.sourceSchemaColumnId === undefined
        ? {}
        : { sourceSchemaColumnId: item.sourceSchemaColumnId }),
      decision: decision.decision,
    });
  }

  const state: DataQualityContinuationState =
    heldReviewCount > 0
      ? "HOLD_FOR_REMEDIATION"
      : acknowledgedNoticeCount > 0
        ? "READY_WITH_ACKNOWLEDGED_NOTICES"
        : "READY";

  return {
    ok: true,
    resolved: {
      resolutionVersion: DATA_QUALITY_REVIEW_RESOLUTION_VERSION,
      reviewVersion: plan.reviewVersion,
      qualityVersion: plan.qualityVersion,
      profilerVersion: plan.profilerVersion,
      schemaVersion: plan.schemaVersion,
      state,
      itemCount: resolvedItems.length,
      acknowledgedNoticeCount,
      continuedReviewCount,
      heldReviewCount,
      items: resolvedItems,
    },
  };
}
