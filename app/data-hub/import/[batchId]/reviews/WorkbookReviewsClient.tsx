"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { loadWorkbookWorksheets, WORKSHEET_CHECK_TIMEOUT_MS, type WorkbookWorksheet } from "@/lib/data-hub/client/workbookPreparation";
import { checkWorkbookReviews, type ReviewCheck } from "@/lib/data-hub/client/workbookReviews";
import styles from "../preparation/workbookPreparation.module.css";

type State = "unchecked" | "excluded" | "unconfirmed" | "preparation" | "review" | "hold" | "reviewed";
const labels: Record<State, string> = { unchecked: "Not checked", excluded: "Outside review checks", unconfirmed: "Status unconfirmed",
  preparation: "Preparation required", review: "Review required", hold: "Quality hold", reviewed: "Saved review complete" };
function stateOf(row: WorkbookWorksheet, check?: ReviewCheck): State {
  if (row.excluded) return "excluded";
  if (!check) return "unchecked";
  if ("failed" in check) return "unconfirmed";
  return check.status.state === "PREPARATION_REQUIRED" ? "preparation" : check.status.state === "REVIEW_REQUIRED" ? "review"
    : check.status.state === "QUALITY_HOLD" ? "hold" : "reviewed";
}
type Ticket = { controller: AbortController; timedOut: boolean };

