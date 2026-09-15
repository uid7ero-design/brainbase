// Phase C7.3 — central purchase-receipt status/transition authority.
// Every purchase-receipt status mutation anywhere in this codebase
// (lib/commercial/purchaseReceipts.ts's postPurchaseReceipt/
// cancelPurchaseReceipt — there is no other write path to
// commercial_purchase_receipts.status) MUST go through
// assertPurchaseReceiptTransition() first, so the legal-transition rule
// lives in exactly one place. Mirrors lib/commercial/
// purchaseOrderLifecycle.ts / invoiceLifecycle.ts's own shape exactly.
//
// Three statuses — no approval gate (PENDING_APPROVAL), per the
// explicit C7.3 instruction not to add one to receipts. A receipt
// records a receiving FACT (goods arrived / a service was rendered), not
// a request that needs internal sign-off before it can exist.
export type PurchaseReceiptStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';

export const PURCHASE_RECEIPT_STATUSES: PurchaseReceiptStatus[] = ['DRAFT', 'POSTED', 'CANCELLED'];

// Display-only labels — client-safe, no logic. Kept here (not invented
// per-component) so every future receipt screen shows the same wording.
export const PURCHASE_RECEIPT_STATUS_LABELS: Record<PurchaseReceiptStatus, string> = {
  DRAFT: 'Draft',
  POSTED: 'Posted',
  CANCELLED: 'Cancelled',
};

// DRAFT is the only status a receipt can ever be edited in (lines can be
// added/edited/removed; POSTED/CANCELLED are both equally
// content-frozen). CANCELLED is terminal — no transition out of it.
const TRANSITIONS: Record<PurchaseReceiptStatus, PurchaseReceiptStatus[]> = {
  DRAFT: ['POSTED'],
  POSTED: ['CANCELLED'],
  CANCELLED: [],
};

export function isPurchaseReceiptEditable(status: PurchaseReceiptStatus): boolean {
  return status === 'DRAFT';
}

export function isValidPurchaseReceiptTransition(from: PurchaseReceiptStatus, to: PurchaseReceiptStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// Throws a plain Error (never silently no-ops) for any transition not in
// the table above — including the same-status "transition" a naive
// caller might otherwise treat as a harmless no-op (e.g. POSTED ->
// POSTED is not a legal transition) — mirrors
// assertPurchaseOrderTransition()/assertInvoiceTransition() exactly.
export function assertPurchaseReceiptTransition(from: PurchaseReceiptStatus, to: PurchaseReceiptStatus): void {
  if (!isValidPurchaseReceiptTransition(from, to)) {
    throw new Error(`Cannot transition purchase receipt from ${from} to ${to}`);
  }
}

export function assertPurchaseReceiptEditable(status: PurchaseReceiptStatus): void {
  if (!isPurchaseReceiptEditable(status)) {
    throw new Error(`Purchase receipt is ${status} and can no longer be edited`);
  }
}
