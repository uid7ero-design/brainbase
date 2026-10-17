"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyzeReviewedUploadCountResult } from "@/lib/data-hub/analysisExecution/analyzeReviewedUploadCount";
import type { SemanticRole } from "@/lib/data-hub/semanticInference/contracts";
import type { DataQualityReviewDecision } from "@/lib/data-hub/dataQuality/reviewResolution";
import { parseReviewedCountResponse, type CountResponseExpectation } from "@/lib/data-hub/analysis/countResponse";
import { analysisFailureReference } from "@/lib/data-hub/analysis/failureReference";
import { validateAnalysisDatasetContexts } from "@/lib/data-hub/analysis/scopedProfileCounts";
import ProfilePlanningClient from "../_components/ProfilePlanningClient";
import ReviewWorkbookNavigation from "../_components/ReviewWorkbookNavigation";
import { decodeReviewPlan, decodeSessionReview, decodeReviewSave, requestReviewJson, type ReviewPlan, type SessionReview } from "@/lib/data-hub/client/reviewSession";

type Plan = ReviewPlan;
type Review = SessionReview;
type Count = Extract<AnalyzeReviewedUploadCountResult, { ok: true }>;
const words = (value: string) => value.toLowerCase().replaceAll("_", " ");
const recoveryMessage = (code: string) => {
  if (["PROFILE_NOT_COMPLETE", "PROFILER_VERSION_UNSUPPORTED"].includes(code)) return "This worksheet needs a completed, supported profile before analysis is available.";
  if (["REVIEW_PROFILE_CHANGED", "PROFILE_LINEAGE_MISMATCH", "DATASET_CONTEXT_MISMATCH"].includes(code)) return "The dataset changed. Reload its current profile and review before continuing.";
  if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)) return "This worksheet is unavailable to your current session. Sign in with an authorized account or return to imports.";
  if (code === "QUALITY_HOLD") return "The latest review has a quality hold. Reload it and review the required corrections before counting.";
  if (code === "REVIEW_FIELD_LIMIT") return "This review exceeds the interactive limit of 1,000 fields. Use a smaller worksheet or ask an administrator for help.";
  if (["REQUEST_CANCELLED", "REQUEST_TIMED_OUT"].includes(code)) return "Stopped waiting. If you were saving, the review may still finish on the server. Load the current review before saving again.";
  return "This step could not be completed. If saving failed, reload before trying again; the previous save may have completed.";
};

