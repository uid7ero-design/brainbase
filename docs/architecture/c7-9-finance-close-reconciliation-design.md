# C7.9 — Finance Reconciliation and Close-Control Design

Status: architecture/design gate only.

C7.9 defines how BrainBase moves from C7.8 operational payable reporting toward controlled finance-period close and external general-ledger reconciliation without rewriting source facts or claiming statutory-ledger authority it does not yet possess.

This phase does **not** authorise schema, API, UI, hosted-database, or Production changes.

## 1. Existing governed foundation

C7.8 established:

- Budget Actual source = POSTED supplier-bill-line value;
- recognition timestamp = supplier_bill.posted_at;
- Budget tax basis determines EXCLUSIVE versus INCLUSIVE consumption;
- Actual + outstanding Commitment is snapshot-safe;
- Budget reporting is operational payable-basis, not statutory GL or cash accounting.

Current financial periods have only OPEN/CLOSED state.
The existing status mutation:

- is tenant-scoped;
- is human initiated;
- emits a best-effort audit event;
- does not seal source data;
- does not block supplier-bill posting;
- can currently move CLOSED back to OPEN without a separate reopen reason/control;
- does not create a close snapshot, control total, or reconciliation sign-off.

Therefore C7.9 treats today's CLOSED flag as the starting primitive, not a complete accounting close.

## 2. Core source-fact rule

C7.9 preserves one non-negotiable rule:

> Source commercial facts are never backdated or rewritten to make accounting reconciliation easier.

Specifically:

- supplier_bill.posted_at is immutable recognition evidence for the C7.8 operational payable source;
- bill_date remains supplier-document metadata;
- PO issue timestamps remain purchasing facts;
- receipt timestamps remain receiving facts;
- external GL dates remain external-source facts.

C7.9 must not mutate any of those dates as a period-close workaround.
## 3. Accounting-date override decision

C7.9 does **not** approve a mutable accounting_date column on supplier bills.

A direct override column would create several problems:

1. changing it would rewrite the period meaning of an already-posted source fact;
2. historical reports could silently change after close;
3. source evidence and accounting treatment would become conflated;
4. concurrent close/reopen operations would be difficult to prove;
5. external-GL reconciliation could not distinguish original posting from later reclassification.

If BrainBase later needs an accounting-effective date, it must be represented through an append-only controlled finance entry, not by editing posted_at or a mutable supplier-bill accounting_date.

The UI may eventually display an **effective finance period**, but that value must be derived from source facts plus governed append-only adjustments.

## 4. Closed-period semantics

A financially CLOSED period is a sealed attribution period.

Once CLOSED:

- no new finance adjustment may target it;
- no existing adjustment may be edited or deleted;
- no Budget Actual source may be retrospectively reclassified into it;
- no Budget version activation may alter the historical closed-period classification;
- reconciliation sign-off for that close remains historically inspectable.

Ordinary supplier-bill posting remains a Purchasing operation and is not blocked merely because bill_date refers to a closed period.
Because C7.8 recognition is posted_at, a late bill posted today belongs to the period containing today's governed posted_at date.

A CLOSED historical period therefore remains stable unless it is explicitly reopened.

Historical reads may continue to resolve source facts against CLOSED periods.

## 5. Late supplier bills

A **late supplier bill** means a supplier bill whose document date or commercial service context refers to an earlier period but whose governed POST occurs later.

Default C7.9 treatment:

1. preserve bill_date as supplier metadata;
2. set posted_at only through the normal POST transition;
3. recognise the operational payable Actual in the period containing posted_at;
4. flag the bill for finance reconciliation when bill_date falls in a different or CLOSED period;
5. do not automatically backdate;
6. do not reopen a period automatically;
7. do not fabricate an accrual.

Recommended exception state:

- LATE_BILL_PRIOR_PERIOD — bill_date is in an earlier governed financial period than posted_at;
- LATE_BILL_CLOSED_PERIOD — bill_date resolves to a CLOSED prior period.

These are reconciliation signals, not changes to Actual arithmetic.
## 6. Exceptional prior-period correction

If finance determines that historical Budget presentation must change, C7.9 requires an explicit controlled process.

