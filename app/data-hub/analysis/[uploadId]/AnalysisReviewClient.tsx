"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { PlanAnalysisReviewResult } from "@/lib/data-hub/analysisExecution/planAnalysisReview";
import type { LoadAnalysisReviewResult } from "@/lib/data-hub/analysisExecution/loadAnalysisReview";
import type { AnalyzeReviewedUploadCountResult } from "@/lib/data-hub/analysisExecution/analyzeReviewedUploadCount";
import type { SemanticRole } from "@/lib/data-hub/semanticInference/contracts";
import type { DataQualityReviewDecision } from "@/lib/data-hub/dataQuality/reviewResolution";

type Plan = Extract<PlanAnalysisReviewResult, { ok: true }>;
type Review = Extract<LoadAnalysisReviewResult, { ok: true }>;
type Count = Extract<AnalyzeReviewedUploadCountResult, { ok: true }>;
const words = (value: string) => value.toLowerCase().replaceAll("_", " ");
const recoveryMessage = (code: string) => {
  if (["PROFILE_NOT_COMPLETE", "PROFILER_VERSION_UNSUPPORTED"].includes(code)) return "This worksheet needs a completed, supported profile before analysis is available.";
  if (["REVIEW_PROFILE_CHANGED", "PROFILE_LINEAGE_MISMATCH", "DATASET_CONTEXT_MISMATCH"].includes(code)) return "The dataset changed. Reload its current profile and review before continuing.";
  if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)) return "This worksheet is unavailable to your current session. Sign in with an authorized account or return to imports.";
  if (code === "QUALITY_HOLD") return "The latest review has a quality hold. Reload it and review the required corrections before counting.";
  return "This step could not be completed. If saving failed, reload before trying again; the previous save may have completed.";
};

