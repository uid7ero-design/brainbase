# Commercial Supplier / AP Settlement Design

Status: architecture and implementation foundation.

This document defines the next Commercial capability after the C7.9 finance-close and reconciliation work. It deliberately does not assign a new numbered phase because the repository has no canonical C7.10 or C8 roadmap entry yet.

## 1. Why this is the next foundation

Commercial already has:

- governed supplier bills with DRAFT -> POSTED -> CANCELLED lifecycle;
- POSTED supplier-bill lines as the C7.8 Budget Actual source;
- purchase-order commitments and receipt/bill reconciliation;
- finance adjustments, close history and External GL reconciliation;
- customer/AR payments in `commercial_payments`.

Commercial does not have supplier/AP settlement.

That absence is called out explicitly in the C7.6, C7.8 and C7.9 architecture. Adding supplier settlement is the smallest coherent next foundation because it introduces the missing cash-payment fact without redefining Budget Actual or pretending BrainBase is a statutory ledger.

## 2. Non-negotiable accounting boundary

Supplier payment is a cash-settlement fact.

It is not the C7.8 Budget Actual recognition event.

Therefore:

- POSTED supplier-bill lines remain Source Actual;
- finance adjustments remain separate;
- supplier payments never alter historical Source Actual, Effective Actual, External GL Actual or reconciliation variance;
- supplier settlement may later feed a distinct cash-flow or AP-aging view;
- C7.9 finance close/reconciliation semantics remain unchanged unless a later explicit policy adds cash controls.

No report may silently relabel paid cash as Budget Actual.

## 3. Do not reuse customer payment tables

`commercial_payments` and `commercial_payment_allocations` are accounts-receivable facts attached to customer invoices.

Supplier/AP settlement must use separate tables.

Reusing the AR tables would mix:

- money received from customers; and
- money paid to suppliers.

That would make sign conventions, lifecycle rules, reporting and audit provenance ambiguous.

## 4. Proposed entities

### commercial_supplier_payments

One immutable supplier remittance / cash-settlement fact.

Minimum fields:

- id;
- organisation_id;
- supplier_id;
- amount_cents;
- currency;
- method;
- reference;
- provider;
- provider_reference;
- paid_at;
- status: RECORDED | REVERSED;
- recorded_by;
- reversed_at;
- reversed_by;
- reversal_reason;
- created_at;
- updated_at.

Required structural rules:

- amount_cents > 0;
- currency is stored explicitly;
- supplier belongs to the same organisation;
- provider_reference cannot exist without provider;
- optional external-provider identity is unique per organisation/provider/reference;
- row carries UNIQUE(id, organisation_id) for composite child FKs.

### commercial_supplier_payment_allocations

Allocates one supplier payment across one or more POSTED supplier bills.

Minimum fields:

- id;
- organisation_id;
- supplier_payment_id;
- supplier_bill_id;
- allocated_amount_cents;
- created_at.

Required structural rules:

- allocated_amount_cents > 0;
- payment and bill are same tenant;
- allocation carries UNIQUE(id, organisation_id);
- one payment may have multiple bill allocations;
- one bill may have multiple payments.

Unlike C5.2 customer receipts, supplier payments should support multi-bill remittances from the start because supplier remittance batches commonly settle multiple invoices.

## 5. Supplier and currency invariants

A supplier payment may allocate only to bills that:

- belong to the same organisation;
- belong to the payment supplier;
- have status POSTED;
- have the same currency as the payment.

One payment cannot span suppliers.

One payment cannot span currencies.

No FX conversion is inferred.

## 6. Allocation and overpayment rules

For an active RECORDED supplier payment:

- the sum of its allocations must equal payment.amount_cents;
- an allocation cannot exceed the bill's remaining unpaid amount;
- total active allocations across all RECORDED payments for a bill cannot exceed bill.total_cents.

Partial payment of a bill is allowed.

Multiple payments against one bill are allowed.

A remittance across multiple bills is allowed.

Unapplied supplier cash is out of scope for the first implementation. A payment must be fully allocated when recorded.

## 7. Concurrency

Recording a supplier payment must be one atomic transaction.

The transaction must:

1. resolve and lock the target POSTED supplier bills in deterministic order;
2. re-check tenant, supplier and currency invariants;
3. calculate active paid-to-date for each bill;
4. reject any allocation that would overpay a bill;
5. verify allocation sum equals payment amount;
6. insert the supplier payment;
7. insert all allocations;
8. return the committed payment state.

Two concurrent payment attempts against the same bill must not both consume the same remaining balance.

Application pre-checks may provide clearer errors, but the transaction is authoritative.

## 8. Reversal and correction

A RECORDED supplier payment is immutable except for the single legal transition:

RECORDED -> REVERSED

Reversal requires:

- explicit user;
- explicit reason;
- timestamp.

The original amount, supplier, currency, method, reference, provider identity, paid_at and allocations are never rewritten or deleted.

A reversed payment contributes zero active paid amount.

Correction is represented by reversing the incorrect payment and recording a replacement.

