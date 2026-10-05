// Phase C7.3 — mirrors app/commercial/purchasing/_status.tsx's shape
// exactly, sourcing both the key space and display label from
// lib/commercial/purchaseReceiptLifecycle.ts (the zero-import,
// client-safe domain module) rather than redefining status strings/
// labels locally.
// Phase D4: rendered with the canonical semantic Badge (compact app tag),
// like the purchase-order/quote/invoice status badges; only the tone
// mapping lives here.
'use client';
import { PURCHASE_RECEIPT_STATUS_LABELS, type PurchaseReceiptStatus } from '@/lib/commercial/purchaseReceiptLifecycle';
import { Badge, type SemanticState } from '@/components/ui/app';

const STATUS_STATE: Record<PurchaseReceiptStatus, SemanticState> = {
  DRAFT: 'inactive',
  POSTED: 'info',
  CANCELLED: 'error',
};

export function PurchaseReceiptStatusBadge({ status }: { status: PurchaseReceiptStatus }) {
  return (
    <Badge state={STATUS_STATE[status] ?? 'inactive'}>
      {PURCHASE_RECEIPT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
