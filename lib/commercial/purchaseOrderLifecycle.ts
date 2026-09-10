// Phase C6.2 — central purchase-order status/transition authority. Every
// purchase-order status mutation anywhere in this codebase (lib/commercial/
// purchaseOrders.ts's submitPurchaseOrder/approvePurchaseOrder/
// returnPurchaseOrderToDraft/issuePurchaseOrder/cancelPurchaseOrder —
// there is no other write path to commercial_purchase_orders.status)
// MUST go through assertPurchaseOrderTransition() first, so the
// legal-transition rule lives in exactly one place. Mirrors
// lib/commercial/quoteLifecycle.ts / lib/commercial/invoiceLifecycle.ts's
// own shape exactly.
//
// Five statuses — one more than commercial_invoices' three, because a
// purchase order has a genuine internal approval gate an invoice does
// not. No payment/receipt states (no PAID, no RECEIVED) — no
// payment-allocation or receiving subsystem exists for Purchasing yet,
// mirroring invoiceLifecycle.ts's own identical reasoning for omitting
// PAID before C5 existed. No REJECTED — a return-to-DRAFT (with a
// required reason) covers "the approver sent it back for changes"; a
// PENDING_APPROVAL PO the approver wants to kill outright is CANCELLED
// directly, not a sixth status invented for a case REJECTED-then-DRAFT
// doesn't already distinguish.
//
// This module is deliberately ZERO-IMPORT — no lib/db, no server-only,
// no session/auth module, no Node-only dependency — so it is safe for a
// future Client Component to import directly (see the C6 architecture
// review's Section K / this phase's own client/server-boundary
// containment test) without risking the exact C5.3B client-bundle leak
// (a Client Component importing a runtime value from a module that also
// imports lib/db). lib/commercial/purchaseOrders.ts (server-only) is
// free to import THIS module back.
export type PurchaseOrderStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ISSUED' | 'CANCELLED';

export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'CANCELLED',
];

// Display-only labels — client-safe, no logic. Kept here (not
// invented per-component) so every future PO screen shows the same
// wording.
export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  ISSUED: 'Issued',
  CANCELLED: 'Cancelled',
};

// DRAFT is the only status a purchase order can ever be edited in
// (supplier, lines, and every line CRUD operation all gate on
// isPurchaseOrderEditable()). PENDING_APPROVAL/APPROVED/ISSUED/CANCELLED
// are all equally content-frozen — the C6.2 brief's "PENDING_APPROVAL:
// document content frozen", "APPROVED: document content frozen",
// "ISSUED: immutable commercial contents" are the same rule stated
// three times, not three different rules. CANCELLED is terminal — no
// transition out of it in C6.2 (amendments/revisions are explicitly a
// later phase, per the C6 architecture review's Section G).
const TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ['PENDING_APPROVAL'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT'],
  APPROVED: ['ISSUED'],
  ISSUED: ['CANCELLED'],
  CANCELLED: [],
};

export function isPurchaseOrderEditable(status: PurchaseOrderStatus): boolean {
  return status === 'DRAFT';
}

export function isValidPurchaseOrderTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// Throws a plain Error (never silently no-ops) for any transition not in
// the table above — including the same-status "transition" a naive
// caller might otherwise treat as a harmless no-op (e.g. ISSUED ->
// ISSUED is not a legal transition; issuing an already-issued purchase
// order a second time must be rejected explicitly, not silently
// accepted) — mirrors assertInvoiceTransition()/assertQuoteTransition()
// exactly.
export function assertPurchaseOrderTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): void {
  if (!isValidPurchaseOrderTransition(from, to)) {
    throw new Error(`Cannot transition purchase order from ${from} to ${to}`);
  }
}

export function assertPurchaseOrderEditable(status: PurchaseOrderStatus): void {
  if (!isPurchaseOrderEditable(status)) {
    throw new Error(`Purchase order is ${status} and can no longer be edited`);
  }
}
