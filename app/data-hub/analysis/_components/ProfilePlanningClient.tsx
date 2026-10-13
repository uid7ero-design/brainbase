// Inherits the client boundary of AnalysisReviewClient; never imports server I/O.
import { useEffect, useRef, useState } from "react";
import type { LoadAnalysisReviewResult } from "@/lib/data-hub/analysisExecution/loadAnalysisReview";
import type { ReviewedProfileCountRequestCatalog } from "@/lib/data-hub/analysis/reviewedProfileCountCatalog";
import { parsePlanningCatalogJson, parsePlanningSelectionJson, type PlanningSelectionResponse } from "@/lib/data-hub/analysis/planningExchange";
import { analysisFailureReference } from "@/lib/data-hub/analysis/failureReference";

type Review = Extract<LoadAnalysisReviewResult, { ok: true }>;
type Props = { uploadId: string; review: Review; fieldLabels: { sourceSchemaColumnId: string; label: string }[];
  disabled: boolean; onBusyChange: (busy: boolean) => void };

export default function ProfilePlanningClient({ uploadId, review, fieldLabels, disabled, onBusyChange }: Props) {
  const [catalog, setCatalog] = useState<ReviewedProfileCountRequestCatalog | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [rows, setRows] = useState(true);
  const [plans, setPlans] = useState<PlanningSelectionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true); const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; pending.current?.abort(); pending.current = null; onBusyChange(false); };
  }, [onBusyChange]);
  const labels = new Map(fieldLabels.map((field, index) => [field.sourceSchemaColumnId, { label: field.label, position: index + 1 }]));
  const label = (id: string, index: number) => {
    const field = labels.get(id); return field ? `${field.label} (field ${field.position})` : `Measure ${index + 1}`;
  };
  const measureIds = catalog?.requests.flatMap(request => "sourceSchemaColumnId" in request ? [request.sourceSchemaColumnId] : []) ?? [];
  const requestCount = ids.length + (rows ? 1 : 0);
  const locked = disabled || busy;
  const held = review.quality.snapshot.state === "HOLD_FOR_REMEDIATION";
  function clearFailure(code: unknown) {
    setCatalog(null); setPlans(null); setIds([]); setRows(true); setError(analysisFailureReference(code));
  }
  async function request(kind: "catalog" | "selection") {
    if (disabled || held || pending.current || (kind === "selection" && (!catalog || requestCount < 1 || requestCount > 20))) return;
    const controller = new AbortController(); pending.current = controller;
    const token = ++generation.current;
    const current = () => live.current && generation.current === token && pending.current === controller;
    const selection = { selectionVersion: "v1" as const, expectedReviewRevision: review.revision,
      includeRowCount: rows, measureColumnIds: [...ids] };
    setPlans(null); setError(""); setBusy(true); onBusyChange(true);
    if (kind === "catalog") { setCatalog(null); setIds([]); setRows(true); }
    try {
      const response = await fetch(`/api/data-hub/worksheets/${encodeURIComponent(uploadId)}/analysis-planning`, {
        method: kind === "catalog" ? "GET" : "POST", cache: "no-store", signal: controller.signal,
        ...(kind === "selection" ? { headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ datasetProfileRunId: review.schema.context.datasetProfileRunId, selection }) } : {}),
      });
      const text = await response.text(); if (!current()) return;
      if (kind === "catalog") {
        const decoded = parsePlanningCatalogJson(text, { context: review.schema.context, reviewRevision: review.revision });
        if (!decoded.ok) clearFailure(decoded.code);
        else if (!decoded.response.ok) clearFailure(decoded.response.code);
        else if (!response.ok) clearFailure("REQUEST_FAILED");
        else if (decoded.response.catalog.readinessState !== review.quality.snapshot.state) clearFailure("PLANNING_RESPONSE_MISMATCH");
        else setCatalog(decoded.response.catalog);
      } else {
        const decoded = parsePlanningSelectionJson(text, { context: review.schema.context,
          readinessState: catalog!.readinessState, selection });
        if (!decoded.ok) clearFailure(decoded.code);
        else if (!decoded.response.ok) clearFailure(decoded.response.code);
        else if (!response.ok) clearFailure("REQUEST_FAILED");
        else setPlans(decoded.response);
      }
    } catch { if (current()) clearFailure("REQUEST_FAILED"); }
    finally { if (current()) { pending.current = null; setBusy(false); onBusyChange(false); } }
  }
  return <section aria-label="Analysis planning" style={{ marginTop: 24, overflowWrap: "anywhere" }}>
    <h2>Plan analysis requests</h2>
    <p>Choose the counts you intend to request. Planning does not calculate results or save a review.</p>
    {held ? <p>The saved review is on hold. Review the required corrections before planning.</p> : null}
    <button disabled={locked || held} onClick={() => void request("catalog")}>Load planning choices</button>
    <p role="status" aria-live="polite">{busy ? "Preparing planning choices…" : ""}</p>
    {error ? <div role="alert"><p>Planning could not be completed. Reload the current review and planning choices before trying again.</p>
      <p>Reference: {error}</p></div> : null}
    {!disabled && catalog ? <fieldset disabled={locked}><legend>Requests to plan</legend>
      <label style={{ display: "block", margin: "8px 0" }}><input type="checkbox" checked={rows}
        disabled={!rows && ids.length === 20} onChange={event => { setRows(event.target.checked); setPlans(null); setError(""); }} /> Row count</label>
      {measureIds.map((id, index) => <label key={id} style={{ display: "block", margin: "8px 0" }}>
        <input type="checkbox" checked={ids.includes(id)} disabled={requestCount === 20 && !ids.includes(id)}
          onChange={event => { const checked = event.target.checked;
            setIds(current => checked ? current.includes(id) ? current : [...current, id] : current.filter(value => value !== id));
            setPlans(null); setError(""); }} /> Present values — {label(id, index)}
      </label>)}
      <p>{requestCount} of 20 requests selected. Present values include zero; missing values are excluded.</p>
      <button disabled={locked || requestCount === 0} onClick={() => void request("selection")}>Plan selected requests</button>
    </fieldset> : null}
    {!disabled && plans ? <section aria-label="Planned requests"><h3>Planned requests</h3>
      <p role="status">{plans.plans.length} requests planned from saved review {plans.reviewRevision}. Counts have not been calculated.</p>
      <ol>{plans.plans.map((plan, index) => <li key={index}>{plan.snapshot.operation === "ROW_COUNT" ? "Row count"
        : `Present values — ${label(plan.snapshot.sourceSchemaColumnId, index)}`}</li>)}</ol>
    </section> : null}
  </section>;
}