export default function WorkbookReviewsClient({ batchId }: { batchId: string }) {
  return <WorkbookReviews key={batchId} batchId={batchId} />;
}
function WorkbookReviews({ batchId }: { batchId: string }) {
  const filterId = useId();
  const [worksheets, setWorksheets] = useState<WorkbookWorksheet[] | null>(null);
  const [checks, setChecks] = useState<Map<string, ReviewCheck>>(() => new Map());
  const [busy, setBusy] = useState<"load" | "check" | null>("load");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const active = useRef<Ticket | null>(null);

  const perform = useCallback(async (ticket: Ticket, mode: "load" | "check", rows: WorkbookWorksheet[] = []) => {
    const timer = mode === "load" ? setTimeout(() => { ticket.timedOut = true; ticket.controller.abort(); }, WORKSHEET_CHECK_TIMEOUT_MS) : undefined;
    try {
      if (mode === "load") {
        const result = await loadWorkbookWorksheets(batchId, ticket.controller.signal);
        if (active.current === ticket) setWorksheets(result);
      } else {
        await checkWorkbookReviews(rows, ticket.controller.signal, (id, check) => {
          if (active.current === ticket) setChecks(previous => new Map(previous).set(id, check));
        });
        if (active.current === ticket) setCheckedAt(new Date().toLocaleTimeString());
      }
    } catch (failure) {
      if (active.current !== ticket) return;
      setChecks(new Map()); setCheckedAt("");
      const code = failure instanceof Error ? failure.message : "REQUEST_FAILED";
      if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)) {
        setWorksheets(null);
        setError("This workbook is unavailable or your access has changed. Return to imports or refresh the worksheet list.");
      } else setError(code === "REQUEST_TIMED_OUT" || ticket.timedOut ? "The check took too long. Review statuses are unconfirmed; check again when you’re ready."
        : ticket.controller.signal.aborted ? "Checking stopped. Review statuses are unconfirmed; check again when you’re ready."
        : "Couldn’t confirm saved review status. Refresh the worksheet list or check again.");
    } finally {
      clearTimeout(timer); ticket.controller.abort();
      if (active.current === ticket) { active.current = null; setBusy(null); }
    }
  }, [batchId]);
  function run(mode: "load" | "check") {
    if (active.current) return;
    const ticket = { controller: new AbortController(), timedOut: false }; active.current = ticket;
    setBusy(mode); setChecks(new Map()); setCheckedAt(""); setError("");
    if (mode === "load") { setWorksheets(null); setFilter("all"); }
    void perform(ticket, mode, worksheets ?? []);
  }
  useEffect(() => {
    const ticket = { controller: new AbortController(), timedOut: false }; active.current = ticket;
    queueMicrotask(() => { if (active.current === ticket) void perform(ticket, "load"); });
    return () => { const pending = active.current; active.current = null; pending?.controller.abort(); };
  }, [perform]);

  const rows = (worksheets ?? []).map(row => ({ row, state: stateOf(row, checks.get(row.id)) }));
  const eligible = rows.filter(({ row }) => !row.excluded).length;
  const count = (state: State) => rows.filter(row => row.state === state).length;
  const visible = rows.filter(row => filter === "all" || row.state === filter);
  return <main className={styles.page}>
    <Link href="/data-hub/import">Back to Data Hub imports</Link>
    <header className={styles.header}><p className={styles.eyebrow}>Data Hub · Workbook reviews</p>
      <h1>See which worksheets need review</h1>
      <p>Check current saved reviews together, then open each worksheet to review its field meanings and quality.</p>
    </header>
    <div className={styles.toolbar}>
      <Button type="button" disabled={!!busy} onClick={() => run("load")}>Refresh worksheet list</Button>
      <Button type="button" variant="primary" disabled={!!busy || !eligible} onClick={() => run("check")}>Check saved reviews</Button>
      {busy ? <Button type="button" variant="ghost" onClick={() => active.current?.controller.abort()}>Stop checking</Button> : null}
    </div>
    <p role="status" aria-live="polite">{busy === "load" ? "Loading worksheets…" : busy === "check" ? `Checking saved reviews: ${checks.size} of ${eligible} worksheets checked.`
      : checkedAt ? `Review status checked at ${checkedAt}. Each worksheet is observed separately; status can change.` : "Saved reviews have not been checked."}</p>
    {error ? <p role="alert" className={styles.alert}>{error}</p> : null}
    {worksheets ? <>
      <section aria-label="Review summary" className={styles.summary}>
        <p><strong>{count("reviewed")}</strong> saved reviews complete</p><p><strong>{count("review")}</strong> require review</p>
        <p><strong>{count("hold")}</strong> quality holds</p><p><strong>{count("preparation")}</strong> require preparation</p>
        <p><strong>{count("unchecked") + count("unconfirmed")}</strong> unchecked or unconfirmed</p><p><strong>{count("excluded")}</strong> outside review checks</p>
      </section>
      <p className={styles.help}>Checking reads current profile and saved-review metadata only. It does not prepare worksheets, save decisions, calculate counts or plan analysis. Each destination checks access and current data again.</p>
      <div className={styles.filter}><label htmlFor={filterId}>Show review status</label><select id={filterId} value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">All worksheets ({rows.length})</option>
        {(Object.keys(labels) as State[]).map(state => <option key={state} value={state}>{labels[state]} ({count(state)})</option>)}
      </select></div>
      {!rows.length ? <p>No worksheets have been inspected yet. Open the import to continue.</p> : !visible.length ? <p>No worksheets match this view.</p>
        : <ul className={styles.list}>{visible.map(({ row, state }) => {
          const check = checks.get(row.id), status = check && "status" in check ? check.status : undefined;
          return <li key={row.id} className={styles.card}>
            <div className={styles.cardHeading}><h2>{row.name || "Worksheet"} <span>(worksheet {row.index + 1})</span></h2><p>{labels[state]}</p></div>
            {status && "reviewRevision" in status ? <p>Saved review {status.reviewRevision} · profile {status.datasetProfileRunId}</p> : null}
            {status?.state === "REVIEWED_WITH_NOTICES" ? <p>The saved review includes acknowledged quality notices.</p> : null}
            {state === "hold" ? <p>The saved review has a quality hold. Review the required corrections before continuing.</p> : null}
            {state === "unconfirmed" ? <p>Couldn’t confirm the current status. Check again or open the worksheet.</p> : null}
            {state === "excluded" ? <p>Hidden, empty, ineligible and skipped worksheets are excluded from review checks.</p> : null}
            {!busy && !row.excluded ? <div className={styles.links}>
              <Link href={`/data-hub/prepare/${encodeURIComponent(row.id)}`}>Open preparation for worksheet {row.index + 1}</Link>
              {state !== "preparation" ? <Link href={`/data-hub/analysis/${encodeURIComponent(row.id)}`}>Open review for worksheet {row.index + 1}</Link> : null}
            </div> : null}
          </li>;
        })}</ul>}
    </> : null}
    <p><Link href={`/data-hub/import/${encodeURIComponent(batchId)}/preparation`}>Open workbook preparation</Link></p>
  </main>;
}
