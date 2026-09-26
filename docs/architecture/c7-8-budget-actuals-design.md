# C7.8 — Governed Budget Actual Source and Accounting Basis

Status: architecture/design gate only. No schema migration, runtime Actual read model, API, UI, Preview, or Production change is authorised by this document.

## 1. Goal

C7.8 defines what BrainBase means by **Actual** for governed Budget reporting so that a future Budget view can safely present:

- Budget;
- Actual;
- Committed;
- Budget less Actual and Committed;
- unresolved/reconciliation exceptions.

The decision must be grounded in facts that already exist in the Commercial platform. It must not claim that BrainBase has a statutory general ledger, accounts-payable subledger, accrual engine, or cash-accounting engine when those systems do not yet exist.

## 2. Repository-grounded facts

BrainBase currently has these relevant purchasing facts:

- commercial_purchase_orders and commercial_purchase_order_lines represent authorised purchasing intent.
- An ISSUED purchase order creates the C7.6 outstanding commitment.
- commercial_supplier_bills are PO-backed and have lifecycle DRAFT -> POSTED -> CANCELLED.
- Supplier-bill lines always reference a concrete source purchase-order line.
- Supplier-bill lines persist their own invoiced subtotal, tax, and total values.
- A supplier bill becomes POSTED only through the governed posting transition.
- Posting sets posted_at = now() and freezes the supplier snapshot.
- The supplier-bill schema and domain explicitly describe a POSTED bill as a real payable fact.
- DRAFT bills are editable and therefore are not financial Actual facts.
- CANCELLED bills no longer contribute to C7.6 billed-to-date.
- bill_date exists but is nullable and is user-supplied.
- Purchasing does not yet have supplier-payment settlement state.
- commercial_payments is currently the customer-receipts model for Commercial invoices. It is not supplier/AP payment data.
- There is no governed general-ledger journal table linking Purchasing to statutory expense accounts.
- Receipts and receipt/bill matches are reconciliation facts, not monetary Actual facts.
- The legacy financial_models.line_items[].ytd_actual value is JSON/manual/metrics-derived and is not relationally mapped to governed Budget accounts and cost centres.

Therefore BrainBase has one governed purchasing event that is both monetary and final enough for current Budget reporting: **supplier-bill posting**.

## 3. C7.8 accounting-basis decision

### 3.1 Selected basis

For BrainBase Budgeting, **Actual** means:

> the value of a supplier-bill line belonging to a supplier bill whose current lifecycle status is POSTED.

This is the **BrainBase operational payable basis**.

It is a Budget-management basis, not a claim of statutory accounting treatment.

A POSTED bill represents an accepted payable fact inside BrainBase. Once posted, its line values are immutable through normal editing; correction is performed by cancelling the bill, not rewriting the posted fact.

### 3.2 What this basis is not

C7.8 Actual is explicitly **not**:

- purchase-order issue value;
- purchase receipt value;
- matched receipt value;
- supplier cash payment;
- customer receipt/payment;
- bank transaction;
- statutory general-ledger expense;
- accounting journal posting;
- tax-return/GST recognition;
- accrual based on goods-received date;
- an estimate from legacy financial_models.ytd_actual.

User-facing language must prefer **Budget Actual** or **Posted supplier-bill Actual** where context could otherwise imply statutory ledger Actuals.

## 4. Actual grain and source fields

The base Actual grain is one commercial_supplier_bill_lines row.

For each eligible line:

- actual_source_type = SUPPLIER_BILL_LINE;
- actual_source_id = supplier_bill_line.id;
- supplier_bill_id = supplier_bill.id;
- source_purchase_order_line_id = supplier_bill_line.source_purchase_order_line_id;
- actual_subtotal_cents = supplier_bill_line.line_subtotal_cents;
- actual_tax_cents = supplier_bill_line.line_tax_cents;
- actual_total_cents = supplier_bill_line.line_total_cents;
- actual_currency = supplier_bill.currency;
- actual_recognised_at = supplier_bill.posted_at;
- actual_status = supplier_bill.status.

