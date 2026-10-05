import { Badge, type SemanticState } from '@/components/ui/app';

// Phase C4.2 — shared status badge, mirroring
// app/commercial/quotes/_status.tsx's own shape exactly. OVERDUE is
// deliberately NOT a member of STATUS_STATE's key space — it is never a
// persisted status (see lib/commercial/invoiceLifecycle.ts's own header:
// only DRAFT/ISSUED/VOID exist), only a derived display state rendered
// as a small SECOND badge next to the real status (see OverdueBadge
// below) — never a replacement for it, so an overdue invoice's true
// status (ISSUED) always stays visible.
//
// Phase C (work surfaces): rendered with the canonical semantic Badge.
// Only the tone is shared; the invoice's own lifecycle word stays the
// visible label (text + colour + shape, never colour alone).
export const STATUS_STATE: Record<string, SemanticState> = {
  DRAFT: 'inactive',
  ISSUED: 'info',
  VOID: 'error',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  VOID: 'Void',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge state={STATUS_STATE[status] ?? 'inactive'}>{STATUS_LABEL[status] ?? status}</Badge>;
}

// Only ever rendered by a caller that has already confirmed
// status === 'ISSUED' AND due_date is in the past — this component
// itself does not re-derive that condition, so a VOID invoice can never
// be mislabelled overdue by a caller passing the wrong boolean.
export function OverdueBadge() {
  return <Badge state="warning">Overdue</Badge>;
}
