// Phase C6.3 — mirrors app/commercial/invoices/_status.tsx's shape, but
// sources both the key space and the display label from
// lib/commercial/purchaseOrderLifecycle.ts (the zero-import, client-safe
// domain module) rather than redefining status strings/labels locally,
// per this gate's explicit Section G instruction. There is no derived
// "overdue"-style second badge for purchase orders in C6.3 — only the
// five real lifecycle statuses are ever shown.
'use client';
import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from '@/lib/commercial/purchaseOrderLifecycle';

const STATUS_STYLE: Record<PurchaseOrderStatus, { color: string; bg: string }> = {
  DRAFT: { color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  PENDING_APPROVAL: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  APPROVED: { color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  ISSUED: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  CANCELLED: { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: s.color, background: s.bg }}>
      {PURCHASE_ORDER_STATUS_LABELS[status] ?? status}
    </span>
  );
}