Only supplier_bill.status = POSTED contributes Actual.

DRAFT and CANCELLED contribute zero Actual.

No mutable actual_cents cache is added to purchase orders, purchase-order lines, Budget lines, or supplier bills.

## 5. Recognition date and financial-period attribution

### 5.1 Approved recognition date

C7.8 approves:

> actual_recognised_at = commercial_supplier_bills.posted_at.

Reasons:

1. posted_at is produced by the governed DRAFT -> POSTED transition;
2. it is non-null for a successfully POSTED bill;
3. it records when BrainBase accepted the bill as a payable fact;
4. it is not client-selected;
5. it is already lifecycle-audited;
6. it avoids silently inventing accounting semantics for nullable bill_date.

bill_date remains supplier-document metadata. It is not the Budget Actual recognition date in C7.8.

### 5.2 Period resolution

The calendar date of posted_at is resolved against commercial_financial_periods using the same governed rules already established for C7.6 attribution:

- tenant must match;
- inclusive boundaries: starts_on <= actual date <= ends_on;
- exactly one matching period -> RESOLVED;
- zero matching periods -> UNRESOLVED;
- more than one matching period -> AMBIGUOUS;
- the matched period's parent financial year must belong to the same organisation;
- OPEN and CLOSED periods are both valid historical read targets.

C7.8 does not mutate a POSTED bill merely because its resolved period is CLOSED.

Any future manual reclassification/backdating workflow is a separate controlled accounting feature and must not rewrite posted_at.

## 6. Cost-centre attribution

A supplier-bill line does not carry its own governed cost-centre dimension.

C7.8 therefore follows its structural lineage to the source purchase-order line and uses the same effective cost-centre rule as C7.6:

> effective_cost_centre_id = COALESCE(purchase_order_line.cost_centre_id, purchase_order.cost_centre_id).

This is deterministic because every supplier-bill line must reference a source purchase-order line.

If neither the PO line nor PO header has a cost centre, the Actual is UNATTRIBUTED_COST_CENTRE.

C7.8 must not infer a cost centre from supplier, description, product, receipt, user, or display text.


## 7. Budget-account attribution

C7.8 uses the governed C7.7 Budget account model. It does not create a second account-classification mechanism for Actuals.

For reporting against an ACTIVE Budget version:

1. resolve the Actual's effective cost centre;
2. resolve the Budget identity by Actual financial year and currency;
3. require an ACTIVE Budget version;
4. use that version's explicit commercial_budget_commitment_mappings cost-centre -> Budget-account mapping;
5. require the matching commercial_budget_lines row for that account x cost-centre pair.

The same version-scoped mapping is therefore used for both:

- outstanding Purchasing commitment classification; and
- POSTED supplier-bill Actual classification.

This keeps Budget account treatment internally consistent across the commitment-to-Actual transition.

C7.8 does not infer a Budget account from:

- supplier;
- product;
- PO description;
- supplier-bill description;
- tax code;
- receipt match;
- legacy GL text;
- fuzzy/name matching.

If no mapping exists, the Actual is UNMAPPED_ACCOUNT.

If data drift produces more than one applicable mapping, the Actual is AMBIGUOUS_ACCOUNT and must not be forced into a Budget line.

If the mapping resolves but the active Budget version has no matching Budget line, the Actual is NO_BUDGET_LINE.

### 7.1 Historical classification boundary

This first C7.8 model is a **current ACTIVE-Budget reporting model**.

That means historical supplier-bill facts are classified through the mapping rules of the currently ACTIVE Budget version being reported, just as C7.7 commitments are.

C7.8 does not yet snapshot a Budget account onto supplier-bill lines.

If BrainBase later needs immutable historical classification by the Budget version that was active when the bill was posted, that requires an explicit attribution ledger/snapshot design. It must not be fabricated retroactively from display text.

## 8. Currency policy

