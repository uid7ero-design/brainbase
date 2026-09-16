// Phase C7.4 — central supplier-bill status/transition authority. Every
// supplier-bill status mutation anywhere in this codebase (lib/commercial/
// supplierBills.ts's postSupplierBill/cancelSupplierBill — there is no
// other write path to commercial_supplier_bills.status) MUST go through
// assertSupplierBillTransition() first, so the legal-transition rule
// lives in exactly one place. Mirrors lib/commercial/
// purchaseReceiptLifecycle.ts's own shape exactly.
//
// Three statuses — no approval gate (PENDING_APPROVAL), per the explicit
// C7.4 instruction not to add one to bills in this phase.
export type SupplierBillStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';

export const SUPPLIER_BILL_STATUSES: SupplierBillStatus[] = ['DRAFT', 'POSTED', 'CANCELLED'];

export const SUPPLIER_BILL_STATUS_LABELS: Record<SupplierBillStatus, string> = {
  DRAFT: 'Draft',
  POSTED: 'Posted',
  CANCELLED: 'Cancelled',
};

// DRAFT is the only status a bill can ever be edited in. CANCELLED is
// terminal — no transition out of it.
const TRANSITIONS: Record<SupplierBillStatus, SupplierBillStatus[]> = {
  DRAFT: ['POSTED'],
  POSTED: ['CANCELLED'],
  CANCELLED: [],
};

export function isSupplierBillEditable(status: SupplierBillStatus): boolean {
  return status === 'DRAFT';
}

export function isValidSupplierBillTransition(from: SupplierBillStatus, to: SupplierBillStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// Throws a plain Error (never silently no-ops) for any transition not in
// the table above — including the same-status "transition" a naive
// caller might otherwise treat as a harmless no-op.
export function assertSupplierBillTransition(from: SupplierBillStatus, to: SupplierBillStatus): void {
  if (!isValidSupplierBillTransition(from, to)) {
    throw new Error(`Cannot transition supplier bill from ${from} to ${to}`);
  }
}

export function assertSupplierBillEditable(status: SupplierBillStatus): void {
  if (!isSupplierBillEditable(status)) {
    throw new Error(`Supplier bill is ${status} and can no longer be edited`);
  }
}
