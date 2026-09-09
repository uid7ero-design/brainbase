"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDataHubRecoverySession } from "./useDataHubRecoverySession";
import { deriveErrorOverlayCopy, isErrorOverlayPhase } from "../screenGroup";
import ReviewPanel from "../_components/ReviewPanel";
import ImportSuccess from "../_components/ImportSuccess";
import ImportError from "../_components/ImportError";
import type { ReviewPhase } from "../confirmEligibility";

// Data Hub 5A.3D.2 — direct recovery route's client shell. Reuses the
// EXISTING ReviewPanel/ImportSuccess/ImportError components and the
// EXISTING screenGroup.ts copy derivation verbatim — this is deliberately
// NOT a second rendering system: every screen a recovered import can reach
// is a phase the ordinary flow (ImportClient.tsx) already knows how to
// render, reused here rather than reimplemented (spec Section 43 "second
// state machine" concern applies equally to a second RENDER machine).
//
// The one genuinely new phase this route must present that the ordinary
// flow never reaches is "resumingBatch" (transient, immediately after
// mount) — handled inline below, not via screenGroup.ts, since it has no
// batch/worksheet data yet to hand any existing component.
const REVIEW_PHASES = new Set(["confirmationReady", "previewing", "previewFailed", "previewReady"]);

export default function RecoveryClient({ batchId }: { batchId: string }) {
  const router = useRouter();
  const { state, session } = useDataHubRecoverySession(batchId);

  // Same in-flight navigation guard as the ordinary flow (ImportClient.tsx),
  // scoped to this route's own one genuine mutating in-flight phase.
  useEffect(() => {
    if (state.phase !== "confirming") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.phase]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <RecoveryBody batchId={batchId} state={state} session={session} router={router} />
    </div>
  );
}

function RecoveryBody({
  state,
  session,
  router,
}: {
  batchId: string;
  state: ReturnType<typeof useDataHubRecoverySession>["state"];
  session: ReturnType<typeof useDataHubRecoverySession>["session"];
  router: ReturnType<typeof useRouter>;
}) {
  // T27/session-null guard: mirrors ImportFlow's own "session is null for
  // exactly the first render" reasoning (construction has zero side effects
  // — see useDataHubRecoverySession's own header comment).
  if (!session) {
    return <RecoveryStatusText text="Loading import…" />;
  }

  if (state.phase === "idle" || state.phase === "resumingBatch") {
    return <RecoveryStatusText text="Loading import…" />;
  }

  if (REVIEW_PHASES.has(state.phase)) {
    // PR #161 QA REMEDIATION (issue 1): pure client-side navigation back to
    // the picker — never a server mutation. The persisted ImportBatch/
    // worksheet are left exactly as they are; the user can reopen this same
    // batch from history at any time.
    return <ReviewPanel state={state as ReviewPhase} session={session} onRestart={() => router.push("/data-hub/import")} />;
  }

  if (state.phase === "confirming") {
    return <RecoveryStatusText text="Confirming import…" />;
  }

  if (state.phase === "imported" || state.phase === "alreadyImported") {
    return <ImportSuccess state={state} onStartAnother={() => router.push("/data-hub/import")} />;
  }

  if (isErrorOverlayPhase(state.phase)) {
    const copy = deriveErrorOverlayCopy(state)!;
    const onRetry = (() => {
      switch (copy.retryAction) {
        case "proceedToFinalize":
          return () => void session.proceedToFinalize();
        case "retryFinalize":
          return () => void session.retryFinalize();
        case "retryObtainWorksheet":
          return () => void session.retryObtainWorksheet();
        case "retryInspect":
          return () => void session.retryInspect();
        case "retryConfirm":
          // Mirrors ImportFlow's own retryConfirm().catch(() => {}) —
          // confirm()'s synchronous phase guard already rejects a same-tick
          // duplicate; this consumes that rejection so it never surfaces as
          // an unhandled promise rejection.
          return () => {
            session.retryConfirm().catch(() => {});
          };
        case "restart":
          return () => router.push("/data-hub/import");
        default:
          return null;
      }
    })();

    return <ImportError title={copy.title} message={copy.message} retryLabel={copy.retryLabel} onRetry={onRetry} />;
  }

  // Exhaustiveness fallback — a phase this route has never seen (e.g. an
  // ordinary-new-import-only phase like "uploading", structurally
  // unreachable via resumeFromBatchId's own matrix). Never silently blank;
  // offers the one honest way out.
  return (
    <ImportError
      title="This import can't be shown here"
      message="This import is not in a state this page can display."
      retryLabel="Start a new import"
      onRetry={() => router.push("/data-hub/import")}
    />
  );
}

function RecoveryStatusText({ text }: { text: string }) {
  return (
    <div aria-live="polite" aria-busy="true" style={{ fontSize: 13, color: "rgba(249,250,251,.7)" }}>
      {text}
    </div>
  );
}