Supplier bills inherit Purchasing currency and are PO-backed.

Budget matching therefore requires:

- Actual financial year match; and
- exact Actual currency == Budget currency.

No FX conversion is performed.

If a Budget exists for the financial year but not for the Actual currency, the Actual is CURRENCY_MISMATCH.

If no matching Budget identity/ACTIVE version exists, the Actual is NO_ACTIVE_BUDGET.

Currencies are never summed into a single monetary total.

## 9. Tax-basis policy

C7.7 already makes tax basis a property of the Budget:

- EXCLUSIVE;
- INCLUSIVE.

C7.8 uses that same policy for Actuals.

For an EXCLUSIVE Budget:

> actual_consumption_cents = supplier_bill_line.line_subtotal_cents.

For an INCLUSIVE Budget:

> actual_consumption_cents = supplier_bill_line.line_total_cents.

The tax component remains available separately as line_tax_cents for explanation/reconciliation.

This means Budget, Actual, and Committed are compared on one consistent basis for a given Budget.

C7.8 does not infer GST recoverability, input-tax credits, tax-return treatment, or statutory expense basis.

## 10. Relationship between Actual and Committed

C7.6 already defines outstanding commitment as:

> ordered value - POSTED supplier-bill value.

C7.8 selects those same POSTED supplier-bill line values as Budget Actuals.

Therefore, when the same Budget tax basis and classification resolve correctly:

> purchasing_exposure = actual_cents + outstanding_commitment_cents.

For a simple PO line this preserves the authorised purchasing exposure as supplier bills are posted:

- before billing: Actual = 0; Committed = full ordered value;
- partial billing: Actual rises by posted billed value; Committed falls by the same billed value;
- fully billed: Actual = full posted billed value; Committed = 0.

This is the core anti-double-counting rule.

BrainBase must never add POSTED billed value on top of the pre-bill full PO commitment.

### 10.1 Cancellation

When a POSTED supplier bill is CANCELLED:

- its lines stop contributing to Actual;
- the same bill lines stop contributing to C7.6 billed-to-date;
- outstanding commitment is restored by the existing C7.6 derivation.

So cancellation moves value from Actual back to Committed without inventing a separate reversal amount.

This is a derived read-model effect. C7.8 does not create reversal rows in the Budget tables.

## 11. Budget vs Actual vs Committed formulas

At a resolved Budget line/reporting grain:

- budget_cents = annual Budget line amount, or explicit period allocation for PERIODISED Budget reporting;
- actual_cents = sum of eligible POSTED supplier-bill Actuals on the Budget's tax basis;
- committed_cents = sum of C7.6 outstanding commitments on the same Budget tax basis;
- exposure_cents = actual_cents + committed_cents;
- budget_less_actual_cents = budget_cents - actual_cents;
- budget_less_actual_and_committed_cents = budget_cents - actual_cents - committed_cents.

Once C7.8 is implemented, the C7.7F provisional label "Budget less commitments" may remain available as a secondary planning measure, but it must no longer be presented as the principal remaining-Budget measure.

The primary planning measure becomes:

> Budget less Actual and Committed.

BrainBase must still avoid calling this "cash remaining" or "ledger balance".

## 12. Annual-only versus periodised reporting

For ANNUAL_ONLY Budgets:

- Actuals still resolve to financial periods for diagnostics/history;
- Budget comparison uses annual_budget_cents;
- no synthetic monthly Budget allocation is invented.

For PERIODISED Budgets:

- a RESOLVED Actual consumes the explicit Budget allocation for its resolved financial period;
- UNRESOLVED or AMBIGUOUS Actuals remain outside period totals and appear in the exception queue;
- annual roll-up may still include only dimensions that can be resolved safely to the governed Budget identity/account/cost centre.

A future "unallocated annual catch-all" is not authorised by C7.8.

## 13. Actual exception/reconciliation states

C7.8 requires explicit fail-loud states.

### Period/dimension states

