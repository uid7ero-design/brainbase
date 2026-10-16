"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PREPARATION_STEPS } from "@/lib/data-hub/client/preparation";
import { checkWorkbookWorksheets, loadWorkbookWorksheets, workbookWorksheetState,
  WORKBOOK_CHECK_TIMEOUT_MS, WORKSHEET_CHECK_TIMEOUT_MS,
  type WorkbookWorksheet, type WorksheetCheck, type WorkbookState } from "@/lib/data-hub/client/workbookPreparation";
import styles from "./workbookPreparation.module.css";

const labels: Record<WorkbookState, string> = {
  unchecked: "Not checked", excluded: "Outside preparation", ready: "Ready for review",
  running: "In progress", attention: "Needs attention", needs: "Preparation needed",
};
const stepLabels = { stage: "Source rows", normalize: "Standardized values", profile: "Dataset profile" };
const statusLabels = { NOT_READY: "Waiting for earlier steps", NOT_STARTED: "Not started", RUNNING: "In progress",
  SUCCEEDED: "Complete", FAILED: "Failed", ABANDONED: "Abandoned" };
type Filter = "all" | "needs" | "ready" | "unchecked";
type Request = { controller: AbortController; reason: "CANCELLED" | "TIMED_OUT" };

export default function WorkbookPreparationClient({ batchId }: { batchId: string }) {
  return <WorkbookPreparation key={batchId} batchId={batchId} />;
}