There are two allowed paths:

### A. Keep the prior period closed

Preferred for ordinary late bills.

- source Actual remains in the posting period;
- an explanatory finance adjustment may be recorded in an OPEN period;
- the adjustment references the affected prior period and source fact;
- historical CLOSED-period numbers do not change.

### B. Explicitly reopen the prior period

Reserved for exceptional correction.

Reopening must be an administer-level finance operation with:

- mandatory reason;
- actor;
- timestamp;
- affected period;
- prior close identifier/version;
- downstream-reconciliation warning;
- transactional audit/control record.

Reopening invalidates the prior close sign-off until the period is reclosed.
A reopened period can then accept a governed finance adjustment. Source supplier-bill posted_at still does not change.

## 7. Append-only finance adjustment journal

C7.9 selects an **append-only adjustment journal** as the correct future mechanism.

Proposed table:

commercial_finance_adjustments

Core fields:

- id UUID;
- organisation_id;
- adjustment_number or immutable sequence;
- status DRAFT | POSTED | REVERSED;
- adjustment_type;
- effective_financial_period_id;
- reference_financial_period_id nullable;
- currency;
- description;
- reason_code;
- source_type nullable;
- source_id nullable;
- created_by / created_at;
- posted_by / posted_at;
- reversed_by / reversed_at;
- reversal_of_adjustment_id nullable.

POSTED rows are immutable.
Corrections use reversal + replacement, never UPDATE of posted monetary content.

Suggested adjustment types:

- PRIOR_PERIOD_RECLASSIFICATION;
- BUDGET_CLASSIFICATION_CORRECTION;
- EXTERNAL_GL_TRUE_UP;
- MANUAL_FINANCE_ADJUSTMENT.

C7.9 does not yet authorise arbitrary free-form statutory journals.

## 8. Adjustment lines

Proposed table:

commercial_finance_adjustment_lines

Each line carries explicit governed dimensions:

- adjustment_id;
- organisation_id;
- financial_period_id;
- budget_account_id;
- cost_centre_id;
- currency inherited or validated against header;
- amount_exclusive_cents;
- tax_cents;
- amount_inclusive_cents;
- direction DEBIT | CREDIT, or signed amount under one consistently documented convention;
- source_supplier_bill_line_id nullable;
- external_gl_account_mapping_id nullable;
- narrative.

C7.9B fixes the sign convention as signed BIGINT minor units at the line level: positive amounts increase effective Budget Actual and negative amounts reduce it. There is no separate debit/credit flag that could disagree with the stored sign.

Each line must satisfy amount_inclusive_cents = amount_exclusive_cents + tax_cents. PRIOR_PERIOD_RECLASSIFICATION and BUDGET_CLASSIFICATION_CORRECTION journals must net to exactly zero across exclusive, tax, and inclusive amounts before POST. EXTERNAL_GL_TRUE_UP and MANUAL_FINANCE_ADJUSTMENT may carry a non-zero net Budget effect.

No floating-point finance arithmetic is permitted.

## 9. Reclassification mechanics

A prior-period reclassification must be explicit and balanced for BrainBase Budget reporting.

Example:

A $1,100 inclusive supplier-bill Actual was legitimately posted in September, but finance approves moving Budget presentation to August after reopening August.

The adjustment journal records:

- CREDIT September Budget account/cost centre: 1,100;
- DEBIT August Budget account/cost centre: 1,100.

The source supplier-bill line remains unchanged.

The read model becomes:

> effective Budget Actual = source payable Actual + POSTED finance adjustment lines.

This preserves both original source recognition and later finance treatment.

If August stays CLOSED, the correction cannot target August. It must remain a current/open-period adjustment with a reference to August.
## 10. Close record versus period status

A robust close needs a durable close record, not only status='CLOSED'.

Proposed table:

commercial_financial_period_closes

Fields:

- id UUID;
- organisation_id;
- financial_period_id;
- close_sequence integer;
- status CLOSED | INVALIDATED;
- closed_by;
- closed_at;
- close_reason / notes;
- control_totals JSONB or structured child rows;
- reconciliation_status;
- invalidated_by nullable;
- invalidated_at nullable;
- invalidation_reason nullable.

