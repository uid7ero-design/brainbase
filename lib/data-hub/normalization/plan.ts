// Data Hub 6.2D4C-B2A — normalization plan contract.
//
// Pure: takes an unknown profile_document plus the exact governed
// source-schema column IDs for one worksheet, and returns either a ready
// normalization plan or a list of BLOCKING findings. Never touches
// WorksheetMappingProfile.active_profile_version_id or any other "current
// pointer" concept — the caller is solely responsible for having already
// resolved the correct, PINNED WorksheetMappingProfileVersion (exactly the
// D4B pinned-profile discipline: resolveStagingEligibility for a new run,
// resolvePinnedStagingRunContext for an existing one).

import { parseProfileDocument } from "../schemaProfiles/profileDocument";
import type { NormalizationFinding, NormalizationPlanResult } from "./contracts";
import { blockingFinding } from "./contracts";

/**
 * @param profileDocument the exact WorksheetMappingProfileVersion.profile_document already pinned to the run
 * @param governedColumnIds the exact SourceSchemaColumn.id set for the worksheet this profile version belongs to (order-independent)
 */
export function buildNormalizationPlan(profileDocument: unknown, governedColumnIds: readonly string[]): NormalizationPlanResult {
  const parsed = parseProfileDocument(profileDocument);
  if (!parsed.ok) {
    return { ok: false, findings: [blockingFinding("PROFILE_DOCUMENT_INVALID")] };
  }

  if (parsed.document.documentVersion === 1) {
    return { ok: false, findings: [blockingFinding("NORMALIZATION_INELIGIBLE_V1")] };
  }

  const { columnRules } = parsed.document;
  // D4C-A's own parser already guarantees columnRules cannot contain a
  // duplicate sourceSchemaColumnId — this plan builder never re-derives
  // that guarantee, it only relies on it.
  const rulesByColumnId = new Map(columnRules.map((rule) => [rule.sourceSchemaColumnId, rule] as const));

  const findings: NormalizationFinding[] = [];
  const governedIdSet = new Set(governedColumnIds);

  for (const columnId of governedColumnIds) {
    if (!rulesByColumnId.has(columnId)) {
      findings.push(blockingFinding("MISSING_GOVERNED_RULE", columnId));
    }
  }
  for (const rule of columnRules) {
    if (!governedIdSet.has(rule.sourceSchemaColumnId)) {
      findings.push(blockingFinding("UNKNOWN_RULE_COLUMN", rule.sourceSchemaColumnId, rule.valueKind));
    }
  }

  if (findings.length > 0) {
    return { ok: false, findings };
  }

  return { ok: true, plan: { rulesByColumnId } };
}
