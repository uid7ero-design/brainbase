"use client";

// Data Hub 5A.3C.1 — the Confirm control. A direct primary button, no modal,
// no typed confirmation (no such precedent exists anywhere in this codebase
// — discovery Section O). Accurate, non-"destructive"-framed consequence
// language. Prevents duplicate submission by disabling while the caller
// reports `busy` (phase === "confirming").
export default function ConfirmAction({
  eligible,
  busy,
  onConfirm,
  rowCount,
}: {
  eligible: boolean;
  busy: boolean;
  onConfirm: () => void;
  rowCount?: number;
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <p style={{ fontSize: 12, color: "rgba(249,250,251,.5)", marginBottom: 10 }}>
        {typeof rowCount === "number"
          ? `Importing this file will create ${rowCount} Illegal Dumping record(s). This cannot be undone.`
          : "Importing this file will create Illegal Dumping records. This cannot be undone."}
      </p>
      <button
        type="button"
        onClick={onConfirm}
        disabled={!eligible || busy}
        aria-busy={busy}
        style={{
          fontSize: 13,
          fontWeight: 600,
          padding: "9px 18px",
          borderRadius: 8,
          border: "none",
          background: eligible && !busy ? "linear-gradient(135deg, #6D28D9, #A78BFA)" : "rgba(255,255,255,.06)",
          color: eligible && !busy ? "#fff" : "rgba(255,255,255,.3)",
          cursor: eligible && !busy ? "pointer" : "default",
        }}
      >
        {busy ? "Confirming…" : "Confirm import"}
      </button>
    </div>
  );
}
