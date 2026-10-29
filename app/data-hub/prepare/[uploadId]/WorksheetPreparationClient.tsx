"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PREPARATION_STEPS, preparationRequest, readPreparationStatus,
  type PreparationSnapshot, type PreparationStep, type PreparationStatus } from "@/lib/data-hub/client/preparation";
import styles from "./preparation.module.css";

const steps = {
  stage: { title: "Source rows", action: "Prepare source rows", description: "Read the uploaded worksheet using its selected governed schema and mapping." },
  normalize: { title: "Standardized values", action: "Standardize values", description: "Apply the selected mapping to the prepared rows while preserving their source links." },
  profile: { title: "Dataset profile", action: "Build dataset profile", description: "Summarize field types and data quality so the worksheet can be reviewed." },
};
const statusLabel: Record<PreparationStatus, string> = {
  NOT_READY: "Waiting for earlier steps", NOT_STARTED: "Not started", RUNNING: "In progress",
  SUCCEEDED: "Complete", FAILED: "Needs attention", ABANDONED: "Interrupted",
};
function recovery(code: string) {
  if (code === "MAPPING_CONFIRMATION_REQUIRED") return "Review the workbook’s units and confirm its saved mapping before preparing source rows.";
  if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)) return "This worksheet is unavailable to your account. Sign in again or return to imports.";
  if (["STAGING_INELIGIBLE", "NORMALIZATION_INELIGIBLE", "PROFILE_DOCUMENT_INVALID", "NORMALIZATION_PLAN_INVALID"].includes(code)) return "Check the worksheet’s governed schema and mapping in imports, then refresh its status.";
  if (code === "INTERACTIVE_PROFILE_LIMIT") return "This worksheet exceeds the interactive profile limit of 100,000 cells. Use a smaller worksheet or ask an administrator for help.";
  if (["PROFILE_INPUT_INVALID", "NORMALIZATION_BLOCKED"].includes(code)) return "Some values need correction. Check the worksheet and its mapping before trying again.";
  if (code === "CANCELLED") return "Stopped waiting. Preparation may still finish on the server. Refresh status before continuing.";
  if (code === "TIMEOUT") return "This request took too long. It may still finish on the server. Refresh status before continuing.";
  return "Couldn’t confirm this step. Refresh status before trying again; the previous request may have completed.";
}

export default function WorksheetPreparationClient({ uploadId }: { uploadId: string }) {
  const [snapshot, setSnapshot] = useState<PreparationSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const pending = useRef(true);
  const sequence = useRef<object | null>(null);
  const controller = useRef<AbortController | null>(null);
  const stopReason = useRef("");

  useEffect(() => {
    const ticket = {}, abort = new AbortController(); sequence.current = ticket;
    controller.current = abort; pending.current = true;
    const timer = setTimeout(() => { stopReason.current = "TIMEOUT"; abort.abort(); }, 65_000);
    readPreparationStatus(uploadId, abort.signal).then(value => {
      if (ticket === sequence.current) setSnapshot(value);
    }).catch(failure => {
      if (ticket === sequence.current) setError(recovery(stopReason.current || (failure instanceof Error ? failure.message : "PREPARATION_FAILED")));
    }).finally(() => {
      clearTimeout(timer); abort.abort();
      if (ticket === sequence.current) { pending.current = false; controller.current = null; setBusy(false); }
    });
    return () => { sequence.current = null; clearTimeout(timer); abort.abort(); controller.current?.abort(); };
  }, [uploadId]);

  const next = snapshot ? PREPARATION_STEPS.find(step => snapshot[step].status !== "SUCCEEDED") : undefined;
  const ready = !!snapshot && !next && !busy;
  const profileRunning = next === "profile" && snapshot?.profile.status === "RUNNING";

  async function run(step?: PreparationStep) {
    if (pending.current || (step && (step !== next || profileRunning))) return;
    pending.current = true; setBusy(true); setError(""); setSnapshot(null); stopReason.current = "";
    const ticket = {}, abort = new AbortController(); sequence.current = ticket; controller.current = abort;
    const timer = setTimeout(() => { stopReason.current = "TIMEOUT"; abort.abort(); }, 65_000);
    try {
      if (step) await preparationRequest(uploadId, step, "POST", abort.signal);
      const value = await readPreparationStatus(uploadId, abort.signal);
      if (ticket === sequence.current) setSnapshot(value);
    } catch (failure) {
      if (ticket === sequence.current) setError(recovery(stopReason.current || (failure instanceof Error ? failure.message : "PREPARATION_FAILED")));
    } finally {
      clearTimeout(timer); abort.abort();
      if (ticket === sequence.current) { pending.current = false; controller.current = null; setBusy(false); }
    }
  }

  return <main className={styles.page}>
    <Link href="/data-hub/import">Back to Data Hub imports</Link>
    <header className={styles.header}>
      <p className={styles.eyebrow}>Data Hub</p>
      <h1>Prepare worksheet for review</h1>
      <p>Run each preparation step when you’re ready. Completed work is kept if you leave this page.</p>
    </header>
    <p className={styles.reference}>Worksheet: {uploadId}</p>
    <p><Link href={`/data-hub/prepare/${encodeURIComponent(uploadId)}/mapping`}>Review units and saved mapping before first preparation</Link></p>
    <div className={styles.toolbar}>
      <Button type="button" disabled={busy} onClick={() => void run()}>Refresh status</Button>
      {busy ? <Button type="button" variant="ghost" onClick={() => { stopReason.current = "CANCELLED"; controller.current?.abort(); }}>Stop waiting</Button> : null}
    </div>
    <p role="status" aria-live="polite">{busy ? "Checking preparation…" : ready ? "Ready to review." : ""}</p>
    {error ? <p role="alert" className={styles.alert}>{error}</p> : null}
    <ol className={styles.steps} aria-label="Worksheet preparation">
      {PREPARATION_STEPS.map((step, index) => <li key={step} className={styles.card}>
        <div className={styles.stepHeading}><h2>{index + 1}. {steps[step].title}</h2>
          <span>{snapshot ? statusLabel[snapshot[step].status] : "Status unconfirmed"}</span></div>
        <p>{steps[step].description}</p>
        {snapshot?.[step].rowCount !== undefined ? <p>{snapshot[step].rowCount.toLocaleString()} rows</p> : null}
        {step === next && !busy && !profileRunning ? <Button type="button" variant="primary" onClick={() => void run(step)}>
          {snapshot?.[step].status === "RUNNING" ? "Continue preparing" : steps[step].action}
        </Button> : null}
        {step === "profile" && profileRunning ? <p>A profile request is already in progress. Refresh status shortly. If it remains in progress, ask an administrator to check it.</p> : null}
      </li>)}
    </ol>
    {ready ? <section className={styles.ready} aria-label="Ready for review">
      <h2>Your worksheet is ready</h2><p>Review field meanings and data quality before calculating counts.</p>
      <Link href={`/data-hub/analysis/${encodeURIComponent(uploadId)}`}>Open worksheet review</Link>
    </section> : null}
  </main>;
}
