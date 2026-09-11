// HR-0.5 §5 — minimal HR-only field-sensitivity abstraction.
//
// HR-0 discovery found no general data-classification system anywhere in
// this codebase — this is deliberately NOT an attempt to build one. It is
// also deliberately shipped with NO real field names: no hr_* table exists
// yet, and populating this module now with column names for a table that
// HR-0.5 is explicitly forbidden from creating would be exactly the kind
// of premature modelling this phase is scoped to avoid. HR-1 supplies its
// own HrFieldTierMap once hr_people's real columns are defined.

export type HrFieldTier = 'internal' | 'confidential' | 'restricted';

export type HrFieldTierMap = {
  internal: ReadonlySet<string>;
  confidential: ReadonlySet<string>;
  // 'restricted' has no explicit member set — see classifyField()'s
  // fail-closed default below. A future phase (HR-6) may introduce one if
  // an explicit restricted allowlist, rather than a catch-all default,
  // turns out to be the safer shape for that phase's own fields.
};

/**
 * Classifies a field name using a caller-supplied tier map. Fails CLOSED:
 * any field not explicitly listed under 'internal' or 'confidential' is
 * treated as 'restricted' — the most protected tier, never the least —
 * mirroring roleGte()'s fail-closed handling of an unrecognized role
 * (lib/session.ts) rather than defaulting an unclassified field to maximum
 * visibility.
 */
export function classifyField(tiers: HrFieldTierMap, field: string): HrFieldTier {
  if (tiers.internal.has(field)) return 'internal';
  if (tiers.confidential.has(field)) return 'confidential';
  return 'restricted';
}