- UNRESOLVED_PERIOD — posted_at matches no governed financial period.
- AMBIGUOUS_PERIOD — posted_at matches more than one governed financial period.
- UNATTRIBUTED_COST_CENTRE — no effective PO/PO-line cost centre.
- UNMAPPED_ACCOUNT — no version-scoped cost-centre -> Budget-account mapping.
- AMBIGUOUS_ACCOUNT — more than one applicable mapping due to drift/corruption.
- NO_BUDGET_LINE — mapping resolves but the ACTIVE Budget version lacks the required account x cost-centre Budget line.
- NO_ACTIVE_BUDGET — no exact financial-year/currency Budget with a valid ACTIVE version.
- CURRENCY_MISMATCH — Budget identity exists for the year, but not for the Actual currency.

### Source-integrity states

A future implementation should also fail loudly when source integrity contradicts the C7.8 contract, for example:

- POSTED bill with null posted_at;
- supplier-bill currency inconsistent with its source PO;
- supplier-bill line whose source PO line cannot be resolved in the same tenant;
- unsafe integer money value;
- duplicate active Budget identity/version drift.

No exception may be silently assigned to an "Other" account or omitted from reconciliation totals.

## 14. Authorization boundary

C7.8 Actual reporting is a Budgeting capability concern.

Recommended authorization:

- Budget Actual / Budget vs Actual vs Committed reads: budgeting/view;
- Budget mapping/version controls remain under C7.7 rules;
- any future Actual attribution override/manual accounting-date adjustment: budgeting/administer or stricter;
- supplier-bill posting/cancellation remains governed by Purchasing authorization and is not duplicated in Budgeting.

Request-provided organisation IDs must never override the authenticated session tenant.

## 15. Legacy financial_models boundary

financial_models.line_items[].ytd_actual is not the C7.8 Actual source.

C7.8 must not:

- copy POSTED supplier-bill Actuals into legacy ytd_actual;
- add legacy ytd_actual to governed supplier-bill Actuals;
- map legacy GL text onto Budget accounts by name;
- assume legacy ytd_actual excludes supplier bills;
- use the legacy forecast multiplier to alter governed Actuals.

Until a later reconciliation/migration phase proves otherwise, legacy financial_models and governed C7.8 Actual reporting are separate finance surfaces.

A future legacy switchover must explicitly reconcile:

1. legacy GL/text -> governed Budget account/cost-centre mapping;
2. legacy ytd_actual source lineage;
3. tax basis;
4. recognition/cutoff date;
5. closed-period treatment;
6. duplicates against supplier-bill Actuals;
7. historical values that cannot be traced to governed source facts.

## 16. Why cash payment is not the selected Actual source

Supplier/AP settlement is not yet modeled in Purchasing.

The existing commercial_payments tables record customer receipts against sales invoices. They are accounts-receivable facts and cannot represent supplier expense payment.

Using customer-payment records as Budget Actual would be a category error.

Even after supplier payment support exists, cash settlement would answer "when did cash leave?" rather than "when did BrainBase recognise the payable Budget Actual?". A future cash-flow report may legitimately use supplier payment facts, but it must remain distinct from the C7.8 operational payable Actual.

## 17. Why purchase receipt is not the selected Actual source

A receipt proves goods/services were received, not the supplier's accepted invoiced monetary amount.

Current receipt rows do not provide the governed payable value/tax basis that supplier-bill lines provide.

Therefore:

- receipt posting does not create Budget Actual;
- receipt cancellation does not directly reverse Budget Actual;
- match allocation does not create Budget Actual;
- receipt/bill matching remains reconciliation evidence.

## 18. Why bill_date is not the recognition date

bill_date is useful supplier-document metadata but is nullable and client-entered.

Choosing bill_date would create inconsistent period attribution when:

- the date is absent;
- the date is entered incorrectly;
- an old invoice is entered after a period is closed;
- a bill is drafted in one period and governed posting occurs in another.

