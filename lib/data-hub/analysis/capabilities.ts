import { ANALYSIS_READINESS_VERSION, type AnalysisReadiness } from "./contracts";
import { hasValidAnalysisFieldCatalog } from "./fieldCatalogValidation";

export const ANALYSIS_CAPABILITY_VERSION = "v1" as const;

export const DATASET_ANALYSIS_CAPABILITIES = ["ROW_COUNT"] as const;
export type DatasetAnalysisCapability =
  (typeof DATASET_ANALYSIS_CAPABILITIES)[number];

export const FIELD_ANALYSIS_CAPABILITIES = [
  "TEXT_REFERENCE",
  "IDENTIFIER_REFERENCE",
  "GROUP_BY",
  "AGGREGATE",
  "TIME_AXIS",
  "GEO_AXIS",
] as const;
export type FieldAnalysisCapability =
  (typeof FIELD_ANALYSIS_CAPABILITIES)[number];

export type AnalysisCapabilityState = "AVAILABLE" | "BLOCKED_QUALITY_HOLD" | "UNAVAILABLE_INVALID_READINESS";

export interface FieldAnalysisCapabilityEntry {
  sourceSchemaColumnId: string;
  capability: FieldAnalysisCapability;
}

export interface AnalysisCapabilitySet {
  capabilityVersion: typeof ANALYSIS_CAPABILITY_VERSION;
  readinessVersion: AnalysisReadiness["readinessVersion"];
  state: AnalysisCapabilityState;
  datasetCapabilities: DatasetAnalysisCapability[];
  fieldCapabilities: FieldAnalysisCapabilityEntry[];
}

function append(
  target: FieldAnalysisCapabilityEntry[],
  ids: readonly string[],
  capability: FieldAnalysisCapability,
): void {
  for (const sourceSchemaColumnId of ids) {
    target.push({ sourceSchemaColumnId, capability });
  }
}

export function buildAnalysisCapabilities(
  readiness: AnalysisReadiness,
): AnalysisCapabilitySet {
  if (readiness.state === "BLOCKED_QUALITY_HOLD") {
    return {
      capabilityVersion: ANALYSIS_CAPABILITY_VERSION,
      readinessVersion: readiness.readinessVersion,
      state: "BLOCKED_QUALITY_HOLD",
      datasetCapabilities: [],
      fieldCapabilities: [],
    };
  }

  // A quality hold is a reviewed decision. Invalid metadata must never be
  // relabeled as either that decision or available capabilities.
  if ((readiness.state !== "READY" && readiness.state !== "READY_WITH_ACKNOWLEDGED_NOTICES") ||
      readiness.readinessVersion !== ANALYSIS_READINESS_VERSION || !hasValidAnalysisFieldCatalog(readiness)) {
    return {
      capabilityVersion: ANALYSIS_CAPABILITY_VERSION,
      readinessVersion: readiness.readinessVersion,
      state: "UNAVAILABLE_INVALID_READINESS",
      datasetCapabilities: [],
      fieldCapabilities: [],
    };
  }

  const fieldCapabilities: FieldAnalysisCapabilityEntry[] = [];

  append(
    fieldCapabilities,
    readiness.catalog.textAttributes,
    "TEXT_REFERENCE",
  );
  append(
    fieldCapabilities,
    readiness.catalog.identifiers,
    "IDENTIFIER_REFERENCE",
  );
  append(fieldCapabilities, readiness.catalog.dimensions, "GROUP_BY");
  append(fieldCapabilities, readiness.catalog.flags, "GROUP_BY");
  append(fieldCapabilities, readiness.catalog.measures, "AGGREGATE");
  append(fieldCapabilities, readiness.catalog.temporals, "TIME_AXIS");
  append(fieldCapabilities, readiness.catalog.geoCoordinates, "GEO_AXIS");

  return {
    capabilityVersion: ANALYSIS_CAPABILITY_VERSION,
    readinessVersion: readiness.readinessVersion,
    state: "AVAILABLE",
    datasetCapabilities: ["ROW_COUNT"],
    fieldCapabilities,
  };
}
