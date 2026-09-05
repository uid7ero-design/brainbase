// Phase C3 — shared status-badge styling, used by both the quote list
// and quote detail pages so the two never silently drift apart on what
// colour a given status renders as.
export const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  DRAFT: { color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  SENT: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  ACCEPTED: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  REJECTED: { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  EXPIRED: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: s.color, background: s.bg }}>
      {status}
    </span>
  );
}