type Props = { uploadId: string; workbookHint?: string };
export default function AnalysisReviewClient(props: Props) {
  return <ReviewSession key={props.uploadId} {...props} />;
}
function ReviewSession({ uploadId, workbookHint }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [roles, setRoles] = useState<Map<string, SemanticRole>>(() => new Map());
  const [decisions, setDecisions] = useState<Record<number, DataQualityReviewDecision>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [count, setCount] = useState<Count | null>(null);
  const [measure, setMeasure] = useState("");
  const [saveNeedsReload, setSaveNeedsReload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planningBusy, setPlanningBusy] = useState(false);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [scopeInvalid, setScopeInvalid] = useState(false);
  const allBusy = busy || planningBusy || navigationBusy;
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const live = useRef(true);
  const endpoint = `/api/data-hub/worksheets/${encodeURIComponent(uploadId)}`;

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; const controller = pending.current; pending.current = null; controller?.abort(); };
  }, []);
  const clearScope = useCallback((code: string) => {
    setPlan(null); setReview(null); setCount(null); setRoles(new Map()); setDecisions({}); setMeasure(""); setDirty(false); setScopeInvalid(true);
    setError(analysisFailureReference(code));
  }, []);
  async function request(path: string, body?: unknown): Promise<unknown> {
    const controller = pending.current;
    if (!controller) throw new Error("REQUEST_CANCELLED");
    const data = await requestReviewJson(endpoint + path, controller, body);
    if (!live.current || pending.current !== controller || controller.signal.aborted) throw new Error("REQUEST_CANCELLED");
    return data;
  }
  async function run(action: () => Promise<void>) {
    if (pending.current || planningBusy || navigationBusy) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError(""); setCount(null);
    try { await action(); } catch (failure) {
      if (live.current && pending.current === controller) {
        const code = analysisFailureReference(failure instanceof Error ? failure.message : undefined);
        if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)) clearScope(code); else setError(code);
      }
    } finally {
      controller.abort();
      if (live.current && pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  async function requestCount(body: unknown, expected: CountResponseExpectation) {
    const parsed = parseReviewedCountResponse(await request("/analysis-count", body), expected);
    if (!parsed.ok) throw new Error(parsed.code);
    return parsed.response;
  }
  function envelope(includeQuality: boolean) {
    return { reviewVersion: "v1", datasetProfileRunId: plan!.datasetProfileRunId,
      semanticChoices: Array.from(roles, ([sourceSchemaColumnId, role]) => ({ sourceSchemaColumnId, role })),
      qualityDecisions: includeQuality ? plan!.quality!.items.map((item, index) => ({ code: item.code, scope: item.scope,
        ...(item.sourceSchemaColumnId ? { sourceSchemaColumnId: item.sourceSchemaColumnId } : {}), decision: decisions[index] })) : [] };
  }
  const required = plan?.clarification.columns.filter(column => column.resolutionState === "CLARIFICATION_REQUIRED") ?? [];
  const rolesComplete = required.every(column => column.candidateRoles.includes(roles.get(column.sourceSchemaColumnId)!));
  const qualityComplete = !!plan?.quality && plan.quality.items.every((_, index) => !!decisions[index]);
  const held = review?.quality.snapshot.state === "HOLD_FOR_REMEDIATION";
  const matchingProfile = !!plan && review?.schema.context.datasetProfileRunId === plan.datasetProfileRunId;
  const planningStale = !!review && !!count && (count.reviewRevision !== review.revision ||
    !validateAnalysisDatasetContexts(review.schema.context, [count.result.context]).ok);
  const measures = matchingProfile ? review.schema.snapshot.fields.filter(field => field.fieldClass === "MEASURE") : [];
  const fieldLabel = (id: string) => plan?.fieldLabels.find(field => field.sourceSchemaColumnId === id)?.label ?? "Field";
  function restoredRoles(currentPlan: Plan, saved: Review) {
    if (saved.schema.context.datasetProfileRunId !== currentPlan.datasetProfileRunId) return new Map<string, SemanticRole>();
    const next = new Map<string, SemanticRole>();
    for (const column of currentPlan.clarification.columns) {
      const field = saved.schema.snapshot.fields.find(field => field.sourceSchemaColumnId === column.sourceSchemaColumnId);
      if (column.resolutionState === "CLARIFICATION_REQUIRED" && field?.resolutionSource === "CLARIFIED_CHOICE" &&
          column.candidateRoles.includes(field.semanticRole)) next.set(column.sourceSchemaColumnId, field.semanticRole);
    }
    return next;
  }

  return <main style={{ maxWidth: 800, margin: "24px auto", padding: 24, overflowWrap: "anywhere" }}>
    <Link href="/data-hub/import">Back to Data Hub imports</Link>
    <h1>Review dataset and count</h1>
    <p>Review field meanings and data quality before calculating counts from the current dataset profile.</p>
    <p>Worksheet: {uploadId}</p>
    <p><Link href={`/data-hub/prepare/${encodeURIComponent(uploadId)}`}>Prepare this worksheet</Link></p>
    {workbookHint ? <ReviewWorkbookNavigation key={JSON.stringify([uploadId, workbookHint, scopeInvalid])} uploadId={uploadId} batchId={workbookHint}
      disabled={allBusy || dirty || saveNeedsReload || scopeInvalid} onBusyChange={setNavigationBusy} onScopeLoss={clearScope} /> : null}
    {dirty ? <p role="status">You have unsaved review choices. Save them, or load the current review to discard them before switching worksheets.</p> : null}
    {saveNeedsReload ? <p role="status">Load the current review before saving or switching worksheets again. The previous save may have completed.</p> : null}
    <button disabled={allBusy} onClick={() => void run(async () => {
      setPlan(null); setRoles(new Map()); setDecisions({}); setReview(null); setCount(null); setMeasure("");
      const currentPlan = decodeReviewPlan(await request("/analysis-review/plan"));
      let saved: Review | null = null;
      try {
        saved = decodeSessionReview(await request("/analysis-review"), uploadId, currentPlan.datasetProfileRunId,
          currentPlan.clarification.columns.map(column => column.sourceSchemaColumnId));
      }
      catch (failure) { if (!(failure instanceof Error) || failure.message !== "REVIEW_NOT_FOUND") throw failure; }
      setPlan(currentPlan); setReview(saved); if (saved) setRoles(restoredRoles(currentPlan, saved));
      setSaveNeedsReload(false); setDirty(false); setScopeInvalid(false);
    })}>Load current review</button>
    <p role="status" aria-live="polite">{busy ? "Working…" : ""}</p>
    {busy ? <button type="button" onClick={() => pending.current?.abort()}>Stop review request</button> : null}
    {error ? <div role="alert"><p>{recoveryMessage(error)}</p><p>Reference: {error}</p></div> : null}
    {plan ? <section aria-label="Dataset review">
      <h2>Field meanings</h2>
      <p>Only choices offered by the current profile can be selected. Fields without a candidate need a new profile or corrected data.</p>
      {plan.clarification.columns.map((column, index) => <div key={column.sourceSchemaColumnId} style={{ marginBottom: 16 }}>
        <label htmlFor={`field-${index}`}>{fieldLabel(column.sourceSchemaColumnId)} (field {index + 1})</label>
        {column.resolutionState === "RESOLVED" ? <p>{words(column.candidateRoles[0])} — resolved by the profile</p> : <>
          <p>{column.reasons.map(words).join(", ")}</p>
          <select id={`field-${index}`} disabled={allBusy} value={roles.get(column.sourceSchemaColumnId) ?? ""} onChange={event => {
            if (pending.current) return;
            const next = new Map(roles); if (event.target.value) next.set(column.sourceSchemaColumnId, event.target.value as SemanticRole);
            else next.delete(column.sourceSchemaColumnId);
            setDirty(true);
            setRoles(next); setPlan({ ...plan, quality: null }); setDecisions({}); setReview(null); setCount(null); setMeasure("");
          }}><option value="">Choose meaning</option>{column.candidateRoles.map(role => <option key={role} value={role}>{words(role)}</option>)}</select>
        </>}
      </div>)}
      <button disabled={allBusy || !rolesComplete} onClick={() => void run(async () => {
        const saved = review;
        setReview(null); setCount(null); setDecisions({}); setPlan({ ...plan, quality: null });
        const preview = decodeReviewPlan(await request("/analysis-review/plan", envelope(false)), plan.datasetProfileRunId); setPlan(preview);
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
          <select id={`quality-${index}`} disabled={allBusy} value={decisions[index] ?? ""} onChange={event => {
            if (pending.current) return; setDirty(true);
            const next = { ...decisions }; if (event.target.value) next[index] = event.target.value as DataQualityReviewDecision;
            else delete next[index]; setDecisions(next); setReview(null); setCount(null); setMeasure("");
          }}><option value="">Choose decision</option>
            {item.action === "ACKNOWLEDGE_NOTICE" ? <option value="ACKNOWLEDGE">Acknowledge notice</option> : <>
              <option value="CONTINUE">Reviewed — continue</option><option value="HOLD">Hold for correction</option></>}
          </select>
        </div>)}
        <button disabled={allBusy || !qualityComplete || saveNeedsReload} onClick={() => void run(async () => {
          setReview(null); setCount(null);
          setSaveNeedsReload(true);
          const revision = decodeReviewSave(await request("/analysis-review", envelope(true)));
          const saved = decodeSessionReview(await request("/analysis-review"), uploadId, plan.datasetProfileRunId,
            plan.clarification.columns.map(column => column.sourceSchemaColumnId));
          if (saved.revision < revision) throw new Error("REVIEW_REVISION_MISMATCH");
          setReview(saved); setSaveNeedsReload(false); setDirty(false);
        })}>Save review</button>
      </section> : null}
    </section> : null}
    {review ? <section aria-label="Saved review results"><h2>Saved review {review.revision}</h2>
      <p>{held ? "On hold for correction. Counts are unavailable." : "Review complete. Counts are available."}</p>
      <button disabled={allBusy || held || planningStale} onClick={() => void run(async () => {
        setCount(null); setCount(await requestCount({ requestVersion: "v1", kind: "ROW_COUNT" }, { uploadId, operation: "ROW_COUNT" }));
      })}>Count rows</button>
      {matchingProfile && measures.length > 0 ? <div>
        <label htmlFor="count-field">Measure to count</label>
        <select id="count-field" disabled={allBusy || held || planningStale} value={measure} onChange={event => { if (!pending.current) { setMeasure(event.target.value); setCount(null); } }}>
          <option value="">Choose measure</option>
          {measures.map(field => <option key={field.sourceSchemaColumnId} value={field.sourceSchemaColumnId}>
            {fieldLabel(field.sourceSchemaColumnId)} (field {(plan?.fieldLabels.findIndex(label => label.sourceSchemaColumnId === field.sourceSchemaColumnId) ?? -1) + 1})
          </option>)}
        </select>
        <p>Present values include zero. Missing values are excluded.</p>
        <button disabled={allBusy || held || planningStale || !measures.some(field => field.sourceSchemaColumnId === measure)} onClick={() => void run(async () => {
          setCount(null); setCount(await requestCount({ requestVersion: "v1", kind: "AGGREGATE", operator: "COUNT_PRESENT", sourceSchemaColumnId: measure },
            { uploadId, operation: "COUNT_PRESENT", sourceSchemaColumnId: measure }));
        })}>Count present values</button>
      </div> : null}
      {!matchingProfile ? <p>Reload the current review to load field choices for this profile.</p> : null}
      {count ? <p role="status">{count.result.plan.operation === "COUNT_PRESENT" ? "Present values" : "Rows"}: {count.result.count}. Based on review {count.reviewRevision}, profile {count.result.context.datasetProfileRunId}.</p> : null}
    </section> : null}
    {review && matchingProfile && !saveNeedsReload && !planningStale ? <ProfilePlanningClient
      key={JSON.stringify([review.revision, review.schema.context])} uploadId={uploadId} review={review}
      fieldLabels={plan!.fieldLabels} disabled={busy || navigationBusy || held} onBusyChange={setPlanningBusy} onScopeLoss={clearScope} /> : null}
    {planningStale ? <p>Reload the current review before planning or counting again: the returned count used a different review or profile.</p> : null}
  </main>;
}
