// Phase C7.4 — mirrors app/commercial/purchasing/_receiptStatus.tsx's
// shape exactly, sourcing both the key space and display label from
// lib/commercial/supplierBillLifecycle.ts (the zero-import, client-safe
// domain module) rather than redefining status strings/labels locally.
'use client';
import { SUPPLIER_BILL_STATUS_LABELS, type SupplierBillStatus } from '@/lib/commercial/supplierBillLifecycle';

const STATUS_STYLE: Record<SupplierBillStatus, { color: string; bg: string }> = {
  DRAFT: { color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  POSTED: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  CANCELLED: { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};

export function SupplierBillStatusBadge({ status }: { status: SupplierBillStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: s.color, background: s.bg }}>
      {SUPPLIER_BILL_STATUS_LABELS[status] ?? status}
    </span>
  );
}