C7.8 therefore uses posted_at for the first governed Actual model.

A later accounting integration may introduce a controlled accounting_date distinct from both bill_date and posted_at. Such a field would require explicit permissions, closed-period rules, audit, and migration. C7.8 does not pre-empt that design.


## 19. Required derived read-model output

A future C7.8 derived Actual read model should expose, at minimum, one row per eligible supplier-bill line with:

- supplier bill id/number;
- supplier-bill line id;
- source PO / PO-line lineage;
- supplier id/name snapshot;
- posted_at / actual_recognised_at;
- period resolution;
- financial year/period id and display name where resolved;
- effective cost centre;
- Budget identity/version where resolved;
- Budget account where resolved;
- currency;
- tax basis;
- subtotal/tax/total source amounts;
- Budget-basis actual_cents;
- source status;
- exception state where unresolved.

The aggregate Budget consumption model should combine this with C7.7E commitments only after both streams are resolved to the same:

- ACTIVE Budget/version;
- Budget account;
- cost centre;
- financial year/period;
- currency;
- tax basis.

## 20. Snapshot/concurrency rules

Budget Actual is derived from current committed database state.

Reads must never construct mixed-state arithmetic such as:

- commitment read before bill POST commits plus Actual read after it commits;
- Actual read before CANCEL commits plus commitment read after CANCEL commits.

A combined Budget vs Actual vs Committed read should use one transaction/snapshot boundary when retrieving the underlying Actual and commitment facts, or another design with equivalent snapshot consistency.

Required property:

> every report response must correspond to one valid committed database state.

A supplier-bill POST or CANCEL racing a Budget report may result in either the before-state or after-state, but never a hybrid that double-counts or drops the transitioned amount.

## 21. No schema migration required for the first read model

The first C7.8 implementation does not require new persistent Actual columns.

Existing source facts already provide:

- supplier-bill lifecycle;
- posted_at;
- line subtotal/tax/total;
- PO-line lineage;
- currency;
- tenant ids;
- C7.7 Budget mappings and Budget lines;
- financial-period authority.

Therefore the preferred first implementation is a derived read model plus tests.

A schema proposal is justified only if a later requirement needs:

- controlled accounting-date override;
- immutable historical Budget-account attribution;
- external GL/journal source ids;
- supplier-payment settlement;
- manual adjustment journals;
- imported Actuals outside Purchasing.

## 22. Required tests before runtime rollout

### A. Pure Actual derivation

1. DRAFT supplier bill contributes zero Actual.
2. POSTED supplier bill contributes exact line values.
3. CANCELLED supplier bill contributes zero Actual.
4. multiple POSTED bills aggregate exactly.
5. EXCLUSIVE Budget uses line_subtotal_cents.
6. INCLUSIVE Budget uses line_total_cents.
7. line_tax_cents remains separately explainable.
8. bill_date never drives C7.8 period attribution.
9. posted_at is the recognition timestamp.
10. unsafe integer money fails loud.

### B. Period attribution

11. posted_at date matching exactly one same-tenant period is RESOLVED.
12. no matching period is UNRESOLVED_PERIOD.
13. overlapping same-tenant periods produce AMBIGUOUS_PERIOD.
14. period boundaries are inclusive.
15. CLOSED period is a valid historical read target.
16. cross-tenant period is never used.

### C. Budget classification

17. PO-line cost centre overrides PO header cost centre.
18. PO header cost centre is fallback.
19. missing both is UNATTRIBUTED_COST_CENTRE.
20. exact ACTIVE Budget financial-year + currency match is required.
21. no ACTIVE version is NO_ACTIVE_BUDGET.
22. other-currency Budget is CURRENCY_MISMATCH.
23. current ACTIVE-version mapping resolves Budget account.
24. missing mapping is UNMAPPED_ACCOUNT.
25. ambiguous mapping is AMBIGUOUS_ACCOUNT.
26. missing account x cost-centre Budget line is NO_BUDGET_LINE.
27. no supplier/product/description/legacy-GL inference occurs.

