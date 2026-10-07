import type {
  DataQualityAssessment,
  DataQualityObservation,
} from "./contracts";

export const DATA_QUALITY_REVIEW_VERSION = "v1" as const;

export const DATA_QUALITY_REVIEW_ACTIONS = [
  "ACKNOWLEDGE_NOTICE",
  "REVIEW_DATASET",
  "REVIEW_COLUMN",
] as const;

export type DataQualityReviewAction =
  (typeof DATA_QUALITY_REVIEW_ACTIONS)[number];

export interface DataQualityReviewItem {
  code: DataQualityObservation["code"];
  action: DataQualityReviewAction;
  scope: DataQualityObservation["scope"];
  sourceSchemaColumnId?: string;
}

export type DataQualityReviewState =
  | "NO_REVIEW_REQUIRED"
  | "NOTICE_ACKNOWLEDGEMENT_AVAILABLE"
  | "REVIEW_REQUIRED";

export interface DataQualityReviewPlan {
  reviewVersion: typeof DATA_QUALITY_REVIEW_VERSION;
  qualityVersion: DataQualityAssessment["qualityVersion"];
  profilerVersion: DataQualityAssessment["profilerVersion"];
  schemaVersion: DataQualityAssessment["schemaVersion"];
  state: DataQualityReviewState;
  itemCount: number;
  requiredReviewCount: number;
  noticeCount: number;
  items: DataQualityReviewItem[];
}

function itemFor(
  observation: DataQualityObservation,
): DataQualityReviewItem {
  if (observation.severity === "NOTICE") {
    return {
      code: observation.code,
      action: "ACKNOWLEDGE_NOTICE",
      scope: observation.scope,
      ...(observation.sourceSchemaColumnId === undefined
        ? {}
        : { sourceSchemaColumnId: observation.sourceSchemaColumnId }),
    };
  }

  return {
    code: observation.code,
    action:
      observation.scope === "DATASET" ? "REVIEW_DATASET" : "REVIEW_COLUMN",
    scope: observation.scope,
    ...(observation.sourceSchemaColumnId === undefined
      ? {}
      : { sourceSchemaColumnId: observation.sourceSchemaColumnId }),
  };
}

export function buildDataQualityReviewPlan(
  assessment: DataQualityAssessment,
): DataQualityReviewPlan {
  const items = assessment.observations.map(itemFor);
  const requiredReviewCount = assessment.observations.filter(
    (observation) => observation.severity === "REVIEW_REQUIRED",
  ).length;
  const noticeCount = assessment.observations.length - requiredReviewCount;

  const state: DataQualityReviewState =
    requiredReviewCount > 0
      ? "REVIEW_REQUIRED"
      : noticeCount > 0
        ? "NOTICE_ACKNOWLEDGEMENT_AVAILABLE"
        : "NO_REVIEW_REQUIRED";

  return {
    reviewVersion: DATA_QUALITY_REVIEW_VERSION,
    qualityVersion: assessment.qualityVersion,
    profilerVersion: assessment.profilerVersion,
    schemaVersion: assessment.schemaVersion,
    state,
    itemCount: items.length,
    requiredReviewCount,
    noticeCount,
    items,
  };
}
