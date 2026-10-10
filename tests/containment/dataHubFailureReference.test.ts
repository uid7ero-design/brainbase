import { describe, expect, it } from "vitest";
import { analysisFailureReference } from "@/lib/data-hub/analysis/failureReference";

describe("analysis failure display boundary", () => {
  it.each(["UNAUTHORIZED", "FORBIDDEN", "REVIEW_NOT_FOUND", "REVIEW_PROFILE_CHANGED",
    "QUALITY_HOLD", "COUNT_RESPONSE_INVALID", "COUNT_RESPONSE_MISMATCH", "RESPONSE_INVALID",
    "REVIEW_SAVE_FAILED", "PROFILE_COUNTS_INVALID", "PROFILE_PLAN_VERSION_UNSUPPORTED", "READINESS_CATALOG_INVALID"])("preserves recognized reference %s", code => {
    expect(analysisFailureReference(code)).toBe(code);
  });
  it.each([undefined, null, false, 503, {}, [], new Error("private-diagnostic"),
    "private-diagnostic", "UNKNOWN_FUTURE_CODE", "toString", "constructor", "__proto__",
    " FORBIDDEN", "FORBIDDEN ", "forbidden", "FORBIDDEN\nprivate-diagnostic"])("projects unknown diagnostics to a fixed reference: %s", code => {
    expect(analysisFailureReference(code)).toBe("REQUEST_FAILED");
  });
});
