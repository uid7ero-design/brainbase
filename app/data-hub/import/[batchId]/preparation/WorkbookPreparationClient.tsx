"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PREPARATION_STEPS } from "@/lib/data-hub/client/preparation";
import { MAX_PREPARATION_SELECTION, prepareWorkbookSelection, type PreparationProgress } from "@/lib/data-hub/client/workbookPreparationQueue";
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
  const [busy, setBusy] = useState<"load" | "scan" | "prepare" | null>("load");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<Map<string, PreparationProgress>>(() => new Map());
  const [queueMessage, setQueueMessage] = useState("");
  const [mustRecheck, setMustRecheck] = useState(false);
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
        if (active.current === ticket) { setCheckedAt(new Date().toLocaleTimeString()); setMustRecheck(false); }
      }
    } catch (failure) {
      if (active.current !== ticket) return;
      setChecks(new Map()); setCheckedAt(null);
      const code = failure instanceof Error ? failure.message : "REQUEST_FAILED";
      if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)) {
        setWorksheets(null);
        setSelected(new Set()); setProgress(new Map());
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
    setConfirming(false); setProgress(new Map()); setQueueMessage("");
    if (mode === "load") { setWorksheets(null); setSelected(new Set()); setFilter("all"); }
    void perform(ticket, mode, rows);
  }

  async function prepareSelected() {
    if (active.current || !confirming || mustRecheck) return;
    const selection = (worksheets ?? []).filter(row => selected.has(row.id) && !row.excluded);
    if (!selection.length || selection.length > MAX_PREPARATION_SELECTION) return;
    const ticket: Request = { controller: new AbortController(), reason: "CANCELLED" };
    active.current = ticket;
    setBusy("prepare"); setConfirming(false); setError(""); setChecks(new Map()); setCheckedAt(null);
    setProgress(new Map()); setQueueMessage(""); setMustRecheck(true);
    try {
      const result = await prepareWorkbookSelection(batchId, selection, ticket.controller.signal, (id, value) => {
        if (active.current !== ticket) return;
        setProgress(previous => new Map(previous).set(id, value));
        if (value.snapshot) setChecks(previous => new Map(previous).set(id, { snapshot: value.snapshot! }));
      });
      if (active.current !== ticket) return;
      setQueueMessage(result.complete ? "Selected worksheets are ready for their individual field and quality reviews."
        : "Preparation paused at a worksheet that needs attention. Later worksheets were not started. Open its preparation page, then check preparation again before starting another queue.");
      if (result.complete) setMustRecheck(false);
    } catch (failure) {
      if (active.current !== ticket) return;
      setChecks(new Map()); setProgress(new Map());
      const code = failure instanceof Error ? failure.message : "REQUEST_FAILED";
      if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)) {
        setWorksheets(null); setSelected(new Set());
        setError("This workbook is unavailable or your access has changed. Return to imports or refresh the worksheet list.");
      } else setError(code === "SELECTION_CHANGED" ? "The selected worksheets have changed. Refresh the worksheet list and select again."
        : "Preparation stopped. Work may still finish on the server. Check preparation again before starting another queue; completed work is kept.");
    } finally {
      ticket.controller.abort();
      if (active.current === ticket) { active.current = null; setBusy(null); }
    }
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
      <p>Check your worksheets together or prepare a selection in order, then review each worksheet’s field meanings and quality.</p>
    </header>
    <div className={styles.toolbar}>
      <Button type="button" disabled={!!busy} onClick={() => void run("load")}>Refresh worksheet list</Button>
      <Button type="button" variant="primary" disabled={!!busy || !eligible} onClick={() => void run("scan", worksheets ?? [])}>Check preparation</Button>
      {busy ? <Button type="button" variant="ghost" onClick={() => active.current?.controller.abort()}>{busy === "prepare" ? "Stop preparation" : "Stop checking"}</Button> : null}
    </div>
    <p role="status" aria-live="polite">{busy === "load" ? "Loading worksheets…" : busy === "scan"
      ? `Checking preparation: ${checks.size} of ${eligible} worksheets checked.`
      : busy === "prepare" ? `Preparing selected worksheets: ${Array.from(progress.values()).filter(value => value.phase === "ready").length} of ${selected.size} confirmed complete.`
      : checkedAt ? `Preparation checked at ${checkedAt}. Status can change; each worksheet checks again when opened.` : "Preparation statuses have not been checked."}</p>
    {error ? <p role="alert" className={styles.alert}>{error}</p> : null}
    {worksheets ? <>
      <section className={styles.summary} aria-label="Preparation summary">
        <p><strong>{ready}</strong> ready for review</p><p><strong>{needs}</strong> need preparation or attention</p>
        <p><strong>{unchecked}</strong> not checked</p><p><strong>{rows.length - eligible}</strong> outside preparation</p>
      </section>
      <p className={styles.help}>Hidden, empty, ineligible and skipped worksheets stay visible here and are excluded from preparation checks.</p>
      <section className={styles.selection} aria-label="Prepare selected worksheets">
        <h2>Prepare selected worksheets</h2>
        <p>Select up to {MAX_PREPARATION_SELECTION} worksheets. Source rows, standardized values and profiles are prepared one worksheet at a time. Completed steps are reused.</p>
        <p role="status">{selected.size} selected{selected.size && filter !== "all" ? " · Selection includes worksheets hidden by this filter." : ""}</p>
        <div className={styles.toolbar}>
          <Button type="button" disabled={!!busy || !selected.size} onClick={() => { setSelected(new Set()); setConfirming(false); }}>Clear selection</Button>
          <Button type="button" variant="primary" disabled={!!busy || !selected.size || mustRecheck} onClick={() => setConfirming(true)}>Prepare selection</Button>
        </div>
        {mustRecheck && !busy ? <p>Check preparation again before starting another queue. A stopped request may still finish on the server.</p> : null}
        {confirming ? <div className={styles.confirmation} role="region" aria-label="Confirm worksheet preparation">
          <h3>Prepare {selected.size} selected worksheets?</h3>
          <ol>{rows.filter(row => selected.has(row.worksheet.id)).map(({ worksheet }) => <li key={worksheet.id}>{worksheet.name || "Worksheet"} (worksheet {worksheet.index + 1})</li>)}</ol>
          <p>This starts preparation on the server. The queue stops at the first step needing attention, with no automatic retry or continuation. Stopping or leaving this page stops waiting; server work may still finish. Each worksheet still needs an individual field and quality review.</p>
          <div className={styles.toolbar}>
            <Button type="button" variant="primary" onClick={() => void prepareSelected()}>Start selected preparation</Button>
            <Button type="button" onClick={() => setConfirming(false)}>Keep selecting</Button>
          </div>
        </div> : null}
        {queueMessage ? <p role="status">{queueMessage}</p> : null}
      </section>
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
          const queueProgress = progress.get(worksheet.id);
          return <li key={worksheet.id} className={styles.card}>
          <div className={styles.cardHeading}><h2>{worksheet.name || "Worksheet"} <span>(worksheet {worksheet.index + 1})</span></h2><p>{labels[state]}</p></div>
          {!worksheet.excluded ? <label className={styles.checkbox}>
            <input type="checkbox" checked={selected.has(worksheet.id)} disabled={!!busy || (!selected.has(worksheet.id) && selected.size >= MAX_PREPARATION_SELECTION)}
              onChange={event => { const checked = event.target.checked; setConfirming(false); setSelected(previous => {
                const next = new Set(previous); if (checked && next.size < MAX_PREPARATION_SELECTION) next.add(worksheet.id); else next.delete(worksheet.id); return next;
              }); }} />
            Select worksheet {worksheet.index + 1} for preparation
          </label> : null}
          {queueProgress ? <p>{queueProgress.phase === "checking" ? "Checking current preparation…" : queueProgress.phase === "preparing"
            ? `Preparing: ${stepLabels[queueProgress.step!]}` : queueProgress.phase === "ready" ? "Confirmed complete in this queue." : "Queue paused here. Open worksheet preparation to continue."}</p> : null}
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