UNIQUE(financial_period_id, close_sequence).

Only one non-invalidated current close per period.

The close record is append-only history; reopening invalidates the current close rather than deleting it.
## 11. Atomic close transaction

A future close operation must execute in one database transaction:

1. lock the financial period row;
2. verify tenant;
3. require current status OPEN;
4. verify parent financial year is valid for close;
5. verify no unresolved period-overlap integrity problem;
6. verify no DRAFT finance adjustments intended for the period;
7. calculate close control totals from one database snapshot;
8. capture reconciliation state;
9. insert immutable close record;
10. set financial period status CLOSED;
11. write transactional finance-control audit evidence.

A best-effort audit event alone is insufficient for close integrity.

The existing generic audit_logs event may still be emitted for observability, but the finance close record is the durable control evidence.
## 12. Reopen transaction

A future reopen operation must:

1. require budgeting/administer or stricter finance permission;
2. require a non-empty reason;
3. lock the period and current close record;
4. verify CLOSED state;
5. invalidate the active close record;
6. set period OPEN;
7. record actor/time/reason transactionally;
8. mark any external-GL reconciliation sign-off dependent on that close as stale/requires-review.

Reopen must never erase the old close.

Automatic reopen is prohibited.

## 13. Financial-year close

Closing a financial year is stronger than closing one period.

A year may close only when:

- every governed child period is CLOSED;
- no child close is invalidated without replacement;
- no unresolved adjustment draft targets the year;
- required external-GL reconciliation state meets policy;
- Budget versions required for historical reporting are stable.

Year reopen similarly requires explicit controlled invalidation.
## 14. External GL authority boundary

BrainBase C7.8 remains the authority for its own operational payable facts.

An external GL/accounting system is authoritative for imported statutory ledger entries once configured as a governed integration.

Neither system silently overwrites the other.

Reconciliation compares two immutable fact sets:

- BrainBase source Actual + finance adjustments;
- external GL journal/transaction facts.

Differences are explicit reconciliation outcomes.

## 15. External GL account mapping

Budget account is not statutory GL account.

C7.9 requires explicit mapping.

Proposed table:

commercial_external_gl_account_mappings

Fields:

- id;
- organisation_id;
- integration/source_system_id;
- external_gl_account_code;
- external_gl_account_name nullable;
- budget_account_id;
- effective_from;
- effective_to nullable;
- status ACTIVE | RETIRED;
- created_by/timestamps.

No fuzzy matching.
No mapping by supplier, description, or display-name similarity.

Mappings are version/effective-date controlled so historical reconciliation can reproduce the rule used at the time.

Cost-centre/dimension mapping must likewise be explicit if the external GL uses different dimension codes.

## 16. External GL imported facts

Do not write imported GL totals directly into Budget lines.

Preferred governed imported structure:

commercial_external_gl_entries

Minimum fields:

- id;
- organisation_id;
- source_system_id;
- external_entry_id;
- external_journal_id nullable;
- external_account_code;
- external_cost_centre_code nullable;
- transaction_date;
- accounting_period_key nullable;
- description;
- currency;
- amount_minor_units;
- imported_at;
- source_payload_hash / lineage id.

UNIQUE(org, source_system, external_entry_id).
Imported GL entries are immutable source observations. A changed external record creates governed version/observation history or a replacement record under the Data Hub reconciliation pattern; it is not silently overwritten.

## 17. Reconciliation grain

The default C7.9 reconciliation grain is:

- organisation;
- financial period;
- currency;
- explicit Budget-account <-> GL-account mapping;
- explicit cost-centre/dimension mapping where applicable.

Metrics:

- BrainBase source Actual;
- BrainBase finance adjustments;
- BrainBase effective Actual;
- external GL amount;
- variance;
- matched/unmatched source counts;
- unresolved mapping counts.

No cross-currency reconciliation without an explicit FX policy, which is out of scope.
## 18. Reconciliation outcomes

Recommended states:

- RECONCILED — exact amount and required dimensions agree;
- VARIANCE — mapped totals differ;
- UNMAPPED_BRAINBASE_ACCOUNT;
- UNMAPPED_EXTERNAL_GL_ACCOUNT;
- UNMAPPED_COST_CENTRE;
- MISSING_EXTERNAL_ENTRY;
- EXTERNAL_ONLY_ENTRY;
- CURRENCY_MISMATCH;
- PERIOD_MISMATCH;
- STALE_AFTER_REOPEN.

Tolerance is **zero cents by default**.

Any future tolerance policy must be explicit, tenant-configured, audited, and surfaced; it must not be silently introduced.

## 19. Reconciliation sign-off

A period may have a reconciliation result before close, but close sign-off requires a durable snapshot.

Proposed table:

commercial_finance_reconciliations

Fields:

- id;
- organisation_id;
- financial_period_id;
- close_id nullable until final close;
- source_system_id;
- status;
- brainbase_total_cents;
- external_gl_total_cents;
- variance_cents;
- currency;
- unresolved_item_count;
- prepared_by / prepared_at;
- reviewed_by / reviewed_at;
- notes.

A reconciliation can be recalculated while OPEN.

Once attached to a valid close, its signed-off snapshot is immutable.

Reopening makes that sign-off stale; it is never deleted.

## 20. Late external GL entries

If an external GL later changes a CLOSED period:

- BrainBase does not silently mutate the closed reconciliation;
- import records the new external fact/observation;
- reconciliation becomes STALE_AFTER_EXTERNAL_CHANGE;
- finance must choose whether to reopen/reclose or accept a current-period true-up according to policy.

The external change must remain traceable to source lineage.

## 21. Historical Budget version integrity

C7.8 currently classifies historical source Actuals through the currently ACTIVE Budget version.

That is adequate for the current operational report but not sufficient for immutable closed-period finance history.

C7.9 therefore requires close snapshots to freeze the reporting dimensions used at close, either by:

- storing close-time resolved Budget/account/cost-centre totals; or
- storing immutable attribution records tied to the Budget version used.

C7.9 prefers immutable attribution/snapshot records over depending on whichever Budget version is ACTIVE later.
A later C7.9 implementation phase must choose the exact physical model before declaring closed-period reports reproducible.

## 22. Authorization

Recommended floors:

- view close/reconciliation state: budgeting/view;
- prepare reconciliation/draft adjustments: budgeting/createEdit (manager);
- post finance adjustment: budgeting/administer (admin);
- close period: budgeting/administer (admin);
- reopen period: budgeting/administer plus mandatory reason;
- change external GL mappings: budgeting/administer.

If a future dedicated Finance capability is introduced, these controls may migrate to it through an explicit authorization ADR.

Session remains the sole tenant source.

## 23. Audit requirements

Finance-control events require stronger durability than ordinary best-effort activity audit.

At minimum:

- finance_adjustment.created;
- finance_adjustment.posted;
- finance_adjustment.reversed;
- financial_period.closed;
- financial_period.reopened;
- finance_reconciliation.prepared;
- finance_reconciliation.reviewed;
- external_gl_mapping.created/retired.

Close/reopen/post/reverse control evidence must be transactionally durable with the underlying state change.
Generic audit_logs may mirror those events, but cannot be the sole source of truth for close state.

## 24. Reporting semantics after C7.9

C7.8 operational payable reporting remains available as a source view.

A C7.9 finance-adjusted Budget view should distinguish:

- Source Actual — POSTED supplier-bill value;
- Finance adjustments — append-only posted adjustment value;
- Effective Actual — Source Actual + Finance adjustments;
- Committed — C7.6 outstanding commitment;
- Exposure — Effective Actual + Committed;
- External GL Actual — reconciled statutory source when available;
- Reconciliation variance.

Do not collapse these into one unlabeled "Actual" when an external GL is connected.

## 25. Migration direction

Preferred future additive migrations:

- scripts/create-commercial-finance-close.sql;
- commercial_financial_period_closes;
- commercial_finance_adjustments;
- commercial_finance_adjustment_lines;
- commercial_external_gl_account_mappings;
- commercial_external_gl_entries or governed Data Hub-backed equivalent;
- commercial_finance_reconciliations.

No prisma db push.
No destructive change to supplier bills, Budget tables, legacy financial_models, or C7.8 source facts.

