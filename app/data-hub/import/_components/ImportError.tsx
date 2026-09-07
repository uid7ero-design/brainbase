"use client";

// Data Hub 5A.3C.1 — one shared error-card renderer for every
// *Failed/uncertain/batchTerminal/unknownError phase. Never interpolates a
// raw internal `code` directly into rendered text — only the caller-provided
// `message`/`title` (already curated, non-leaking copy from screenGroup.ts)
// is shown. `code` is accepted only for logging/debugging via
// data-error-code, never rendered as visible text.
export default function ImportError({
  title,
  message,
  retryLabel,
  onRetry,
  busy,
  code,
}: {
  title: string;
  message: string;
  retryLabel?: string | null;
  onRetry?: (() => void) | null;
  busy?: boolean;
  code?: string;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-error-code={code}
      style={{
        border: "1px solid rgba(239,68,68,.25)",
        background: "rgba(239,68,68,.06)",
        borderRadius: 10,
        padding: "18px 20px",
        color: "#f9fafb",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "rgba(249,250,251,.72)", lineHeight: 1.5 }}>{message}</div>
      {retryLabel && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={!!busy}
          aria-busy={!!busy}
          style={{
            marginTop: 14,
            fontSize: 13,
            fontWeight: 500,
            padding: "7px 14px",
            borderRadius: 7,
            border: "1px solid rgba(255,255,255,.12)",
            background: busy ? "rgba(255,255,255,.04)" : "rgba(255,255,255,.06)",
            color: "#f9fafb",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
