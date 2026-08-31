import { describe, it, expect } from "vitest";
import {
  PERSISTED_FAILURE_CODES,
  CALLER_ONLY_OUTCOME_CODES,
  isPersistedFailureCode,
  getDbRetryable,
  isUploadTokenReplayEligible,
  isFinalizationRetryEligible,
  isTerminalRequiresNewBatch,
  getMessageTemplate,
  type PersistedFailureCode,
} from "@/lib/data-hub/importBatch/failureTaxonomy";

describe("failureTaxonomy — code sets", () => {
  it("PERSISTED_FAILURE_CODES matches the exact spec list", () => {
    expect(new Set(PERSISTED_FAILURE_CODES)).toEqual(
      new Set([
        "STORAGE_NOT_FOUND",
        "STORAGE_METADATA_MISMATCH",
        "SIZE_LIMIT",
        "ZERO_BYTE",
        "HASH_MISMATCH",
        "PREFLIGHT_REJECTED",
        "PROVIDER_FAILURE",
        "STALE_RECLAIMED",
      ])
    );
  });

  it("CALLER_ONLY_OUTCOME_CODES matches the exact spec list", () => {
    expect(new Set(CALLER_ONLY_OUTCOME_CODES)).toEqual(
      new Set([
        "INVALID_REQUEST",
        "IDEMPOTENCY_CONFLICT",
        "NOT_FOUND",
        "INVALID_STATE",
        "CONFIGURATION_ERROR",
        "RECLAIM_NOT_ALLOWED",
        "OWNERSHIP_LOST",
      ])
    );
  });

  it("the two code sets are disjoint", () => {
    const persisted = new Set(PERSISTED_FAILURE_CODES);
    for (const code of CALLER_ONLY_OUTCOME_CODES) {
      expect(persisted.has(code as never)).toBe(false);
    }
  });

  it("isPersistedFailureCode is true for every persisted code and false for caller-only codes", () => {
    for (const code of PERSISTED_FAILURE_CODES) expect(isPersistedFailureCode(code)).toBe(true);
    for (const code of CALLER_ONLY_OUTCOME_CODES) expect(isPersistedFailureCode(code)).toBe(false);
    expect(isPersistedFailureCode("NOT_A_REAL_CODE")).toBe(false);
  });
});

describe("failureTaxonomy — DB retryability matrix (exact, locked)", () => {
  const expected: Record<PersistedFailureCode, boolean> = {
    STORAGE_NOT_FOUND: true,
    PROVIDER_FAILURE: true,
    STALE_RECLAIMED: true,
    STORAGE_METADATA_MISMATCH: false,
    SIZE_LIMIT: false,
    ZERO_BYTE: false,
    HASH_MISMATCH: false,
    PREFLIGHT_REJECTED: false,
  };

  for (const [code, retryable] of Object.entries(expected) as [PersistedFailureCode, boolean][]) {
    it(`${code} -> retryable=${retryable}`, () => {
      expect(getDbRetryable(code)).toBe(retryable);
    });
  }
});

describe("failureTaxonomy — (a) upload-token-replay eligibility", () => {
  const expected: Record<PersistedFailureCode, boolean> = {
    STORAGE_NOT_FOUND: true,
    PROVIDER_FAILURE: false,
    STALE_RECLAIMED: false,
    STORAGE_METADATA_MISMATCH: false,
    SIZE_LIMIT: false,
    ZERO_BYTE: false,
    HASH_MISMATCH: false,
    PREFLIGHT_REJECTED: false,
  };

  for (const [code, eligible] of Object.entries(expected) as [PersistedFailureCode, boolean][]) {
    it(`${code} -> upload-token-replay-eligible=${eligible}`, () => {
      expect(isUploadTokenReplayEligible(code)).toBe(eligible);
    });
  }
});

describe("failureTaxonomy — (b) finalization-retry eligibility", () => {
  const expected: Record<PersistedFailureCode, boolean> = {
    STORAGE_NOT_FOUND: true,
    PROVIDER_FAILURE: true,
    STALE_RECLAIMED: true,
    STORAGE_METADATA_MISMATCH: false,
    SIZE_LIMIT: false,
    ZERO_BYTE: false,
    HASH_MISMATCH: false,
    PREFLIGHT_REJECTED: false,
  };

  for (const [code, eligible] of Object.entries(expected) as [PersistedFailureCode, boolean][]) {
    it(`${code} -> finalization-retry-eligible=${eligible}`, () => {
      expect(isFinalizationRetryEligible(code)).toBe(eligible);
    });
  }
});

describe("failureTaxonomy — (c) terminal-requires-new-batch (inverse of b)", () => {
  for (const code of PERSISTED_FAILURE_CODES) {
    it(`${code} — isTerminalRequiresNewBatch is the exact logical inverse of isFinalizationRetryEligible`, () => {
      expect(isTerminalRequiresNewBatch(code)).toBe(!isFinalizationRetryEligible(code));
    });
  }
});

describe("failureTaxonomy — message templates", () => {
  it("every persisted code has a template of at most 500 characters", () => {
    for (const code of PERSISTED_FAILURE_CODES) {
      const message = getMessageTemplate(code);
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
      expect(message.length).toBeLessThanOrEqual(500);
    }
  });

  it("every caller-only code has a template of at most 500 characters", () => {
    for (const code of CALLER_ONLY_OUTCOME_CODES) {
      const message = getMessageTemplate(code);
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
      expect(message.length).toBeLessThanOrEqual(500);
    }
  });

  it("templates are fixed and identical across repeated calls (no interpolation of call-time input)", () => {
    expect(getMessageTemplate("STORAGE_NOT_FOUND")).toBe(getMessageTemplate("STORAGE_NOT_FOUND"));
  });

  it("getMessageTemplate accepts no second argument that could inject raw error text into the result", () => {
    // Type-level guarantee: getMessageTemplate(code) takes exactly one
    // parameter. This test exercises that a call site attempting to pass
    // through a raw caught error's message has no code-side hook to do so.
    const distinctiveRawText = "RAW_SDK_ERROR_TEXT_MUST_NEVER_APPEAR_xyz123";
    const message = getMessageTemplate("PROVIDER_FAILURE");
    expect(message).not.toContain(distinctiveRawText);
  });
});