Do not add mutable accounting_date to commercial_supplier_bills.

## 26. Implementation sequence

### C7.9A — close-state hardening design/migration

- durable period-close history;
- transactional close/reopen;
- mandatory reopen reason;
- containment + disposable Postgres concurrency tests.

### C7.9B — append-only adjustment journal

- DRAFT/POSTED/REVERSED lifecycle;
- signed BIGINT lines;
- closed-period target enforcement;
- reversal rather than mutation;
- Budget classification and tax-basis handling.

### C7.9C — late-bill detection and finance exceptions

- LATE_BILL_PRIOR_PERIOD;
- LATE_BILL_CLOSED_PERIOD;
- no automatic backdating;
- current/open period remains default recognition.
### C7.9D — external GL mapping and import boundary

- explicit account/dimension mapping;
- immutable imported facts with lineage;
- no fuzzy mapping;
- zero-cent default tolerance.

### C7.9E — reconciliation engine and sign-off

- period/currency/account/cost-centre reconciliation;
- variance and unresolved queues;
- prepare/review/sign-off;
- reopen/external-change staleness.

### C7.9F — finance-adjusted reporting

- Source Actual;
- Adjustments;
- Effective Actual;
- Committed;
- Exposure;
- external GL amount;
- reconciliation variance.

## 27. Required tests

1. CLOSED period rejects new posted finance adjustment targeting it.
2. OPEN period accepts governed adjustment.
3. posted adjustment cannot be edited.
4. correction requires reversal + replacement.
5. reversal retains lineage to original adjustment.
6. supplier_bill.posted_at never changes through finance correction.
7. bill_date never becomes automatic accounting recognition date.
8. late bill defaults to posted_at period.
9. late bill into prior CLOSED period raises reconciliation signal.
10. late bill never auto-reopens a period.
11. close and reopen require tenant-scoped admin authorization.
12. reopen requires reason.
13. reopen invalidates, never deletes, prior close.
14. close/reopen concurrency cannot create two active close states.
15. close captures one consistent snapshot.
16. year cannot close with OPEN child periods.
17. external GL account mapping is explicit and tenant-scoped.
18. external GL import is idempotent by external identity.
19. no fuzzy account mapping.
20. reconciliation never sums unlike currencies.
21. zero-cent variance is RECONCILED.
22. non-zero variance is VARIANCE by default.
23. unmapped BrainBase account remains visible.
24. unmapped external account remains visible.
25. external-only entry remains visible.
26. reopening makes prior reconciliation stale.
27. changed external closed-period fact makes sign-off stale.
28. historical close remains reproducible after ACTIVE Budget version changes.
29. legacy financial_models remains untouched.
30. customer commercial_payments remains unrelated to supplier finance Actual.
31. no mutable accounting_date column on supplier bills.
32. no hard delete of posted adjustment/close/reconciliation facts.
33. control mutations are transactionally durable.
34. generic audit log failure cannot erase close/control evidence.
35. disposable Postgres proves tenant/FK/concurrency invariants.

## 28. Non-goals

C7.9 does not implement:
- a full statutory general ledger;
- double-entry accounting for every Commercial transaction;
- accounts-payable settlement;
- bank reconciliation;
- GST/BAS return logic;
- FX revaluation;
- depreciation;
- payroll journals;
- accrual estimation from receipts;
- automatic AI account mapping;
- arbitrary historical backdating;
- external ERP replacement.

## 29. Decision summary

C7.9 chooses four control principles:

1. **Closed periods are sealed.** Ordinary late bills do not rewrite them.
2. **Source dates are immutable.** posted_at remains the C7.8 operational recognition fact.
3. **Finance corrections are append-only.** Reclassification/true-up uses posted adjustment entries, reversal, and explicit reopen controls rather than mutable accounting-date overrides.
4. **External GL reconciliation compares authorities; it does not overwrite them.** BrainBase source facts, BrainBase adjustments, and external GL entries remain separately traceable.

This gives BrainBase a path from operational Budget management toward defensible finance close and external-ledger reconciliation while preserving the evidentiary chain already established in C7.6–C7.8.
