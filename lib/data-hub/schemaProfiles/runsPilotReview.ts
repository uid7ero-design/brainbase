// Draft collection only. This module never activates or persists a profile.
// Suggestions are explicit review choices, never transformation authority.
import { parseProfileDocument, type ProfileDocumentV2, type ColumnRuleV2 } from "./profileDocument";
import { buildNormalizationPlan } from "../normalization/plan";

export type Representation = "IDENTIFIER_TEXT" | "IDENTIFIER_NUMBER" | "TEXT" | "WHOLE_NUMBER" |
  "AU_DATE_TEXT" | "ISO_DATE_TEXT" | "EXCEL_DATE" | "DECIMAL_NUMBER" | "CLOCK_DURATION" | "EXCEL_DAY_FRACTION";
export const REPRESENTATION_LABELS: Record<Representation, string> = {
  IDENTIFIER_TEXT: "Identifier stored as text (keep leading zeros)", IDENTIFIER_NUMBER: "Identifier stored as a number — needs review",
  TEXT: "Text or a list kept together", WHOLE_NUMBER: "Whole-number count",
  AU_DATE_TEXT: "Date text: 24/10/2026", ISO_DATE_TEXT: "Date text: 2026-10-24",
  EXCEL_DATE: "Excel date cell", DECIMAL_NUMBER: "Number, including decimals",
  CLOCK_DURATION: "Elapsed time written as 01:30:00", EXCEL_DAY_FRACTION: "Excel fraction of a day (0.5 = 12 hours)",
};
export const UNIT_LABELS = {
  NONE: "No physical unit", t: "Tonnes", kg: "Kilograms", km: "Kilometres", m: "Metres",
  d: "Days (24 hours)", h: "Hours", min: "Minutes", s: "Seconds",
  "bins/h": "Bins per hour", "t/h": "Tonnes per hour", "kg/h": "Kilograms per hour",
} as const;
export type ReviewUnit = keyof typeof UNIT_LABELS;
type FieldSpec = { id: string; header: string; ordinal: number; sensitivity: string;
  representations: Representation[]; units: ReviewUnit[]; suggestedRepresentation: Representation;
  suggestedUnit: ReviewUnit | null; count: boolean };

export const RUNS_REVIEW_TEMPLATE = "onkaparinga-runs-review-v1";
// This small, public-label inventory avoids shipping the other 274 governed
// columns to the browser. A behavioral test checks it against the source manifest.
const HEADERS = ["Id", "Date", "Run", "Vehicles", "Service Type", "Drivers", "Loads", "Collections Booked",
  "Collections Performed", "Not Presented", "Contaminated", "Total Weight", "Ave Bin Weight", "Bins Per Hour",
  "Weight Per Hour", "Travel Time Hrs", "Collection Time Hrs", "Duration", "Travel Distance Kms", "Collection Distance Kms", "Total Distance"];

