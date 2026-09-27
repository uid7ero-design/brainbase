import { Badge, type SemanticState } from '@/components/ui/app';

// Phase C3 — shared status badge, used by both the quote list and quote
// detail pages so the two never silently drift apart on how a given
// status renders.
//
// Phase C (work surfaces): rendered with the canonical semantic Badge.
// Only the tone is shared; the quote's own lifecycle word stays the
// visible label.
export const STATUS_STATE: Record<string, SemanticState> = {
  DRAFT: 'inactive',
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'error',
  EXPIRED: 'warning',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge state={STATUS_STATE[status] ?? 'inactive'}>{STATUS_LABEL[status] ?? status}</Badge>;
}