function WorkbookPreparation({ batchId }: { batchId: string }) {
  const filterId = useId();
  const [worksheets, setWorksheets] = useState<WorkbookWorksheet[] | null>(null);
  const [checks, setChecks] = useState<Map<string, WorksheetCheck>>(() => new Map());
  const [busy, setBusy] = useState<"load" | "scan" | null>("load");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const active = useRef<Request | null>(null);

  async function perform(ticket: Request, mode: "load" | "scan", rows: WorkbookWorksheet[] = []) {
    const timer = setTimeout(() => { ticket.reason = "TIMED_OUT"; ticket.controller.abort(); },
      mode === "load" ? WORKSHEET_CHECK_TIMEOUT_MS : WORKBOOK_CHECK_TIMEOUT_MS);
    try {
      if (mode === "load") {
        const result = await loadWorkbookWorksheets(batchId, ticket.controller.signal);
        if (active.current === ticket) setWorksheets(result);
      } else {
        await checkWorkbookWorksheets(rows, ticket.controller.signal, (id, result) => {
          if (active.current === ticket) setChecks(previous => new Map(previous).set(id, result));
        });
        if (active.current === ticket) setCheckedAt(new Date().toLocaleTimeString());
      }
    } catch (failure) {
      if (active.current !== ticket) return;
      setChecks(new Map()); setCheckedAt(null);
      const code = failure instanceof Error ? failure.message : "REQUEST_FAILED";
      if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)) {
        setWorksheets(null);
        setError("This workbook is unavailable or your access has changed. Return to imports or refresh the worksheet list.");
      } else if (ticket.controller.signal.aborted) {
        setError(ticket.reason === "TIMED_OUT" ? "The check took too long. Check again when you’re ready."
          : "Checking stopped. Preparation statuses are unconfirmed; check again when you’re ready.");
      } else setError("Couldn’t confirm worksheet preparation. Refresh the worksheet list or check again.");
    } finally {
      clearTimeout(timer); ticket.controller.abort();
      if (active.current === ticket) { active.current = null; setBusy(null); }
    }
  }

  function run(mode: "load" | "scan", rows: WorkbookWorksheet[] = []) {
    if (active.current) return;
    const ticket: Request = { controller: new AbortController(), reason: "CANCELLED" };
    active.current = ticket;
    setBusy(mode); setError(""); setChecks(new Map()); setCheckedAt(null);
    if (mode === "load") { setWorksheets(null); setFilter("all"); }
    void perform(ticket, mode, rows);
  }

  useEffect(() => {
    const ticket: Request = { controller: new AbortController(), reason: "CANCELLED" };
    active.current = ticket;
    const timer = setTimeout(() => { ticket.reason = "TIMED_OUT"; ticket.controller.abort(); }, WORKSHEET_CHECK_TIMEOUT_MS);
    loadWorkbookWorksheets(batchId, ticket.controller.signal).then(result => {
      if (active.current === ticket) setWorksheets(result);
    }).catch(failure => {
      if (active.current !== ticket) return;
      const code = failure instanceof Error ? failure.message : "REQUEST_FAILED";
      setError(["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)
        ? "This workbook is unavailable or your access has changed. Return to imports or refresh the worksheet list."
        : ticket.controller.signal.aborted
          ? ticket.reason === "TIMED_OUT" ? "The check took too long. Check again when you’re ready." : "Checking stopped. Refresh the worksheet list when you’re ready."
          : "Couldn’t confirm worksheet preparation. Refresh the worksheet list or check again.");
    }).finally(() => {
      clearTimeout(timer); ticket.controller.abort();
      if (active.current === ticket) { active.current = null; setBusy(null); }
    });
    return () => { const ticket = active.current; active.current = null; ticket?.controller.abort(); };
  }, [batchId]);

  const rows = (worksheets ?? []).map(worksheet => ({ worksheet, state: workbookWorksheetState(worksheet, checks.get(worksheet.id)) }));
  const eligible = rows.filter(row => !row.worksheet.excluded).length;
  const ready = rows.filter(row => row.state === "ready").length;
  const needs = rows.filter(row => ["needs", "running", "attention"].includes(row.state)).length;
  const unchecked = rows.filter(row => row.state === "unchecked").length;
  const visible = rows.filter(row => filter === "all" || (filter === "needs" ? ["needs", "running", "attention"].includes(row.state) : row.state === filter));

  return <main className={styles.page}>
    <Link href="/data-hub/import">Back to Data Hub imports</Link>
    <header className={styles.header}>
      <p className={styles.eyebrow}>Data Hub · Workbook preparation</p>
      <h1>See what’s ready for review</h1>
      <p>Check your worksheets together, then open each one to continue preparation or review its field meanings and quality.</p>
    </header>
    <div className={styles.toolbar}>
      <Button type="button" disabled={!!busy} onClick={() => void run("load")}>Refresh worksheet list</Button>
      <Button type="button" variant="primary" disabled={!!busy || !eligible} onClick={() => void run("scan", worksheets ?? [])}>Check preparation</Button>
      {busy ? <Button type="button" variant="ghost" onClick={() => active.current?.controller.abort()}>Stop checking</Button> : null}
    </div>
    <p role="status" aria-live="polite">{busy === "load" ? "Loading worksheets…" : busy === "scan"
      ? `Checking preparation: ${checks.size} of ${eligible} worksheets checked.`
      : checkedAt ? `Preparation checked at ${checkedAt}. Status can change; each worksheet checks again when opened.` : "Preparation statuses have not been checked."}</p>
    {error ? <p role="alert" className={styles.alert}>{error}</p> : null}
    {worksheets ? <>
      <section className={styles.summary} aria-label="Preparation summary">
        <p><strong>{ready}</strong> ready for review</p><p><strong>{needs}</strong> need preparation or attention</p>
        <p><strong>{unchecked}</strong> not checked</p><p><strong>{rows.length - eligible}</strong> outside preparation</p>
      </section>
      <p className={styles.help}>Hidden, empty, ineligible and skipped worksheets stay visible here and are excluded from preparation checks.</p>
      <div className={styles.filter}><label htmlFor={filterId}>Show worksheets</label>
        <select id={filterId} value={filter} onChange={event => setFilter(event.target.value as Filter)}>
          <option value="all">All worksheets ({rows.length})</option><option value="needs">Need preparation or attention ({needs})</option>
          <option value="ready">Ready for review ({ready})</option><option value="unchecked">Not checked ({unchecked})</option>
        </select>
      </div>
      {worksheets.length === 0 ? <p>No worksheets have been inspected yet. Open the import to continue.</p>
        : visible.length === 0 ? <p>No worksheets match this view.</p>
        : <ul className={styles.list}>{visible.map(({ worksheet, state }) => {
          const check = checks.get(worksheet.id);
          const snapshot = check && "snapshot" in check ? check.snapshot : null;
          return <li key={worksheet.id} className={styles.card}>
          <div className={styles.cardHeading}><h2>{worksheet.name || "Worksheet"} <span>(worksheet {worksheet.index + 1})</span></h2><p>{labels[state]}</p></div>
          {snapshot ? <dl className={styles.steps}>
            {PREPARATION_STEPS.map(step => <div key={step}><dt>{stepLabels[step]}</dt><dd>{statusLabels[snapshot[step].status]}</dd></div>)}
          </dl> : null}
          {state === "attention" ? <p>Open worksheet preparation to confirm its current status and next step.</p> : null}
          {state === "running" ? <p>Preparation is in progress. Open the worksheet to check whether a continuation is available.</p> : null}
          {!busy && !worksheet.excluded ? <div className={styles.links}>
            <Link href={`/data-hub/prepare/${encodeURIComponent(worksheet.id)}`}>Open preparation for worksheet {worksheet.index + 1}</Link>
            {state === "ready" ? <Link href={`/data-hub/analysis/${encodeURIComponent(worksheet.id)}`}>Review worksheet {worksheet.index + 1}</Link> : null}
          </div> : null}
        </li>; })}</ul>}
      {!busy ? <Link href={`/data-hub/import/${encodeURIComponent(batchId)}`}>Open import settings and schema selection</Link> : null}
    </> : null}
  </main>;
}