// Categories follow the reviewed 21-column inventory, not heuristic header parsing.
export const RUNS_REVIEW_FIELDS: readonly FieldSpec[] = HEADERS.map((header, ordinal) => {
  let representations: Representation[] = ["DECIMAL_NUMBER"];
  let units: ReviewUnit[] = ["NONE"];
  let suggestedUnit: ReviewUnit | null = "NONE";
  if ([0, 2].includes(ordinal)) representations = ["IDENTIFIER_TEXT", "IDENTIFIER_NUMBER"];
  else if (ordinal === 1) representations = ["AU_DATE_TEXT", "ISO_DATE_TEXT", "EXCEL_DATE"];
  else if ([3, 5].includes(ordinal)) representations = ["TEXT", "WHOLE_NUMBER"];
  else if (ordinal === 4) representations = ["TEXT"];
  else if (ordinal >= 6 && ordinal <= 10) representations = ["WHOLE_NUMBER"];
  else if ([11, 12].includes(ordinal)) { units = ["t", "kg"]; suggestedUnit = ordinal === 11 ? "t" : null; }
  else if (ordinal === 13) { units = ["bins/h"]; suggestedUnit = "bins/h"; }
  else if (ordinal === 14) { units = ["t/h", "kg/h"]; suggestedUnit = "t/h"; }
  else if (ordinal >= 15 && ordinal <= 17) {
    representations = ["DECIMAL_NUMBER", "EXCEL_DAY_FRACTION", "CLOCK_DURATION"];
    units = ["h", "d", "min", "s"]; suggestedUnit = ordinal === 17 ? "d" : "h";
  } else if (ordinal >= 18) { units = ["km", "m"]; suggestedUnit = null; }
  // Template references deliberately cannot stand in for governed schema IDs.
  return { id: `runs-field-${String(ordinal).padStart(2, "0")}`, header,
    ordinal, sensitivity: ordinal === 5 ? "PERSONALLY_IDENTIFIABLE" : "CONFIDENTIAL", representations, units,
    suggestedRepresentation: ordinal === 1 ? "ISO_DATE_TEXT" : representations[0], suggestedUnit,
    count: ordinal >= 6 && ordinal <= 10 };
});

export type FieldReview = { fieldKey: string; representation: Representation | null; unit: ReviewUnit | null;
  negativePolicy: "ALLOW" | "FORBID" | null; confirmed: boolean };
export type RunsPilotReview = { reviewVersion: 1; template: typeof RUNS_REVIEW_TEMPLATE;
  activationAllowed: false; missingPolicy: "NULL_ONLY" | "ADDITIONAL_MARKERS" | null; fields: FieldReview[] };

export function createRunsPilotReview(): RunsPilotReview {
  return { reviewVersion: 1, template: RUNS_REVIEW_TEMPLATE, activationAllowed: false,
    missingPolicy: null, fields: RUNS_REVIEW_FIELDS.map(f => ({ fieldKey: f.id, representation: f.suggestedRepresentation,
      unit: f.suggestedUnit, negativePolicy: null, confirmed: false })) };
}

export type ReviewBlocker = { fieldKey?: string; code: "DAY_UNIT_NEEDS_SUPPORT" | "RATE_UNIT_NEEDS_SUPPORT" |
  "CLOCK_DURATION_NEEDS_SUPPORT" | "NUMERIC_IDENTIFIER_NEEDS_DECISION" | "NONNEGATIVE_COUNTS_NEED_RULE" |
  "MISSING_MARKERS_NEED_RULE" | "SOURCE_REPRESENTATION_UNIT_MISMATCH" | "PROFILE_RULE_UNSUPPORTED" };
