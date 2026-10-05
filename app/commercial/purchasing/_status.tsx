// Phase C6.3 — mirrors app/commercial/invoices/_status.tsx's shape, but
// sources both the key space and the display label from
// lib/commercial/purchaseOrderLifecycle.ts (the zero-import, client-safe
// domain module) rather than redefining status strings/labels locally,
// per this gate's explicit Section G instruction. There is no derived
// "overdue"-style second badge for purchase orders in C6.3 — only the
// five real lifecycle statuses are ever shown.
//
// Phase C (work surfaces): rendered with the canonical semantic Badge;
// only the tone mapping lives here.
'use client';
import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from '@/lib/commercial/purchaseOrderLifecycle';
import { Badge, type SemanticState } from '@/components/ui/app';

const STATUS_STATE: Record<PurchaseOrderStatus, SemanticState> = {
  DRAFT: 'inactive',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  ISSUED: 'info',
  CANCELLED: 'error',
};

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <Badge state={STATUS_STATE[status] ?? 'inactive'}>
      {PURCHASE_ORDER_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