### D. Actual + commitment anti-double-counting

28. unbilled issued PO: Actual 0 + Committed full order.
29. partial POSTED bill: Actual rises by posted value and Committed falls by exactly the same Budget-basis value.
30. fully billed PO: Actual equals posted billed value and Committed is zero.
31. cancelling a POSTED bill removes its Actual and restores the matching commitment.
32. receipt posting/cancellation alone changes neither Actual nor monetary commitment.
33. match allocation create/reverse alone changes neither Actual nor monetary commitment.
34. Actual + Committed does not double-count POSTED billed value.

### E. Snapshot/concurrency

35. supplier-bill POST racing combined report returns one valid before/after state, never Actual + pre-post commitment.
36. supplier-bill CANCEL racing combined report returns one valid before/after state, never zero Actual + post-cancel-missing commitment.
37. concurrent report reads stay tenant-scoped.
38. disposable PostgreSQL proves the combined arithmetic against real schemas.

### F. Authorization/containment

39. Budget Actual read requires budgeting/view.
40. request tenant cannot override session tenant.
41. no C7.8 code writes financial_models.ytd_actual.
42. no C7.8 code reads commercial_payments as supplier Actual.
43. no C7.8 code labels receipt/match value as Actual.
44. no C7.8 migration adds actual/paid/payment cache columns to PO/PO-line tables.
45. no automatic FX conversion occurs.

## 23. Recommended implementation sequence

### C7.8A — derived Actual domain model

Implement tenant-scoped POSTED supplier-bill-line Actual derivation with:

- posted_at period attribution;
- source subtotal/tax/total;
- effective cost centre;
- explicit exception states;
- pure derivation/containment tests.

No migration.

### C7.8B — Budget classification

Resolve C7.8A Actuals into ACTIVE C7.7 Budget/version/account/line using:

- exact financial year/currency;
- version-scoped mapping;
- Budget tax basis;
- ANNUAL_ONLY/PERIODISED rules;
- explicit exception queue.

No legacy financial_models integration.

### C7.8C — combined snapshot-safe consumption model

Create the governed Budget vs Actual vs Committed read model and prove:

- Actual + Committed anti-double-counting;
- POST/CANCEL concurrency;
- tenant isolation;
- one valid snapshot per response.

Disposable PostgreSQL proof is mandatory.

### C7.8D — budgeting/view API + UI

Replace the provisional C7.7F planning presentation with:

- Budget;
- Actual;
- Committed;
- Budget less Actual;
- Budget less Actual and Committed;
- exception/reconciliation queue;
- clear "operational payable basis" disclosure.

## 24. Acceptance gate

C7.8 is ready for runtime implementation only when all of the following remain true:

- Actual source is POSTED supplier-bill lines only;
- recognition date is posted_at;
- bill_date is metadata only;
- DRAFT/CANCELLED supplier bills are excluded;
- Actual uses the ACTIVE Budget tax basis;
- Actual and Committed use the same cost-centre/account classification rules;
- Actual + Committed is proven free of billed-value double counting;
- unresolved/ambiguous facts remain visible;
- currencies never combine;
- legacy financial_models.ytd_actual is untouched;
- customer commercial_payments are not treated as supplier Actuals;
- reporting is explicitly non-statutory and non-cash;
- no hosted database is required to validate the design.

## 25. Decision summary

C7.8 adopts a deliberately bounded definition:

> **BrainBase Budget Actual = POSTED supplier-bill-line value, recognised on supplier_bill.posted_at, classified through the currently ACTIVE C7.7 Budget version, using that Budget's explicit tax basis.**

This gives BrainBase a governed and auditable Budget-management Actual source using facts the platform already owns.

It does not turn BrainBase into a statutory accounting ledger.

A future accounting/ERP integration can supersede or reconcile this operational payable basis through an explicit governed source hierarchy; it must not silently change the meaning of historical C7.8 reports.
