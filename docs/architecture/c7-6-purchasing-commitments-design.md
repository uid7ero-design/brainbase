# C7.6 — Purchasing Commitments / Budget Integration Design

Status: design gate only. No schema migration or runtime integration is authorised by this document.

## 1. Repository-grounded starting point

BrainBase already has authoritative purchasing facts for purchase orders, purchase-order lines, purchase receipts, supplier bills, and explicit receipt-line ↔ supplier-bill-line allocations.

Purchase orders use the lifecycle DRAFT → PENDING_APPROVAL → APPROVED → ISSUED → CANCELLED. Commercial contents are frozen from PENDING_APPROVAL onward, and the permanent PO number plus supplier snapshot are created only at APPROVED → ISSUED.

Purchase-order lines already carry optional cost_centre_id. A line-level cost centre is an override of the PO-level cost_centre_id.

The purchasing schema deliberately has no financial_period_id, committed, encumbrance, received_quantity, billed_quantity, matched_quantity, paid_cents, or payment_id cache columns.

Supplier bills are PO-backed and POSTED-only amounts are the authoritative billed-value facts. CANCELLED supplier bills stop contributing to billed aggregates.

commercial_financial_years and commercial_financial_periods already exist as structured, tenant-scoped Commercial period concepts intended for future budgets, purchasing reporting, and finance intelligence.

The older financial_models table is a JSON forecast model. Its line_items contain free-text GL identifiers and manually editable budget_fy, ytd_actual, and commitments values. It has no relational chart-of-accounts or cost-centre mapping.

## 2. C7.6 design principles

C7.6 MUST derive commitment values from governed purchasing facts. It MUST NOT persist mutable commitment totals on purchase orders or purchase-order lines.

C7.6 MUST keep Purchasing as the source of truth for procurement obligations and Budgeting as a consumer of governed derived facts.

C7.6 MUST NOT infer a Budget GL/account mapping from descriptions, supplier names, product names, or cost-centre display text.

C7.6 MUST NOT silently write derived Purchasing commitments into financial_models.line_items.commitments.

C7.6 MUST preserve tenant isolation structurally and in every read path.

## 3. Derived committed-spend model

The base grain is one purchase-order line.

For each line define:

- ordered_value_cents = commercial_purchase_order_lines.line_total_cents.
- active_billed_value_cents = SUM(commercial_supplier_bill_lines.line_total_cents) for POSTED, non-cancelled supplier bills linked through source_purchase_order_line_id.
- outstanding_commitment_cents = ordered_value_cents - active_billed_value_cents, but only while the parent PO is ISSUED.
- effective_cost_centre_id = COALESCE(purchase_order_line.cost_centre_id, purchase_order.cost_centre_id).
- commitment_currency = purchase_order.currency.
- commitment_effective_at = purchase_order.issued_at.

The existing over-billing guard should make active_billed_value_cents <= ordered_value_cents. Any negative derived outstanding commitment is therefore a data-integrity exception, not a value to clamp silently.

For DRAFT, PENDING_APPROVAL, APPROVED, and CANCELLED purchase orders, outstanding_commitment_cents is zero.

Receipt quantities and explicit match allocations remain reconciliation facts. They do not reduce the financial commitment amount.

A receipt may prove goods/services were received, but until Budget actuals are sourced from a governed payable/ledger fact, receipt activity must not be treated as actual spend.

## 4. Derived commitment lifecycle

The commitment lifecycle is a read-model state. It is NOT a new purchase-order status column.

NOT_COMMITTED:
- parent PO is DRAFT, PENDING_APPROVAL, APPROVED, or CANCELLED.
- outstanding commitment = 0.

OPEN:
- parent PO is ISSUED.
- active_billed_value_cents = 0.
- outstanding commitment = ordered_value_cents.

PARTIALLY_CONSUMED:
- parent PO is ISSUED.
- 0 < active_billed_value_cents < ordered_value_cents.
- outstanding commitment = ordered - active billed.

CONSUMED:
- parent PO is ISSUED.
- active_billed_value_cents = ordered_value_cents.
- outstanding commitment = 0.

INVALID_OVERBILLED:
- active_billed_value_cents > ordered_value_cents.
- this state should be impossible under current posting guards and exists only as a fail-loud read-model diagnostic for legacy/drift/corruption.

