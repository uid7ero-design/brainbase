"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadReviewNavigation, worksheetReviewHref, type ReviewNavigation } from "@/lib/data-hub/client/reviewNavigation";
import { WORKSHEET_CHECK_TIMEOUT_MS } from "@/lib/data-hub/client/workbookPreparation";

type Props = { uploadId: string; batchId: string; disabled: boolean; onBusyChange: (value: boolean) => void; onScopeLoss: (code: string) => void };
export default function ReviewWorkbookNavigation({ uploadId, batchId, disabled, onBusyChange, onScopeLoss }: Props) {
  const [navigation, setNavigation] = useState<ReviewNavigation | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null), live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; pending.current?.abort(); pending.current = null; onBusyChange(false); };
  }, [onBusyChange]);
  async function load() {
    if (disabled || pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); onBusyChange(true); setError(""); setNavigation(null);
    const current = () => live.current && pending.current === controller;
    const timer = setTimeout(() => controller.abort(), WORKSHEET_CHECK_TIMEOUT_MS);
    try {
      const value = await loadReviewNavigation(uploadId, batchId, controller.signal);
      if (current() && !controller.signal.aborted) setNavigation(value);
    } catch (failure) {
      if (!current()) return;
      const code = failure instanceof Error ? failure.message : "REQUEST_FAILED";
      if (["UNAUTHORIZED", "FORBIDDEN"].includes(code)) onScopeLoss(code);
      setError("Couldn’t confirm worksheet navigation. Check the workbook link or try again. No review has been changed.");
    } finally { clearTimeout(timer); controller.abort(); if (current()) { pending.current = null; setBusy(false); onBusyChange(false); } }
  }
  const previous = navigation?.worksheets[navigation.position - 1], next = navigation?.worksheets[navigation.position + 1];
  const link = (href: string, label: string) => disabled ? <span aria-disabled="true">{label}</span> : <Link href={href}>{label}</Link>;
  return <section aria-label="Workbook worksheet navigation" style={{ margin: "20px 0", padding: 16, border: "1px solid var(--border)", borderRadius: 8 }}>
    <h2>Continue through this workbook</h2>
    <p>Load the worksheet list to confirm this worksheet’s workbook and see the previous or next available worksheet.</p>
    <button type="button" disabled={disabled || busy} onClick={() => void load()}>{navigation ? "Refresh workbook navigation" : "Load workbook navigation"}</button>
    {busy ? <button type="button" onClick={() => pending.current?.abort()}>Stop loading navigation</button> : null}
    {error ? <p role="alert">{error}</p> : null}
    {disabled && !busy ? <p>Finish the current step, or save or reload your review choices, before switching worksheets.</p> : null}
    {navigation ? <>
      <p>{navigation.worksheets[navigation.position].name || "Worksheet"} (worksheet {navigation.worksheets[navigation.position].index + 1}) · {navigation.position + 1} of {navigation.worksheets.length} available worksheets</p>
      <p>{link(`/data-hub/import/${encodeURIComponent(batchId)}/reviews`, "Back to workbook review status")}</p>
      <ul style={{ display: "flex", flexWrap: "wrap", gap: 20, paddingLeft: 20 }}>
        {previous ? <li>{link(worksheetReviewHref(previous.id, batchId), `Previous worksheet: ${previous.name || "Worksheet"} (worksheet ${previous.index + 1})`)}</li> : null}
        {next ? <li>{link(worksheetReviewHref(next.id, batchId), `Next worksheet: ${next.name || "Worksheet"} (worksheet ${next.index + 1})`)}</li> : null}
      </ul>
      <p>Switching does not load or save another review. Hidden, empty, ineligible and skipped worksheets are excluded.</p>
    </> : null}
  </section>;
}
