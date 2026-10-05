// Phase C7.4 — mirrors app/commercial/purchasing/_receiptStatus.tsx's
// shape exactly, sourcing both the key space and display label from
// lib/commercial/supplierBillLifecycle.ts (the zero-import, client-safe
// domain module) rather than redefining status strings/labels locally.
// Phase D4: rendered with the canonical semantic Badge (compact app tag),
// like the purchase-order/quote/invoice status badges; only the tone
// mapping lives here.
'use client';
import { SUPPLIER_BILL_STATUS_LABELS, type SupplierBillStatus } from '@/lib/commercial/supplierBillLifecycle';
import { Badge, type SemanticState } from '@/components/ui/app';

const STATUS_STATE: Record<SupplierBillStatus, SemanticState> = {
  DRAFT: 'inactive',
  POSTED: 'info',
  CANCELLED: 'error',
};

export function SupplierBillStatusBadge({ status }: { status: SupplierBillStatus }) {
  return (
    <Badge state={STATUS_STATE[status] ?? 'inactive'}>
      {SUPPLIER_BILL_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