Supplier-bill cancellation moves a derived line from CONSUMED/PARTIALLY_CONSUMED back toward OPEN because cancelled bill value no longer contributes.
## 5. Money basis

The purchasing commitment engine should expose the authoritative commercial values already stored on the PO line:

- ordered_subtotal_cents
- ordered_tax_cents
- ordered_total_cents
- billed_subtotal_cents
- billed_tax_cents
- billed_total_cents
- outstanding_subtotal_cents
- outstanding_tax_cents
- outstanding_total_cents

C7.6 must not assume that a customer's Budget is GST-inclusive or GST-exclusive.

The internal read model can therefore provide all three bases, while a later Budget policy/configuration decides which basis is consumed for budget reporting.

Until that policy exists, the generic term "Budget commitment" must not be equated with line_total_cents in user-facing finance reporting.

## 6. Financial-period attribution boundary

commercial_financial_years / commercial_financial_periods are the correct structured period authority for future Budget integration.

However, the current repository does not define a business rule proving whether a Purchasing commitment belongs to a period by issued_at, delivery_date, invoice date, service period, or another accounting date.

C7.6 therefore MUST NOT infer financial_period_id from delivery_date or document names.

The first safe read model should expose commitment_effective_at = issued_at plus a period_resolution state.

C7.6E approves the following governed attribution policy for Budgeting reads:

- commitment attribution date = commitment_effective_at = purchase_order.issued_at, converted to its PostgreSQL calendar date;
- resolve only against commercial_financial_periods belonging to the same organisation;
- a date that matches exactly one period is RESOLVED;
- a date that matches no period is UNRESOLVED;
- a date that matches more than one period is AMBIGUOUS and must fail loud in the read model rather than choosing one period arbitrarily;
- period boundaries are inclusive (starts_on <= issue date <= ends_on);
- the period's parent commercial_financial_year must belong to the same organisation;
- OPEN and CLOSED periods are both valid historical attribution targets for reads. CLOSED remains a mutation-control boundary, not a reason to erase historical attribution.

This attribution is derived at read time. C7.6E does not add financial_period_id to purchase orders or purchase-order lines and does not create a mutable assignment row.

Period-resolution states are therefore:

- UNRESOLVED
- RESOLVED
- AMBIGUOUS

A later bounded migration may still add a governed attribution/assignment structure if manual overrides or accounting-date adjustments become a real requirement. It should not add financial_period_id directly to the existing PO/PO-line tables merely for convenience.

Closed financial periods must be treated as finance-control boundaries. Any future attribution mutation must not silently move spend into or out of a CLOSED period.

## 7. Budget account / GL boundary

Purchasing already has governed cost centres. Budgeting currently has free-text GL values inside financial_models.line_items JSON.

There is no repository-supported relational key joining a purchase-order line or cost centre to one of those JSON GL lines.

Therefore C7.6 may aggregate by:
- organisation
- PO
- PO line
- effective cost centre
- supplier
- currency
- issued date
- derived commitment state

C7.6 may NOT aggregate into a specific Budget GL/account until a governed relational Budget account model or explicit mapping exists.

No fuzzy/name-based mapping is permitted.

## 8. Legacy financial_models compatibility boundary

financial_models remains untouched in the C7.6 foundation.

Its manual commitments field is legacy forecast input, not Purchasing source-of-truth data.

The current /api/financial routes must not be changed to overwrite that field from Purchasing during the foundation gate.

Before a future switchover, BrainBase needs an explicit reconciliation rule covering:
1. which financial_model line maps to which governed Budget account/cost centre;
2. whether ytd_actual includes supplier-bill/AP facts;
3. the tax basis;
4. the as-at cutoff;
5. treatment of closed periods;
6. how manually entered legacy commitments are retired or preserved.

Without those six rules, adding Purchasing commitments to the existing formula (ytd_actual + commitments) risks either double counting or understating exposure.

## 9. Capability and authorization boundary

Purchasing commitment reads originate from Purchasing facts, but Budget views are a Budgeting capability concern.

The reusable Commercial authorization layer already defines both purchasing and budgeting capability keys.

Recommended boundary:
- Purchasing PO detail may show that PO's derived commitment summary under purchasing/view.
- Cross-PO commitment reporting for Budgeting requires budgeting/view.
- Any future Budget attribution or mapping mutation requires budgeting/administer or a stricter approved role.
- No C7.6 route should use getAuthSession() alone where authorizeCommercialRequest() can enforce session + capability + role.