export default function AnalysisReviewClient({ uploadId }: { uploadId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [roles, setRoles] = useState<Record<string, SemanticRole>>( {});
  const [decisions, setDecisions] = useState<Record<number, DataQualityReviewDecision>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [count, setCount] = useState<Count | null>(null);
  const [measure, setMeasure] = useState("");
  const [saveNeedsReload, setSaveNeedsReload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const endpoint = `/api/data-hub/worksheets/${encodeURIComponent(uploadId)}`;

  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(endpoint + path, { method: body === undefined ? "GET" : "POST",
      cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error(typeof data.code === "string" ? data.code : "REQUEST_FAILED");
    return data as T;
  }
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); } catch (failure) {
      setError(failure instanceof Error ? failure.message : "REQUEST_FAILED");
    } finally { pending.current = false; setBusy(false); }
  }
  function envelope(includeQuality: boolean) {
    return { reviewVersion: "v1", datasetProfileRunId: plan!.datasetProfileRunId,
      semanticChoices: Object.entries(roles).map(([sourceSchemaColumnId, role]) => ({ sourceSchemaColumnId, role })),
      qualityDecisions: includeQuality ? plan!.quality!.items.map((item, index) => ({ code: item.code, scope: item.scope,
        ...(item.sourceSchemaColumnId ? { sourceSchemaColumnId: item.sourceSchemaColumnId } : {}), decision: decisions[index] })) : [] };
  }
  const required = plan?.clarification.columns.filter(column => column.resolutionState === "CLARIFICATION_REQUIRED") ?? [];
  const rolesComplete = required.every(column => column.candidateRoles.includes(roles[column.sourceSchemaColumnId]));
  const qualityComplete = !!plan?.quality && plan.quality.items.every((_, index) => !!decisions[index]);
  const held = review?.quality.snapshot.state === "HOLD_FOR_REMEDIATION";
  const matchingProfile = !!plan && review?.schema.context.datasetProfileRunId === plan.datasetProfileRunId;
  const measures = matchingProfile ? review.schema.snapshot.fields.filter(field => field.fieldClass === "MEASURE") : [];
  const fieldLabel = (id: string) => plan?.fieldLabels.find(field => field.sourceSchemaColumnId === id)?.label ?? "Field";
  function restoredRoles(currentPlan: Plan, saved: Review) {
    if (saved.schema.context.datasetProfileRunId !== currentPlan.datasetProfileRunId) return {};
    const next: Record<string, SemanticRole> = {};
    for (const column of currentPlan.clarification.columns) {
      const field = saved.schema.snapshot.fields.find(field => field.sourceSchemaColumnId === column.sourceSchemaColumnId);
      if (column.resolutionState === "CLARIFICATION_REQUIRED" && field?.resolutionSource === "CLARIFIED_CHOICE" &&
          column.candidateRoles.includes(field.semanticRole)) next[column.sourceSchemaColumnId] = field.semanticRole;
    }
    return next;
  }

  return <main style={{ maxWidth: 800, margin: "24px auto", padding: 24 }}>
    <Link href="/data-hub/import">Back to Data Hub imports</Link>
    <h1>Review dataset and count</h1>
    <p>Review field meanings and data quality before calculating counts from the current dataset profile.</p>
    <p>Worksheet: {uploadId}</p>
    <button disabled={busy} onClick={() => void run(async () => {
      setPlan(null); setRoles({}); setDecisions({}); setReview(null); setCount(null); setMeasure("");
      const currentPlan = await request<Plan>("/analysis-review/plan"); setPlan(currentPlan);
      try {
        const saved = await request<Review>("/analysis-review");
        setReview(saved); setRoles(restoredRoles(currentPlan, saved));
      }
      catch (failure) { if (!(failure instanceof Error) || failure.message !== "REVIEW_NOT_FOUND") throw failure; }
      setSaveNeedsReload(false);
    })}>Load current review</button>
    <p role="status" aria-live="polite">{busy ? "Working…" : ""}</p>
    {error ? <div role="alert"><p>{recoveryMessage(error)}</p><p>Reference: {error}</p></div> : null}
    {plan ? <section aria-label="Dataset review">
      <h2>Field meanings</h2>
      <p>Only choices offered by the current profile can be selected. Fields without a candidate need a new profile or corrected data.</p>
      {plan.clarification.columns.map((column, index) => <div key={column.sourceSchemaColumnId} style={{ marginBottom: 16 }}>
        <label htmlFor={`field-${index}`}>{fieldLabel(column.sourceSchemaColumnId)} (field {index + 1})</label>
        {column.resolutionState === "RESOLVED" ? <p>{words(column.candidateRoles[0])} — resolved by the profile</p> : <>
          <p>{column.reasons.map(words).join(", ")}</p>
          <select id={`field-${index}`} disabled={busy} value={roles[column.sourceSchemaColumnId] ?? ""} onChange={event => {
            const next = { ...roles }; if (event.target.value) next[column.sourceSchemaColumnId] = event.target.value as SemanticRole;
            else delete next[column.sourceSchemaColumnId];
            setRoles(next); setPlan({ ...plan, quality: null }); setDecisions({}); setReview(null); setCount(null); setMeasure("");
          }}><option value="">Choose meaning</option>{column.candidateRoles.map(role => <option key={role} value={role}>{words(role)}</option>)}</select>
        </>}
      </div>)}
      <button disabled={busy || !rolesComplete} onClick={() => void run(async () => {
        const saved = review;
        setReview(null); setCount(null); setDecisions({}); setPlan({ ...plan, quality: null });
        const preview = await request<Plan>("/analysis-review/plan", envelope(false)); setPlan(preview);
        if (saved?.schema.context.datasetProfileRunId === preview.datasetProfileRunId && preview.quality) {
          const next: Record<number, DataQualityReviewDecision> = {};
          preview.quality.items.forEach((item, index) => {
            const previous = saved.quality.snapshot.items.find(previous => previous.code === item.code &&
              previous.scope === item.scope && previous.sourceSchemaColumnId === item.sourceSchemaColumnId);
            if (previous && (item.action === "ACKNOWLEDGE_NOTICE" ? previous.decision === "ACKNOWLEDGE" :
                previous.decision === "CONTINUE" || previous.decision === "HOLD")) next[index] = previous.decision;
          });
          setDecisions(next);
        }
      })}>Review quality</button>
      {plan.quality ? <section aria-label="Quality decisions"><h2>Data quality</h2>
        {plan.quality.items.length === 0 ? <p>No quality decisions required.</p> : null}
        {plan.quality.items.map((item, index) => <div key={`${item.code}-${item.sourceSchemaColumnId ?? "dataset"}`} style={{ marginBottom: 16 }}>
          <label htmlFor={`quality-${index}`}>{words(item.code)} — {item.sourceSchemaColumnId ? fieldLabel(item.sourceSchemaColumnId) : "whole dataset"}</label>
          <select id={`quality-${index}`} disabled={busy} value={decisions[index] ?? ""} onChange={event => {
            const next = { ...decisions }; if (event.target.value) next[index] = event.target.value as DataQualityReviewDecision;
            else delete next[index]; setDecisions(next); setReview(null); setCount(null); setMeasure("");
          }}><option value="">Choose decision</option>
            {item.action === "ACKNOWLEDGE_NOTICE" ? <option value="ACKNOWLEDGE">Acknowledge notice</option> : <>
              <option value="CONTINUE">Reviewed — continue</option><option value="HOLD">Hold for correction</option></>}
          </select>
        </div>)}
        <button disabled={busy || !qualityComplete || saveNeedsReload} onClick={() => void run(async () => {
          setReview(null); setCount(null);
          setSaveNeedsReload(true);
          await request("/analysis-review", envelope(true));
          setReview(await request<Review>("/analysis-review"));
          setSaveNeedsReload(false);
        })}>Save review</button>
      </section> : null}
    </section> : null}
    {review ? <section aria-label="Saved review results"><h2>Saved review {review.revision}</h2>
      <p>{held ? "On hold for correction. Counts are unavailable." : "Review complete. Counts are available."}</p>
      <button disabled={busy || held} onClick={() => void run(async () => {
        setCount(null); setCount(await request<Count>("/analysis-count", { requestVersion: "v1", kind: "ROW_COUNT" }));
      })}>Count rows</button>
      {matchingProfile && measures.length > 0 ? <div>
        <label htmlFor="count-field">Measure to count</label>
        <select id="count-field" disabled={busy || held} value={measure} onChange={event => { setMeasure(event.target.value); setCount(null); }}>
          <option value="">Choose measure</option>
          {measures.map(field => <option key={field.sourceSchemaColumnId} value={field.sourceSchemaColumnId}>
            {fieldLabel(field.sourceSchemaColumnId)} (field {(plan?.fieldLabels.findIndex(label => label.sourceSchemaColumnId === field.sourceSchemaColumnId) ?? -1) + 1})
          </option>)}
        </select>
        <p>Present values include zero. Missing values are excluded.</p>
        <button disabled={busy || held || !measures.some(field => field.sourceSchemaColumnId === measure)} onClick={() => void run(async () => {
          setCount(null); setCount(await request<Count>("/analysis-count", { requestVersion: "v1", kind: "AGGREGATE", operator: "COUNT_PRESENT", sourceSchemaColumnId: measure }));
        })}>Count present values</button>
      </div> : null}
      {!matchingProfile ? <p>Reload the current review to load field choices for this profile.</p> : null}
      {count ? <p role="status">{count.result.plan.operation === "COUNT_PRESENT" ? "Present values" : "Rows"}: {count.result.count}. Based on review {count.reviewRevision}, profile {count.result.context.datasetProfileRunId}.</p> : null}
    </section> : null}
  </main>;
}
