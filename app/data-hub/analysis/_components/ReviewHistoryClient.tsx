"use client";

import { useEffect, useRef, useState } from "react";
import { decodeReviewComparison, decodeReviewHistory, decodeReviewDetail, type ReviewDetail, type ReviewComparison, type ReviewHistoryPage, type ReviewHistoryQuery } from "@/lib/data-hub/analysis/reviewHistory";
import { analysisFailureReference } from "@/lib/data-hub/analysis/failureReference";
import { requestReviewJson, type SessionReview } from "@/lib/data-hub/client/reviewSession";

type Props = { uploadId: string; review: SessionReview; fieldLabels: { sourceSchemaColumnId: string; label: string }[];
  disabled: boolean; onBusyChange: (busy: boolean) => void; onInvalidated: (code: string) => void };
const words = (value: string) => value.toLowerCase().replaceAll("_", " ");
type DecisionFilter = "all" | "fields" | "quality" | "holds";
type DecisionRow = { key: string; text: string; kind: "fields" | "quality"; hold: boolean };
export default function ReviewHistoryClient({ uploadId, review, fieldLabels, disabled, onBusyChange, onInvalidated }: Props) {
  const [page, setPage] = useState<ReviewHistoryPage | null>(null), [comparison, setComparison] = useState<ReviewComparison | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null), [filter, setFilter] = useState<DecisionFilter>("all");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [changeOffset, setChangeOffset] = useState(0);
  const pending = useRef<AbortController | null>(null), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; pending.current?.abort(); pending.current = null; onBusyChange(false); }; }, [onBusyChange]);
  const lineage = review.schema.context, revision = review.revision;
  const fields = new Map(fieldLabels.map((field, i) => [field.sourceSchemaColumnId, `${field.label} (field ${i + 1})`]));
  async function read(selection: { kind: "page"; beforeRevision: number | null } | { kind: "compare"; baselineRevision: number } | { kind: "detail"; revision: number }) {
    if (disabled || pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); onBusyChange(true); setError(""); setComparison(null); setDetail(null); setFilter("all"); setChangeOffset(0);
    if (selection.kind === "page") setPage(null);
    const current = () => live.current && pending.current === controller && !controller.signal.aborted;
    const query: ReviewHistoryQuery = { ...selection, datasetProfileRunId: lineage.datasetProfileRunId, expectedReviewRevision: revision };
    const search = new URLSearchParams({ historyVersion: "v1", datasetProfileRunId: query.datasetProfileRunId, expectedReviewRevision: String(revision),
      ...(query.kind === "compare" ? { baselineRevision: String(query.baselineRevision) } : query.kind === "detail" ? { revision: String(query.revision) } : query.beforeRevision === null ? {} : { beforeRevision: String(query.beforeRevision) }) });
    try {
      const body = await requestReviewJson(`/api/data-hub/worksheets/${encodeURIComponent(uploadId)}/analysis-review/history${query.kind === "page" ? "" : `/${query.kind}`}?${search}`, controller);
      if (!current()) return;
      if (query.kind === "page") setPage(decodeReviewHistory(body, lineage, query));
      else if (query.kind === "compare") setComparison(decodeReviewComparison(body, lineage, query, [...fields.keys()]));
      else setDetail(decodeReviewDetail(body, lineage, query, [...fields.keys()]));
    } catch (failure) {
      if (!live.current || pending.current !== controller) return;
      const code = analysisFailureReference(failure instanceof Error ? failure.message : undefined);
      setPage(null); setComparison(null); setDetail(null); setError(code);
      if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND", "REVIEW_PROFILE_CHANGED", "REVIEW_REVISION_MISMATCH", "REVIEW_NOT_FOUND", "REVIEW_RECORD_INVALID", "PROFILE_NOT_COMPLETE"].includes(code)) onInvalidated(code);
    } finally { controller.abort(); if (live.current && pending.current === controller) { pending.current = null; setBusy(false); onBusyChange(false); } }
  }
  const changes: DecisionRow[] = comparison ? [
    ...comparison.semanticChanges.map(change => ({ key: `field:${change.sourceSchemaColumnId}`, kind: "fields" as const, hold: false, text: `${fields.get(change.sourceSchemaColumnId)}: ${change.fromRole === null ? "No explicit field choice" : words(change.fromRole)} → ${change.toRole === null ? "No explicit field choice" : words(change.toRole)}` })),
    ...comparison.qualityChanges.map(change => ({ key: JSON.stringify([change.code, change.scope, change.sourceSchemaColumnId ?? null]),
      kind: "quality" as const, hold: change.fromDecision === "HOLD" || change.toDecision === "HOLD",
      text: `${words(change.code)} — ${change.sourceSchemaColumnId === undefined ? "whole dataset" : fields.get(change.sourceSchemaColumnId)}: ${change.fromDecision === null ? "No explicit decision" : words(change.fromDecision)} → ${change.toDecision === null ? "No explicit decision" : words(change.toDecision)}` })),
  ] : [];
  const decisions: DecisionRow[] = detail ? [
    ...detail.semanticChoices.map(choice => ({ key: `field:${choice.sourceSchemaColumnId}`, kind: "fields" as const, hold: false,
      text: `${fields.get(choice.sourceSchemaColumnId)}: ${words(choice.role)}` })),
    ...detail.qualityDecisions.map(decision => ({ key: JSON.stringify([decision.code, decision.scope, decision.sourceSchemaColumnId ?? null]), kind: "quality" as const,
      hold: decision.decision === "HOLD", text: `${words(decision.code)} — ${decision.sourceSchemaColumnId === undefined ? "whole dataset" : fields.get(decision.sourceSchemaColumnId)}: ${words(decision.decision)}` })),
  ] : [];
  const rows = (detail ? decisions : changes).filter(row => filter === "all" || (filter === "holds" ? row.hold : row.kind === filter));
  const decisionList = <section aria-label={detail ? "Decision list" : "Change list"}>
    <label>Decision type <select value={filter} disabled={disabled || busy} onChange={event => { setFilter(event.target.value as DecisionFilter); setChangeOffset(0); }}>
      <option value="all">All decisions</option><option value="fields">Field choices</option><option value="quality">Quality decisions</option>
      <option value="holds">{detail ? "Hold decisions" : "Changes involving a hold"}</option>
    </select></label>
    <p role="status">{rows.length ? `${detail ? "Decisions" : "Changes"} ${changeOffset + 1}–${Math.min(changeOffset + 50, rows.length)} of ${rows.length}.` : "No recorded items match this filter."}</p>
    <ul>{rows.slice(changeOffset, changeOffset + 50).map(row => <li key={row.key}>{row.text}</li>)}</ul>
    {changeOffset > 0 ? <button type="button" disabled={disabled || busy} onClick={() => setChangeOffset(changeOffset - 50)}>{detail ? "Previous decisions" : "Previous changes"}</button> : null}
    {changeOffset + 50 < rows.length ? <button type="button" disabled={disabled || busy} onClick={() => setChangeOffset(changeOffset + 50)}>{detail ? "Next decisions" : "Next changes"}</button> : null}
  </section>;
  return <section aria-label="Saved review history" style={{ marginTop: 24, overflowWrap: "anywhere" }}>
    <h2>Saved review history</h2>
    <p>See recorded decisions for this worksheet’s current profile, ten reviews at a time. Compare an earlier review with the current saved review {revision}.</p>
    <p>History is read-only. It does not restore a review, change decisions, or make historical reviews available for analysis.</p>
    <button type="button" disabled={disabled || busy} onClick={() => void read({ kind: "page", beforeRevision: null })}>{page ? "Refresh review history" : "Load review history"}</button>
    {busy ? <button type="button" onClick={() => pending.current?.abort()}>Stop loading history</button> : null}
    <p role="status" aria-live="polite">{busy ? "Reading saved review decisions…" : ""}</p>
    {error ? <div role="alert"><p>{["REQUEST_CANCELLED", "REQUEST_TIMED_OUT"].includes(error) ? "Stopped waiting for history. Load it again to continue." : "History could not be confirmed. Reload the current review if it changed, then load history again."}</p><p>Reference: {error}</p></div> : null}
    {page ? <>
      <p>Showing {page.entries.length} saved {page.entries.length === 1 ? "review" : "reviews"} for the current profile. Review numbers restart for each profile.</p>
      <ol>
        {page.entries.map(entry => <li key={entry.revision} style={{ marginBottom: 16 }}>
          <h3>Revision {entry.revision}{entry.revision === revision ? " — current saved review" : ""}</h3>
          <p>{entry.semanticChoiceCount} explicit field {entry.semanticChoiceCount === 1 ? "choice" : "choices"}; {entry.qualityDecisionCount} quality decisions.</p>
          <p>{entry.acknowledgedNoticeCount} acknowledged notices; {entry.continuedReviewCount} continue decisions; {entry.heldReviewCount} hold decisions.</p>
          <button type="button" disabled={disabled || busy} onClick={() => void read({ kind: "detail", revision: entry.revision })}>View decisions in revision {entry.revision}</button>
          {entry.revision < revision ? <button type="button" disabled={disabled || busy} onClick={() => void read({ kind: "compare", baselineRevision: entry.revision })}>Compare revision {entry.revision} with current review</button> : null}
        </li>)}
      </ol>
      {page.nextBeforeRevision !== null ? <button type="button" disabled={disabled || busy} onClick={() => void read({ kind: "page", beforeRevision: page.nextBeforeRevision })}>Older reviews</button> : null}
      {page.beforeRevision !== null ? <button type="button" disabled={disabled || busy} onClick={() => void read({ kind: "page", beforeRevision: null })}>Newest reviews</button> : null}
      {page.entries.length === 0 ? <p>No earlier saved reviews on this page.</p> : null}
    </> : null}
    {comparison ? <section aria-label="Review decision changes">
      <h3>Changes from revision {comparison.baselineRevision} to current review {comparison.currentReviewRevision}</h3>
      <p>Only explicit recorded decisions are compared. “No explicit decision” means absent from that saved record; it is not an approval or a zero.</p>
      {!comparison.semanticChanges.length && !comparison.qualityChanges.length ? <p>These reviews record the same explicit decisions.</p> : null}
      <p>{changes.length} explicit decision changes in total.</p>
      {decisionList}
    </section> : null}
    {detail ? <section aria-label="Saved review decisions">
      <h3>Recorded decisions in revision {detail.revision}{detail.revision === revision ? " — current saved review" : " — earlier saved review"}</h3>
      <p>{detail.semanticChoices.length} explicit field choices; {detail.qualityDecisions.length} explicit quality decisions.</p>
      <p>Only recorded choices are shown. An absent choice is not an approval or a zero. This view does not restore decisions or change the current review.</p>
      {!detail.semanticChoices.length ? <p>No explicit field choices were recorded.</p> : null}
      {!detail.qualityDecisions.length ? <p>No explicit quality decisions were recorded.</p> : null}
      {decisionList}
    </section> : null}
  </section>;
}
