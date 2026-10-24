"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import RunsPilotReviewClient from "@/app/data-hub/sources/runs-review/RunsPilotReviewClient";
import { mappingSetupRequest, type MappingSnapshot } from "@/lib/data-hub/client/mappingSetup";
import type { RunsPilotReview } from "@/lib/data-hub/schemaProfiles/runsPilotReview";
import styles from "../preparation.module.css";

export default function MappingSetupClient({ uploadId }: { uploadId: string }) {
  const [snapshot, setSnapshot] = useState<MappingSnapshot | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [editing, setEditing] = useState(false), [confirming, setConfirming] = useState(false);
  const active = useRef<AbortController | null>(null);
  const generation = useRef<object | null>(null);

  async function request(action?: { action: "SAVE"; fingerprint: string; review: RunsPilotReview } | { action: "CONFIRM"; fingerprint: string }) {
    if (active.current) return;
    const controller = new AbortController(), ticket = {}; active.current = controller; generation.current = ticket;
    setBusy(true); setError(""); setSnapshot(null); setConfirming(false); setEditing(false);
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const value = await mappingSetupRequest(uploadId, controller.signal, action);
      if (generation.current === ticket) setSnapshot(value);
    } catch (failure) {
      if (generation.current !== ticket) return;
      const code = failure instanceof Error ? failure.message : "";
      setError(["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code) ? "This worksheet is unavailable or your access has changed. Return to imports or sign in again."
        : code === "MAPPING_ALREADY_STARTED" ? "Preparation has already started. Its mapping stays pinned. Use a fresh upload to change units."
        : code === "MAPPING_STALE" ? "The saved mapping changed. Refresh and review the current version before continuing."
        : "Couldn’t confirm the result. Refresh before trying again; a save or confirmation may already have completed.");
    } finally {
      clearTimeout(timer); controller.abort();
      if (generation.current === ticket) { active.current = null; setBusy(false); }
    }
  }
  useEffect(() => {
    // key={uploadId} on the server page ensures a new worksheet has no old state.
    let mounted = true;
    void Promise.resolve().then(() => { if (mounted) void request(); });
    return () => { mounted = false; generation.current = null; active.current?.abort(); active.current = null; };
    // The mounted upload is immutable; requests use explicit event handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const setup = snapshot && snapshot.kind !== "NOT_APPLICABLE" ? snapshot : null;
  const edited = setup ? { ...setup.review, fields: setup.review.fields.map(field => ({ ...field, confirmed: false })) } : undefined;
  return <main className={styles.page}>
    <Link href={`/data-hub/prepare/${encodeURIComponent(uploadId)}`}>Back to worksheet preparation</Link>
    <h1>Confirm units before preparation</h1>
    <p>Check the units and formats used by this workbook. A saved mapping can be reused, and a new workbook needs its own confirmation.</p>
    <Button type="button" disabled={busy} onClick={() => void request()}>Refresh mapping status</Button>
    {busy ? <p role="status">Checking mapping…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {snapshot?.kind === "NOT_APPLICABLE" ? <p>This worksheet does not use the Runs mapping setup. Continue through its existing preparation workflow.</p> : null}
    {setup?.kind === "PINNED" ? <p>Preparation has already started. Its original mapping is kept. Use a fresh upload for mapping changes.</p> : null}
    {setup?.kind === "SETUP" ? <>
      <p>Mapping version {setup.version}. {setup.saved ? "Reviewed mapping saved." : "An administrator needs to save a reviewed mapping."}</p>
      {setup.saved && !editing ? <>
        <RunsPilotReviewClient key={`${setup.fingerprint}-saved`} initialReview={setup.review} readOnly embedded />
        {setup.canSave ? <Button type="button" onClick={() => { setEditing(true); setConfirming(false); }}>Change saved mapping</Button> : null}
        {setup.confirmed ? <p role="status">This workbook is confirmed for this mapping. Return to preparation when ready.</p> : <>
          <label><input type="checkbox" checked={confirming} onChange={event => setConfirming(event.target.checked)} /> This workbook uses the displayed units and formats.</label>
          <Button type="button" variant="primary" disabled={!confirming || busy} onClick={() => void request({ action: "CONFIRM", fingerprint: setup.fingerprint })}>Confirm mapping for this workbook</Button>
        </>}
      </> : <>
        {!setup.canSave ? <p>You can review the choices, but an administrator must approve and save the mapping.</p> : null}
        <RunsPilotReviewClient key={`${setup.fingerprint}-edit`} initialReview={setup.saved ? edited : setup.review} embedded readOnly={!setup.canSave || busy}
          onSave={setup.canSave ? review => void request({ action: "SAVE", fingerprint: setup.fingerprint, review }) : undefined} />
      </>}
    </> : null}
  </main>;
}
