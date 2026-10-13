import { describe, expect, it } from "vitest";
import { validateProfileCountBundleInput, MAX_PROFILE_COUNT_BUNDLE_REQUESTS } from "@/lib/data-hub/analysis";

const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
const envelope = (requests: unknown[] = [rows]) => ({ bundleVersion: "v1", expectedReviewRevision: 3, requests });

describe("bounded profile bundle admission", () => {
  it("copies frozen JSON-shaped metadata and list membership without mutation", () => {
    const requests = Object.freeze([rows]);
    const input = Object.freeze({ bundleVersion: "v1", expectedReviewRevision: 3, requests });
    const result = validateProfileCountBundleInput(input);
    expect(result).toEqual({ ok: true, bundle: input });
    if (!result.ok) throw new Error(result.code);
    expect(result.bundle).not.toBe(input); expect(result.bundle.requests).not.toBe(requests);
    expect(result.bundle.requests[0]).not.toBe(rows); // Capability validation still belongs to the planner.
  });
  it("retains admission when the source list is replaced, reordered or enlarged", () => {
    const input = envelope([rows, null]); const result = validateProfileCountBundleInput(input);
    input.requests.reverse(); input.requests.push(...Array(30).fill(rows)); input.requests = [];
    expect(result).toEqual({ ok: true, bundle: envelope([rows, undefined]) });
  });
  it.each([1, MAX_PROFILE_COUNT_BUNDLE_REQUESTS])("accepts supported list size %s", length => {
    expect(validateProfileCountBundleInput(envelope(Array(length).fill(rows)))).toMatchObject({ ok: true });
  });
  it.each([null, [], {}, { ...envelope(), extra: true }, { ...envelope(), bundleVersion: "v2" },
    { ...envelope(), requests: [] }, { ...envelope(), requests: Array(21).fill(rows) },
    { ...envelope(), requests: "rows" }, { ...envelope(), expectedReviewRevision: "3" },
    { ...envelope(), expectedReviewRevision: 0 }, { ...envelope(), expectedReviewRevision: 1.5 },
    { ...envelope(), expectedReviewRevision: Infinity }, { ...envelope(), expectedReviewRevision: Number.MAX_SAFE_INTEGER + 1 },
    Object.create(envelope())])("rejects invalid data envelopes %#", input => {
    expect(validateProfileCountBundleInput(input)).toEqual({ ok: false, code: "PROFILE_BUNDLE_INVALID" });
  });
  it.each(["bundleVersion", "expectedReviewRevision", "requests"])("rejects %s accessors without invoking them", key => {
    const input = envelope();
    Object.defineProperty(input, key, { enumerable: true, get() { throw new Error("must not execute envelope getter"); } });
    expect(validateProfileCountBundleInput(input)).toEqual({ ok: false, code: "PROFILE_BUNDLE_INVALID" });
  });
  it("rejects symbol and non-enumerable envelope extras", () => {
    for (const key of [Symbol("extra"), "hidden"]) {
      const input = envelope(); Object.defineProperty(input, key, { value: true });
      expect(validateProfileCountBundleInput(input)).toEqual({ ok: false, code: "PROFILE_BUNDLE_INVALID" });
    }
  });
  it("rejects hidden required envelope fields", () => {
    const input = envelope(); Object.defineProperty(input, "requests", { enumerable: false });
    expect(validateProfileCountBundleInput(input)).toEqual({ ok: false, code: "PROFILE_BUNDLE_INVALID" });
  });
  it("copies index data without invoking a supplied iterator", () => {
    const requests = [rows]; requests[Symbol.iterator] = () => { throw new Error("must not invoke iterator"); };
    expect(validateProfileCountBundleInput(envelope(requests))).toEqual({ ok: true, bundle: envelope() });
  });
  it("rejects accessor entries without invoking them", () => {
    const requests = [rows]; Object.defineProperty(requests, 0, { get() { throw new Error("must not execute entry getter"); } });
    expect(validateProfileCountBundleInput(envelope(requests))).toEqual({ ok: false, code: "PROFILE_BUNDLE_INVALID" });
  });
  it("preserves holes as invalid intents and ignores inherited entries", () => {
    const requests = new Array(2); requests[0] = rows;
    Object.setPrototypeOf(requests, { 1: rows });
    expect(validateProfileCountBundleInput(envelope(requests))).toEqual({ ok: true, bundle: envelope([rows, undefined]) });
  });
});
