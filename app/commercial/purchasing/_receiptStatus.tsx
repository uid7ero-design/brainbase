// Phase C7.3 — mirrors app/commercial/purchasing/_status.tsx's shape
// exactly, sourcing both the key space and display label from
// lib/commercial/purchaseReceiptLifecycle.ts (the zero-import,
// client-safe domain module) rather than redefining status strings/
// labels locally.
'use client';
import { PURCHASE_RECEIPT_STATUS_LABELS, type PurchaseReceiptStatus } from '@/lib/commercial/purchaseReceiptLifecycle';

const STATUS_STYLE: Record<PurchaseReceiptStatus, { color: string; bg: string }> = {
  DRAFT: { color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  POSTED: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  CANCELLED: { color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};

export function PurchaseReceiptStatusBadge({ status }: { status: PurchaseReceiptStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', color: s.color, background: s.bg }}>
      {PURCHASE_RECEIPT_STATUS_LABELS[status] ?? status}
    </span>
  );
}
