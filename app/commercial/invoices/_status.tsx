// Phase C4.2 — shared status-badge styling, mirroring
// app/commercial/quotes/_status.tsx's own shape exactly. OVERDUE is
// deliberately NOT a member of STATUS_STYLE's key space — it is never a
// persisted status (see lib/commercial/invoiceLifecycle.ts's own header:
// only DRAFT/ISSUED/VOID exist), only a derived display state rendered
// as a small SECOND badge next to the real status (see OverdueBadge
// below) — never a replacement for it, so an overdue invoice's true
// status (ISSUED) always stays visible.
export const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  DRAFT: { color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  ISSUED: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  VOID: { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: s.color, background: s.bg }}>
      {status}
    </span>
  );
}

// Only ever rendered by a caller that has already confirmed
// status === 'ISSUED' AND due_date is in the past — this component
// itself does not re-derive that condition, so a VOID invoice can never
// be mislabelled overdue by a caller passing the wrong boolean.
export function OverdueBadge() {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#fbbf24', background: 'rgba(251,191,36,0.12)' }}>
      Overdue
    </span>
  );
}