export const BLOCKER_COPY: Record<ReviewBlocker["code"], string> = {
  DAY_UNIT_NEEDS_SUPPORT: "Day-based quantities need an explicit day conversion before preparation.",
  RATE_UNIT_NEEDS_SUPPORT: "Per-hour quantities need rate-unit support before preparation.",
  CLOCK_DURATION_NEEDS_SUPPORT: "Elapsed clock text needs a duration reader before preparation.",
  NUMERIC_IDENTIFIER_NEEDS_DECISION: "Numeric identifiers may already have lost leading zeros; resolve this with the report owner.",
  NONNEGATIVE_COUNTS_NEED_RULE: "Rejecting negative counts needs an explicit validation rule before preparation.",
  MISSING_MARKERS_NEED_RULE: "Additional missing-value markers need explicit handling before preparation.",
  SOURCE_REPRESENTATION_UNIT_MISMATCH: "An Excel day fraction must use days as its source unit.",
  PROFILE_RULE_UNSUPPORTED: "This choice needs supported mapping rules before preparation.",
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
export function fieldReviewComplete(field: FieldReview): boolean {
  return field.representation !== null && field.unit !== null &&
    (field.representation !== "WHOLE_NUMBER" || field.negativePolicy !== null);
}

/** Closed, value-free review packet. Success validates a draft, never authority to activate. */
export function evaluateRunsPilotReview(raw: unknown):
  { ok: false; activationAllowed: false; code: "INVALID_REVIEW" } |
  { ok: true; activationAllowed: false; review: RunsPilotReview; confirmedCount: number; reviewComplete: boolean; blockers: ReviewBlocker[] } {
  const invalid = { ok: false, activationAllowed: false, code: "INVALID_REVIEW" } as const;
  if (!object(raw) || !exactKeys(raw, ["reviewVersion", "template", "activationAllowed", "missingPolicy", "fields"]) ||
    raw.reviewVersion !== 1 || raw.template !== RUNS_REVIEW_TEMPLATE || raw.activationAllowed !== false ||
    ![null, "NULL_ONLY", "ADDITIONAL_MARKERS"].includes(raw.missingPolicy as null | string) ||
    !Array.isArray(raw.fields) || raw.fields.length !== RUNS_REVIEW_FIELDS.length) return invalid;
  const seen = new Set<string>();
  const fields: FieldReview[] = [];
  for (const item of raw.fields) {
    if (!object(item) || !exactKeys(item, ["fieldKey", "representation", "unit", "negativePolicy", "confirmed"])) return invalid;
    const spec = RUNS_REVIEW_FIELDS.find(f => f.id === item.fieldKey);
    if (!spec || seen.has(spec.id) || typeof item.confirmed !== "boolean" ||
      (item.representation !== null && !spec.representations.includes(item.representation as Representation)) ||
      (item.unit !== null && !spec.units.includes(item.unit as ReviewUnit)) ||
      ![null, "ALLOW", "FORBID"].includes(item.negativePolicy as null | string) ||
      (item.representation !== "WHOLE_NUMBER" && item.negativePolicy !== null)) return invalid;
    seen.add(spec.id);
    fields.push({ fieldKey: spec.id, representation: item.representation as Representation | null,
      unit: item.unit as ReviewUnit | null, negativePolicy: item.negativePolicy as FieldReview["negativePolicy"], confirmed: item.confirmed });
  }
  fields.sort((a, b) => RUNS_REVIEW_FIELDS.findIndex(f => f.id === a.fieldKey) - RUNS_REVIEW_FIELDS.findIndex(f => f.id === b.fieldKey));
  const review: RunsPilotReview = { reviewVersion: 1, template: RUNS_REVIEW_TEMPLATE,
    activationAllowed: false, missingPolicy: raw.missingPolicy as RunsPilotReview["missingPolicy"], fields };
  const blockers: ReviewBlocker[] = [];
  if (review.missingPolicy === "ADDITIONAL_MARKERS") blockers.push({ code: "MISSING_MARKERS_NEED_RULE" });
  for (const field of fields) {
    if (!field.confirmed || !fieldReviewComplete(field)) continue;
    const add = (code: ReviewBlocker["code"]) => blockers.push({ fieldKey: field.fieldKey, code });
    if (field.representation === "CLOCK_DURATION") add("CLOCK_DURATION_NEEDS_SUPPORT");
    if (field.representation === "IDENTIFIER_NUMBER") add("NUMERIC_IDENTIFIER_NEEDS_DECISION");
    if (field.representation === "EXCEL_DAY_FRACTION" && field.unit !== "d") add("SOURCE_REPRESENTATION_UNIT_MISMATCH");
    if (blockers.some(b => b.fieldKey === field.fieldKey)) continue;
    const ordinal = RUNS_REVIEW_FIELDS.find(f => f.id === field.fieldKey)!.ordinal;
    const valueKind = field.representation === "IDENTIFIER_TEXT" ? "IDENTIFIER" :
      field.representation === "TEXT" ? "STRING" : field.representation === "WHOLE_NUMBER" ? "INTEGER" :
      ["AU_DATE_TEXT", "ISO_DATE_TEXT", "EXCEL_DATE"].includes(field.representation!) ? "DATE" :
      ordinal >= 15 && ordinal <= 17 ? "DURATION" : "DECIMAL";
    const rule = { sourceSchemaColumnId: field.fieldKey, valueKind,
      ...(valueKind === "IDENTIFIER" ? { preserveLeadingZeros: true } : {}),
      ...(valueKind === "DATE" ? { datePolicy: field.representation === "AU_DATE_TEXT" ? "AU_DD_MM_YYYY" : "ISO_8601" } : {}),
      ...(field.negativePolicy === "FORBID" ? { minimum: "0" } : {}),
      ...(field.unit !== "NONE" ? { sourceUnit: field.unit, normalizedUnit: field.unit } : {}) };
    const parsed = parseProfileDocument({ documentVersion: 2, schemaStatus: "ACTIVE", headerRowOneBased: 3, columnRules: [rule] });
    if (!parsed.ok) add("PROFILE_RULE_UNSUPPORTED");
  }
  const confirmedCount = fields.filter(f => f.confirmed && fieldReviewComplete(f)).length;
  return { ok: true, activationAllowed: false, review, confirmedCount,
    reviewComplete: confirmedCount === RUNS_REVIEW_FIELDS.length && review.missingPolicy !== null, blockers };
}

export type RunsGovernedColumn = { id: string; ordinal: number; sourceHeader: string; sensitivityClass: string };
/** Called with server-resolved columns only; a review never supplies governed IDs. */
export function buildRunsProfile(raw: unknown, columns: readonly RunsGovernedColumn[]):
  { ok: true; review: RunsPilotReview; document: ProfileDocumentV2 } | { ok: false } {
  const evaluated = evaluateRunsPilotReview(raw);
  if (!evaluated.ok || !evaluated.reviewComplete || evaluated.blockers.length || columns.length !== 21 ||
    new Set(columns.map(c => c.id)).size !== 21 || new Set(columns.map(c => c.ordinal)).size !== 21 ||
    columns.some(c => { const spec = RUNS_REVIEW_FIELDS[c.ordinal]; return !spec || !c.id ||
      c.sourceHeader !== spec.header || c.sensitivityClass !== spec.sensitivity; })) return { ok: false };
  const columnRules: ColumnRuleV2[] = evaluated.review.fields.map((field, ordinal) => {
    const valueKind = field.representation === "IDENTIFIER_TEXT" ? "IDENTIFIER" : field.representation === "TEXT" ? "STRING" :
      field.representation === "WHOLE_NUMBER" ? "INTEGER" : ["AU_DATE_TEXT", "ISO_DATE_TEXT", "EXCEL_DATE"].includes(field.representation!) ? "DATE" :
      ordinal >= 15 && ordinal <= 17 ? "DURATION" : "DECIMAL";
    return { sourceSchemaColumnId: columns.find(c => c.ordinal === ordinal)!.id, valueKind,
      ...(valueKind === "IDENTIFIER" ? { preserveLeadingZeros: true as const } : {}),
      ...(valueKind === "DATE" ? { datePolicy: field.representation === "AU_DATE_TEXT" ? "AU_DD_MM_YYYY" as const : "ISO_8601" as const } : {}),
      ...(field.negativePolicy === "FORBID" ? { minimum: "0" as const } : {}),
      ...(field.unit !== "NONE" ? { sourceUnit: field.unit!, normalizedUnit: field.unit! } : {}) } as ColumnRuleV2;
  });
  const parsed = parseProfileDocument({ documentVersion: 2, schemaStatus: "ACTIVE", headerRowOneBased: 3, columnRules });
  if (!parsed.ok || parsed.document.documentVersion !== 2 || !buildNormalizationPlan(parsed.document, columns.map(c => c.id)).ok) return { ok: false };
  return { ok: true, review: evaluated.review, document: parsed.document };
}