## 10. Explicitly out of scope for C7.6 foundation

- Purchase Request / requisition entity.
- Supplier payment / AP settlement.
- General ledger posting.
- Cash accounting.
- Accrual journals.
- Automatic Budget GL mapping.
- Editing commitment values directly.
- Configurable receipt/bill tolerance changes.
- Replacing financial_models.
- Persisting commitment snapshots on PO/PO-line rows.
## 11. Required tests before any migration

### A. Pure derived-model tests

1. DRAFT/PENDING_APPROVAL/APPROVED/CANCELLED lines produce NOT_COMMITTED and zero outstanding commitment.
2. ISSUED with zero posted bill value produces OPEN and full ordered commitment.
3. ISSUED with partial posted bill value produces PARTIALLY_CONSUMED and exact remaining cents.
4. ISSUED fully billed produces CONSUMED and zero outstanding commitment.
5. Active billed value above ordered value produces INVALID_OVERBILLED or an explicit integrity error; never silent clamping.
6. CANCELLED supplier bills are excluded.
7. DRAFT supplier bills are excluded.
8. Multiple POSTED supplier bills aggregate exactly.
9. Line cost centre overrides PO cost centre.
10. Missing line cost centre falls back to PO cost centre.
11. Missing both remains unattributed; no invented mapping.
12. Tax/subtotal/total arithmetic remains integer-cents exact.

### B. Tenant-isolation tests

13. Every commitment query scopes organisation_id on PO, line, supplier-bill, and cost-centre joins.
14. A cross-tenant PO id returns no commitment facts.
15. A malformed/cross-tenant source_purchase_order_line_id cannot contribute value.
16. Budget aggregation cannot read another organisation's financial years/periods or cost centres.

### C. Lifecycle/regression tests

17. ISSUED → CANCELLED removes commitment only where the existing PO cancellation guards permit cancellation.
18. Posting a supplier bill reduces outstanding commitment.
19. Cancelling that supplier bill restores the outstanding commitment.
20. Receipt posting/cancellation alone does not change commitment value.
21. Match allocation create/reverse alone does not change commitment value.
22. Existing PO, receipt, bill, and match lifecycle tests remain unchanged and green.

### D. Budget-boundary containment tests

23. No migration adds committed, encumbrance, financial_period_id, received_quantity, billed_quantity, or matched_quantity to commercial_purchase_orders or commercial_purchase_order_lines.
24. No C7.6 code writes financial_models.line_items.commitments.
25. No C7.6 code maps to financial_models JSON GL values by description/name matching.
26. No C7.6 code treats receipt value as actual spend.
27. No C7.6 code treats matched quantity as monetary commitment consumption.
28. No C7.6 code derives a financial period from delivery_date without an approved policy.

### E. Authorization tests

29. PO-local commitment read requires purchasing/view.
30. Cross-PO Budget commitment report requires budgeting/view.
31. Future mapping/attribution mutation requires budgeting/administer or stricter.
32. Missing capability = 403, capability lookup failure = 503, unauthenticated = 401.

### F. Real PostgreSQL proof required before migration

33. Disposable-Postgres fixture proves the derived SQL against actual PO/bill schemas.
34. Concurrent supplier-bill posting cannot create a transient committed value below zero.
35. Supplier-bill cancel vs commitment read resolves to one valid READ COMMITTED snapshot, never mixed-state arithmetic.
36. Migration candidate is idempotent, additive, and does not touch Preview/Production during validation.

## 12. Pre-migration acceptance gate

C7.6 may proceed to a schema proposal only when:
- the derived read-model tests above exist and pass against the current schema;
- the tax-basis policy for Budget reporting is explicitly chosen or the integration remains basis-neutral;
- the period-attribution policy is explicitly chosen or remains UNRESOLVED;
- the Budget account/GL mapping strategy is relational and reviewed;
- legacy financial_models coexistence/double-counting rules are documented;
- no existing Commercial regression breaks.

Only after that gate should a migration be proposed. The preferred migration direction is a separate governed Budget attribution/mapping structure, if one is actually required, rather than adding cached commitment fields to purchase-order tables.
