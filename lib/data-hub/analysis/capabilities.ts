import type { AnalysisReadiness } from "./contracts";

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

export type AnalysisCapabilityState = "AVAILABLE" | "BLOCKED_QUALITY_HOLD";

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