## 9. Supplier-bill cancellation interaction

A POSTED supplier bill with active supplier-payment allocations must not be cancelled.

The user must first reverse the relevant supplier payment(s), then cancel the bill.

This prevents a CANCELLED payable from retaining active cash settlement.

The cancellation guard must be server-side and race-safe.

## 10. Financial-period boundary

Supplier settlement is not part of the current C7.8 payable Actual or C7.9 reconciliation basis.

The first implementation records `paid_at` but does not attribute supplier payments to `commercial_financial_periods` and does not change C7.9 close control totals.

A future cash-close or bank-reconciliation phase may introduce explicit settlement-period policy.

That future policy must not retroactively reinterpret C7.8/C7.9 history.

## 11. Authorization

Use the existing Purchasing capability boundary.

Proposed minimums:

- view settlement and paid/unpaid summaries: purchasing/view;
- record supplier payment: purchasing/administer or the repository's existing admin-equivalent Purchasing floor;
- reverse supplier payment: same or stricter than record;
- no route may rely on client-side role checks.

Exact role constants should reuse `authorizeCommercialRequest()` and existing Commercial role vocabulary rather than inventing a parallel permission model.

## 12. Audit events

At minimum:

- commercial_supplier_payment.recorded;
- commercial_supplier_payment.reversed.

Audit payloads should include stable identifiers and amounts, not mutable display labels as authority.

Bill-level payment state remains derived from immutable payment/allocation facts.

## 13. Read models

A supplier-bill payment summary should expose:

- bill total;
- active paid cents;
- remaining cents;
- payment state: UNPAID | PARTIALLY_PAID | PAID;
- active payment count;
- payment history including reversals.

A supplier-level AP summary may later aggregate:

- total POSTED payable;
- total settled;
- total outstanding;
- overdue outstanding.

That aggregate is a later read-model/UI slice, not required for the schema foundation.

## 14. UI direction

Supplier-bill detail is the first settlement surface.

For a POSTED bill:

- show Paid / Remaining;
- list payment history;
- allow an authorised user to record a payment;
- allow reversal with explicit reason.

A later supplier remittance screen may support one payment allocated across several bills in one workflow.

The API/domain model should support multi-bill allocation from day one even if the first UI records a payment from one bill detail page.

## 15. Explicitly out of scope

This foundation does not implement:

- bank feeds;
- bank reconciliation;
- payment-file generation;
- supplier bank-account storage;
- payment approval workflows;
- scheduled payments;
- cheque printing;
- FX settlement;
- withholding;
- GST/BAS settlement;
- statutory AP subledger posting;
- general-ledger journals;
- cash-flow forecasting;
- automatic matching to bank transactions;
- unapplied supplier cash.

## 16. Required schema tests

Before runtime rollout:

1. cross-tenant payment -> supplier relation is impossible;
2. cross-tenant allocation -> payment relation is impossible;
3. cross-tenant allocation -> bill relation is impossible;
4. amount and allocation cents must be positive;
5. provider reference requires provider;
6. duplicate provider/reference is rejected;
7. one payment can carry multiple allocations;
8. one bill can receive multiple payments;
9. migration is idempotent.

## 17. Required domain/integration tests

1. POSTED bill accepts partial payment.
2. second payment can settle remaining balance exactly.
3. overpayment is rejected.
4. two concurrent payments cannot both consume the same remaining balance.
5. payment supplier must match every bill supplier.
6. payment currency must match every bill currency.
7. DRAFT and CANCELLED bills cannot receive allocations.
8. allocation sum must equal payment amount.
9. one payment can settle multiple POSTED bills for the same supplier/currency.
10. payment reversal restores bill remaining balance.
11. repeated/concurrent reversal permits only one transition.
12. bill cancellation is blocked while active allocations exist.
13. bill cancellation succeeds after all relevant payments are reversed.
14. supplier payment data does not change C7.8 Budget Actual totals.
15. supplier payment data does not change C7.9 reconciliation snapshots/control totals.

## 18. Implementation slices

### AP-1 — schema foundation

- add supplier payment and allocation tables;
- structural tenant FKs and provider idempotency;
- disposable-Postgres migration harness.

### AP-2 — domain and concurrency

- record multi-allocation supplier payment atomically;
- reverse payment;
- paid/remaining read model;
- bill-cancellation guard;
- audit events.

### AP-3 — HTTP surface

- authorised read/record/reverse routes;
- stable error mapping;
- no-store reads.

### AP-4 — first UI

- supplier-bill payment summary/history;
- record payment;
- reverse payment.

### AP-5 — regression and finance isolation

- full Commercial containment;
- disposable Postgres integration;
- browser flow;
- production build;
- explicit proof that C7.8/C7.9 finance evidence is unchanged by settlement.

## 19. First implementation decision

Proceed with AP-1 as an additive schema foundation.

Do not modify or reuse customer payment tables.

Do not alter C7.8 Actual or C7.9 reconciliation logic as part of AP-1.
