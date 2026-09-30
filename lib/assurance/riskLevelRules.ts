// BrainBase Assurance — risk-level configuration rules. ZERO imports
// (client-safe): shared by the Settings UI and lib/assurance/riskLevels.ts.
//
// The database is the authority (A0.1C: UNIQUE (organisation_id, code),
// UNIQUE (organisation_id, rank), rank >= 0, non-blank code/name,
// description NULL or non-blank). These rules add the product conventions
// on top: a stable upper-case code, and bounded lengths.

/** How many of the highest-ranked ACTIVE levels the dashboard treats as serious. */
export const SERIOUS_ACTIVE_LEVEL_COUNT = 2;

export const RISK_CODE_MAX = 30;
export const RISK_NAME_MAX = 100;
export const RISK_DESCRIPTION_MAX = 500;
export const RISK_RANK_MAX = 100000;

/** Upper-case letter first, then upper-case letters, digits or underscores. */
export const RISK_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** Trims and upper-cases a proposed code. Pure; never throws. */
export function normaliseRiskCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** Null when the (already normalised) code is acceptable, else a user-facing reason. */
export function riskCodeProblem(code: string): string | null {
  if (!code) return 'Code is required.';
  if (code.length > RISK_CODE_MAX) return `Code must be at most ${RISK_CODE_MAX} characters.`;
  if (!RISK_CODE_PATTERN.test(code)) return 'Code must start with a letter and use only letters, numbers and underscores.';
  return null;
}

export const REQUIRES_VERIFICATION_HELP =
  'Recorded for policy/configuration purposes. This setting does not currently enforce verification automatically.';

export const SERIOUS_RULE_TEXT =
  'The two highest-ranked active risk levels are currently treated as serious on the Assurance dashboard.';

/** Response `details.code` when a change would alter the serious set and needs explicit confirmation. */
export const SERIOUS_CHANGE_CONFIRMATION = 'SERIOUS_CHANGE_CONFIRMATION';

export type SeriousLevel = { code: string; name: string };

export type SeriousChangeDetails = {
  code: typeof SERIOUS_CHANGE_CONFIRMATION;
  before: SeriousLevel[];
  after: SeriousLevel[];
  /** Echo this back as `acknowledgeSerious` to confirm exactly this outcome. */
  acknowledge: string[];
};
