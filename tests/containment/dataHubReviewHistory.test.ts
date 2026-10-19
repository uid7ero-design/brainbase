import { describe, expect, it, vi } from "vitest";
import { compareReviewDecisions, decodeReviewComparison, decodeReviewHistory, parseReviewHistoryQuery } from "@/lib/data-hub/analysis/reviewHistory";
import type { AnalysisReviewDecisionInput } from "@/lib/data-hub/analysis/reviewDecisionInput";
import { historyEntry, historyFixture } from "../helpers/dataHubHistoryFixture";
const f = historyFixture(), pageQuery = { kind: "page" as const, datasetProfileRunId: "profile", expectedReviewRevision: 3, beforeRevision: null };
const compareQuery = { kind: "compare" as const, datasetProfileRunId: "profile", expectedReviewRevision: 3, baselineRevision: 1 };
const search = "historyVersion=v1&datasetProfileRunId=profile&expectedReviewRevision=3";
describe("closed, current-profile review history contracts", () => {
  it("accepts only canonical bounded query inputs", () => {
    expect(parseReviewHistoryQuery(new URLSearchParams(search), "page")).toEqual(pageQuery);
    expect(parseReviewHistoryQuery(new URLSearchParams(search + "&baselineRevision=1"), "compare")).toEqual(compareQuery);
  });
  it.each(["&organisationId=foreign", "&historyVersion=v1", "&beforeRevision=0", "&beforeRevision=4", "&beforeRevision=01", "&beforeRevision=1e0", "&beforeRevision=9007199254740992", "&baselineRevision=1"])("rejects invalid page query %s", extra => {
    expect(parseReviewHistoryQuery(new URLSearchParams(search + extra), "page")).toBeNull();
  });
  it.each([0, 3, 4, "01", "private"])("rejects invalid baseline %s", baseline => expect(parseReviewHistoryQuery(new URLSearchParams(search + `&baselineRevision=${baseline}`), "compare")).toBeNull());
  it("projects an owned page and a comparison without author/raw-value metadata", () => {
    const input = structuredClone(f.history); const output = decodeReviewHistory({ ok: true, history: input }, f.context, pageQuery);
    input.context.uploadId = "changed"; input.entries[0].semanticChoiceCount = 5;
    expect(output.context.uploadId).toBe("upload"); expect(output.entries[0].semanticChoiceCount).toBe(1);
    expect(decodeReviewComparison({ ok: true, comparison: f.comparison }, f.context, compareQuery, ["amount"])).toEqual(f.comparison);
  });
  it.each(["version", "scope", "revision", "order", "cursor", "count", "sum", "extra", "sparse", "getter"])("rejects malformed %s pages", kind => {
    const input = structuredClone(f.history);
    if (kind === "version") Object.assign(input, { historyVersion: "v2" });
    if (kind === "scope") input.context.organisationId = "foreign";
    if (kind === "revision") input.currentReviewRevision = 4;
    if (kind === "order") input.entries.reverse();
    if (kind === "cursor") input.nextBeforeRevision = 1;
    if (kind === "count") input.entries[0].semanticChoiceCount = -1;
    if (kind === "sum") input.entries[0].heldReviewCount = 2;
    if (kind === "extra") Object.assign(input.entries[0], { actor: "private" });
    if (kind === "sparse") delete input.entries[0];
    const getter = vi.fn(); if (kind === "getter") Object.defineProperty(input, "entries", { enumerable: true, get: getter });
    expect(() => decodeReviewHistory({ ok: true, history: input }, f.context, pageQuery)).toThrow("RESPONSE_INVALID"); expect(getter).not.toHaveBeenCalled();
  });
  it("requires a full descending page and its last revision as the next cursor", () => {
    const input = { ...f.history, currentReviewRevision: 12, entries: Array.from({ length: 10 }, (_, i) => historyEntry(12 - i)), nextBeforeRevision: 3 };
    expect(decodeReviewHistory({ ok: true, history: input }, f.context, { ...pageQuery, expectedReviewRevision: 12 }).nextBeforeRevision).toBe(3);
    input.nextBeforeRevision = 4;
    expect(() => decodeReviewHistory({ ok: true, history: input }, f.context, { ...pageQuery, expectedReviewRevision: 12 })).toThrow();
  });
  it.each(["field", "profile", "baseline", "role", "same", "duplicate", "scope", "decision", "extra"])("rejects malformed %s comparisons", kind => {
    const input = structuredClone(f.comparison);
    if (kind === "field") input.semanticChanges[0].sourceSchemaColumnId = "foreign";
    if (kind === "profile") input.context.datasetProfileRunId = "other";
    if (kind === "baseline") input.baselineRevision = 2;
    if (kind === "role") Object.assign(input.semanticChanges[0], { toRole: "SQL" });
    if (kind === "same") input.semanticChanges[0].toRole = input.semanticChanges[0].fromRole;
    if (kind === "duplicate") input.qualityChanges.push(input.qualityChanges[0]);
    if (kind === "scope") input.qualityChanges[0].scope = "DATASET";
    if (kind === "decision") input.qualityChanges[0].toDecision = "ACKNOWLEDGE";
    if (kind === "extra") Object.assign(input, { sourceValues: ["private"] });
    expect(() => decodeReviewComparison({ ok: true, comparison: input }, f.context, compareQuery, ["amount"])).toThrow();
  });
  it("compares opaque IDs by identity, preserves absence and omits unchanged decisions", () => {
    const a: AnalysisReviewDecisionInput = { reviewVersion: "v1", datasetProfileRunId: "profile", semanticChoices: [
      { sourceSchemaColumnId: "__proto__", role: "MEASURE" }, { sourceSchemaColumnId: "unchanged", role: "TEXT" }],
      qualityDecisions: [{ code: "COLUMN_ALL_NULL", scope: "COLUMN", sourceSchemaColumnId: "constructor", decision: "HOLD" }] };
    const b: AnalysisReviewDecisionInput = { ...a, semanticChoices: [{ sourceSchemaColumnId: "__proto__", role: "CURRENCY" }, { sourceSchemaColumnId: "unchanged", role: "TEXT" }], qualityDecisions: [] };
    expect(compareReviewDecisions(a, b)).toEqual({ semanticChanges: [{ sourceSchemaColumnId: "__proto__", fromRole: "MEASURE", toRole: "CURRENCY" }],
      qualityChanges: [{ code: "COLUMN_ALL_NULL", scope: "COLUMN", sourceSchemaColumnId: "constructor", fromDecision: "HOLD", toDecision: null }] });
  });
});
