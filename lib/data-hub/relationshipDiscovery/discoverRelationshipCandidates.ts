import type { SemanticSchemaFieldDraft } from "../semanticInference/schemaSynthesis";
import {
  RELATIONSHIP_DISCOVERY_VERSION,
  type DiscoverRelationshipCandidatesResult,
  type RelationshipCandidate,
  type RelationshipDatasetInput,
  type RelationshipEvidenceCode,
} from "./contracts";

function canonicalLabel(label: string): string {
  return label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function validateDatasets(
  datasets: readonly RelationshipDatasetInput[],
): DiscoverRelationshipCandidatesResult | Map<string, Map<string, string>> {
  const seenDatasetIds = new Set<string>();
  const labelsByDataset = new Map<string, Map<string, string>>();

  for (const dataset of datasets) {
    if (seenDatasetIds.has(dataset.datasetId)) {
      return {
        ok: false,
        code: "DUPLICATE_DATASET_ID",
        datasetId: dataset.datasetId,
      };
    }
    seenDatasetIds.add(dataset.datasetId);

    const schemaIds = new Set(
      dataset.schema.fields.map((field) => field.sourceSchemaColumnId),
    );
    const labels = new Map<string, string>();

    for (const column of dataset.columns) {
      if (labels.has(column.sourceSchemaColumnId)) {
        return {
          ok: false,
          code: "DUPLICATE_COLUMN_METADATA",
          datasetId: dataset.datasetId,
          sourceSchemaColumnId: column.sourceSchemaColumnId,
        };
      }

      if (!schemaIds.has(column.sourceSchemaColumnId)) {
        return {
          ok: false,
          code: "UNKNOWN_COLUMN_METADATA",
          datasetId: dataset.datasetId,
          sourceSchemaColumnId: column.sourceSchemaColumnId,
        };
      }

      const canonical = canonicalLabel(column.governedLabel);
      if (canonical.length === 0) {
        return {
          ok: false,
          code: "EMPTY_GOVERNED_LABEL",
          datasetId: dataset.datasetId,
          sourceSchemaColumnId: column.sourceSchemaColumnId,
        };
      }

      labels.set(column.sourceSchemaColumnId, canonical);
    }

    for (const field of dataset.schema.fields) {
      if (!labels.has(field.sourceSchemaColumnId)) {
        return {
          ok: false,
          code: "MISSING_COLUMN_METADATA",
          datasetId: dataset.datasetId,
          sourceSchemaColumnId: field.sourceSchemaColumnId,
        };
      }
    }

    labelsByDataset.set(dataset.datasetId, labels);
  }

  return labelsByDataset;
}

function isIdentifierField(field: SemanticSchemaFieldDraft): boolean {
  return field.fieldClass === "IDENTIFIER";
}

function evidence(
  left: SemanticSchemaFieldDraft,
  right: SemanticSchemaFieldDraft,
): RelationshipEvidenceCode[] {
  const result: RelationshipEvidenceCode[] = [
    "EXACT_GOVERNED_LABEL_MATCH",
    "LEFT_IDENTIFIER_CLASS",
    "RIGHT_IDENTIFIER_CLASS",
  ];
  if (left.recordKeyCandidate) result.push("LEFT_RECORD_KEY_CANDIDATE");
  if (right.recordKeyCandidate) result.push("RIGHT_RECORD_KEY_CANDIDATE");
  return result;
}

export function discoverRelationshipCandidates(
  datasets: readonly RelationshipDatasetInput[],
): DiscoverRelationshipCandidatesResult {
  const validated = validateDatasets(datasets);
  if (!(validated instanceof Map)) return validated;

  const candidates: RelationshipCandidate[] = [];

  for (let leftIndex = 0; leftIndex < datasets.length; leftIndex += 1) {
    const leftDataset = datasets[leftIndex];
    const leftLabels = validated.get(leftDataset.datasetId)!;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < datasets.length;
      rightIndex += 1
    ) {
      const rightDataset = datasets[rightIndex];
      const rightLabels = validated.get(rightDataset.datasetId)!;

      for (const leftField of leftDataset.schema.fields) {
        if (!isIdentifierField(leftField)) continue;

        for (const rightField of rightDataset.schema.fields) {
          if (!isIdentifierField(rightField)) continue;
          if (!leftField.recordKeyCandidate && !rightField.recordKeyCandidate) {
            continue;
          }

          if (
            leftLabels.get(leftField.sourceSchemaColumnId) !==
            rightLabels.get(rightField.sourceSchemaColumnId)
          ) {
            continue;
          }

          candidates.push({
            kind: "POTENTIAL_IDENTIFIER_JOIN",
            left: {
              datasetId: leftDataset.datasetId,
              sourceSchemaColumnId: leftField.sourceSchemaColumnId,
            },
            right: {
              datasetId: rightDataset.datasetId,
              sourceSchemaColumnId: rightField.sourceSchemaColumnId,
            },
            confidence: "MEDIUM",
            evidence: evidence(leftField, rightField),
          });
        }
      }
    }
  }

  return {
    ok: true,
    result: {
      discoveryVersion: RELATIONSHIP_DISCOVERY_VERSION,
      state:
        candidates.length === 0
          ? "NONE"
          : candidates.length === 1
            ? "ONE"
            : "MULTIPLE",
      candidates,
    },
  };
}
