# C7.7 — Governed Budget Account and Allocation Model

Status: design gate only. No schema migration, API, UI, or Production/Preview change is authorised by this document.

## 1. Goal

C7.7 defines the relational Budgeting model required before BrainBase can safely report Budget vs Actual vs Committed vs Forecast.

The design must provide:

- governed Budget accounts;
- Budget lines at an explicit account × cost-centre grain;
- explicit cost-centre-to-account mapping for Purchasing commitments where an organisation chooses one;
- a declared tax basis;
- annual Budget amounts;
- optional period allocations;
- deterministic rules for how C7.6 Purchasing commitments consume Budget;
- tenant isolation, history, authorization, auditability, and fail-loud handling for unmapped/ambiguous facts.

C7.7 is not permission to replace the legacy financial_models JSON model or to invent an accounting ledger.

## 2. Repository-grounded starting point

BrainBase already has:

- commercial_financial_years and commercial_financial_periods as the structured Commercial period authority;
- commercial_cost_centres as a flat tenant-scoped responsibility/ownership dimension;
- a Commercial money standard requiring integer minor units plus explicit currency;
- C7.6 Purchasing commitments derived from ISSUED purchase orders and POSTED supplier bills;
- C7.6 effective cost centre resolution: PO-line cost centre overrides PO cost centre;
- C7.6 governed period attribution based on purchase_order.issued_at;
- C7.6 RESOLVED / UNRESOLVED / AMBIGUOUS period states;
- budgeting/view authorization for cross-PO commitment reporting;
- no relational Budget/GL account model today.

The older financial_models table remains a JSON forecast model with free-text gl values and manually editable budget_fy, ytd_actual, and commitments fields. It is not a governed relational Budget source of truth.

## 3. Core modeling principle: account and cost centre are separate dimensions

A cost centre answers where or by whom spend is owned.

A Budget account answers what type of spend the Budget is for.

They are not interchangeable.

Current purchase-order lines carry cost centre but do not carry a governed Budget account or expense-account dimension. Therefore C7.7 MUST NOT infer an account from:

- supplier;
- product name;
- PO description;
- cost-centre display name;
- legacy financial_models.line_items.gl text;
- fuzzy/name matching.

A Budget line is therefore explicitly defined at the intersection of:

- Budget account;
- cost centre;
- financial year;
- Budget version;
- currency.

A commitment can consume such a line only when an explicit governed mapping resolves its effective cost centre to exactly one Budget account.

## 4. Proposed relational entities

### 4.1 commercial_budget_accounts

Tenant-owned Budget classification master.

Proposed fields:

- id UUID primary key;
- organisation_id TEXT NOT NULL;
- code TEXT NOT NULL;
- name TEXT NOT NULL;
- description TEXT NULL;
- active BOOLEAN NOT NULL DEFAULT true;
- created_by TEXT NULL;
- created_at TIMESTAMPTZ NOT NULL;
- updated_at TIMESTAMPTZ NOT NULL.

Required constraints:

- UNIQUE (organisation_id, code);
- UNIQUE (id, organisation_id).

C7.7 does not call this a statutory GL account. It is a BrainBase Budget account. A later accounting integration may map it to an external GL code explicitly.

### 4.2 commercial_budgets

Stable Budget identity for one tenant, financial year, and currency.

Proposed fields:

- id UUID primary key;
- organisation_id TEXT NOT NULL;
- financial_year_id UUID NOT NULL;
- name TEXT NOT NULL;
- currency TEXT NOT NULL;
- tax_basis TEXT NOT NULL;
- periodisation_mode TEXT NOT NULL;
- active_version_id UUID NULL;
- created_by TEXT NULL;
- created_at TIMESTAMPTZ NOT NULL;
- updated_at TIMESTAMPTZ NOT NULL.

tax_basis allowed values:

- EXCLUSIVE — Budget consumption uses subtotal_cents;
- INCLUSIVE — Budget consumption uses total_cents.

periodisation_mode allowed values:

- ANNUAL_ONLY;
- PERIODISED.

Required rules:

- composite FK (financial_year_id, organisation_id) -> commercial_financial_years(id, organisation_id);
- UNIQUE (id, organisation_id);
- UNIQUE (organisation_id, financial_year_id, currency);
- currency is never inferred from organisation settings.

C7.7 deliberately permits only one governed Budget identity per organisation × financial year × currency. Scenario/planning variants are out of scope; allowing multiple named active Budgets here would make commitment consumption ambiguous.

A Budget's tax_basis is fixed at the Budget header level so all lines inside the Budget use the same measurement basis. Mixing tax-inclusive and tax-exclusive lines inside one Budget would make line and roll-up comparisons incoherent.

### 4.3 commercial_budget_versions

Immutable revision of one Budget.

Proposed fields:

- id UUID primary key;
- organisation_id TEXT NOT NULL;
- budget_id UUID NOT NULL;
- version_number INTEGER NOT NULL;
- status TEXT NOT NULL;
- notes TEXT NULL;
- created_by TEXT NULL;
- created_at TIMESTAMPTZ NOT NULL;
- activated_by TEXT NULL;
- activated_at TIMESTAMPTZ NULL;
- superseded_at TIMESTAMPTZ NULL.

status allowed values:

- DRAFT;
- ACTIVE;
- SUPERSEDED.

Required constraints:

- version_number >= 1;
- UNIQUE (budget_id, version_number);
- UNIQUE (id, organisation_id);
- composite FK (budget_id, organisation_id) -> commercial_budgets(id, organisation_id).

Editing an ACTIVE version in place is prohibited. A revision creates a new DRAFT version, which becomes ACTIVE only through an explicit activation transaction. The prior ACTIVE version becomes SUPERSEDED.

commercial_budgets.active_version_id points only to a version belonging to the same Budget and tenant.

### 4.4 commercial_budget_lines

Annual Budget amount at the governed account × cost-centre grain.

Proposed fields:

- id UUID primary key;
- organisation_id TEXT NOT NULL;
- budget_version_id UUID NOT NULL;
- budget_account_id UUID NOT NULL;
- cost_centre_id UUID NOT NULL;
- annual_budget_cents BIGINT NOT NULL;
- created_at TIMESTAMPTZ NOT NULL.

Required constraints:

- annual_budget_cents >= 0;
- UNIQUE (budget_version_id, budget_account_id, cost_centre_id);
- UNIQUE (id, organisation_id);
- composite tenant-safe FKs to version, account, and cost centre.

The Budget line does not carry an independent currency or tax basis. Those are inherited from the parent commercial_budgets row and are immutable for the version.

This is deliberate: two different currencies or tax bases must be represented by separate Budget headers, not mixed in one Budget version.

### 4.5 commercial_budget_period_allocations

Optional periodisation of one annual Budget line.

Proposed fields:

- id UUID primary key;
- organisation_id TEXT NOT NULL;
- budget_line_id UUID NOT NULL;
- financial_period_id UUID NOT NULL;
- amount_cents BIGINT NOT NULL;
- created_at TIMESTAMPTZ NOT NULL.

Required constraints:

- amount_cents >= 0;
- UNIQUE (budget_line_id, financial_period_id);
- composite tenant-safe FKs to Budget line and financial period.

Activation rules:

- ANNUAL_ONLY Budgets must have no period allocations;
- PERIODISED Budgets must have allocations only to periods belonging to the Budget's financial year;
- before activation, the sum of period allocations for each Budget line must equal annual_budget_cents exactly.

DRAFT versions may be incomplete while being edited. ACTIVE versions may not.

### 4.6 commercial_budget_commitment_mappings

Explicit Budget-version-scoped mapping used to classify Purchasing commitments that currently have only an effective cost centre.

Proposed fields:

- id UUID primary key;
- organisation_id TEXT NOT NULL;
- budget_version_id UUID NOT NULL;
- cost_centre_id UUID NOT NULL;
- budget_account_id UUID NOT NULL;
- created_by TEXT NULL;
- created_at TIMESTAMPTZ NOT NULL.

Required constraints:

- UNIQUE (id, organisation_id);
- UNIQUE (budget_version_id, cost_centre_id);
- composite tenant-safe FKs to Budget version, cost centre, and Budget account.

The mapping is part of the Budget version itself. It may be edited while the version is DRAFT and becomes immutable when the version becomes ACTIVE or SUPERSEDED.

This avoids retroactive reclassification: activating a later Budget version may deliberately map a cost centre differently without changing how an earlier version classified commitments.

This mapping is a default Purchasing classification rule, not a claim that cost centre and account are the same concept.

If future Purchasing adds an explicit account dimension on PO lines, that explicit line attribution should take precedence and this version-scoped default mapping can become fallback-only.

## 5. Tax basis decision

C7.7 adopts an explicit Budget-level tax basis.

### EXCLUSIVE

Budget consumption value comes from:

- ordered_subtotal_cents;
- billed_subtotal_cents;
- outstanding_subtotal_cents.

### INCLUSIVE

Budget consumption value comes from:

- ordered_total_cents;
- billed_total_cents;
- outstanding_total_cents.

C7.7 does not support a mixed basis inside one Budget and does not add a TAX_ONLY Budget basis.

Tax amounts remain available as separate governed facts for reconciliation, but tax itself is not automatically assigned to a separate Budget account.

The tax basis must be chosen before a Budget version is activated and cannot be changed on an ACTIVE version. Changing tax basis requires a new Budget identity or an explicitly governed migration because historical comparisons would otherwise change meaning.

## 6. Annual and period Budget semantics

annual_budget_cents is the authoritative annual ceiling for one account × cost-centre Budget line.

For ANNUAL_ONLY:

- annual Budget exists;
- no period allocations exist;
- period-specific commitments may still be displayed by C7.6 attribution, but they are compared only to the annual Budget unless a future reporting rule explicitly apportions the annual amount. BrainBase must not fabricate equal monthly allocations.

For PERIODISED:

- every ACTIVE Budget line has allocations whose sum equals annual_budget_cents;
- each allocation belongs to a period inside the same financial year;
- period Budget reporting compares facts only to the explicit allocation for that period.

No automatic spreading by month, days, percentages, or historical run rate is permitted in C7.7.

## 7. How Purchasing commitments consume Budget

C7.6 remains the source of truth for Purchasing commitment values.

The Budgeting resolver consumes C7.6 at PO-line grain.

For each ISSUED PO line:

1. derive effective_cost_centre_id using C7.6 rules;
2. resolve commitment period using C7.6 issued_at attribution;
3. find the ACTIVE Budget for the resolved financial year and commitment currency;
4. resolve exactly one cost-centre -> Budget-account mapping inside that ACTIVE Budget version;
5. find the ACTIVE Budget line for (Budget account, effective cost centre);
6. choose commitment amount using the Budget's tax_basis;
7. aggregate outstanding commitment into that Budget line and, for PERIODISED Budgets, into the resolved financial period.

Budget commitment consumption is the outstanding commitment only:

- EXCLUSIVE => outstanding_subtotal_cents;
- INCLUSIVE => outstanding_total_cents.

POSTED billed value reduces outstanding commitment exactly as C7.6 already defines.

C7.7 MUST NOT relabel billed value as Actual spend. A governed Actual source is a separate C7.8 concern.

Therefore C7.7 may report:

- annual_budget_cents;
- period_budget_cents where applicable;
- committed_cents;
- budget_less_commitments_cents as a provisional planning measure.

It must not label budget_less_commitments_cents as "remaining Budget" once actual expenditure exists but is not yet included. The user-facing label must make clear that Actuals are excluded until C7.8 provides a governed source.

## 8. Commitment attribution failure states

A commitment is included in Budget consumption only when all required dimensions resolve.

Required fail-loud states:

- UNATTRIBUTED_COST_CENTRE — no effective cost centre;
- UNMAPPED_ACCOUNT — cost centre has no active Budget-account mapping;
- AMBIGUOUS_ACCOUNT — more than one mapping exists for the same cost centre inside one Budget version due to integrity drift;
- UNRESOLVED_PERIOD — C7.6 period resolution is UNRESOLVED;
- AMBIGUOUS_PERIOD — C7.6 period resolution is AMBIGUOUS;
- NO_ACTIVE_BUDGET — no ACTIVE Budget exists for financial year + currency;
- NO_BUDGET_LINE — active Budget exists but no line exists for resolved account × cost centre;
- CURRENCY_MISMATCH — no Budget exists for the commitment currency;
- INVALID_OVERBILLED — propagated C7.6 integrity state.

These amounts remain visible in reconciliation totals and exception queues. They are never silently dropped or forced into an "Other" account.

## 9. Currency policy

Budget money follows the existing Commercial money ADR.

Every Budget header has explicit ISO currency. Budget amounts use BIGINT minor units because annual municipal/enterprise Budget totals can legitimately exceed the existing INTEGER-cent document ceiling even when individual commercial documents do not.

No cross-currency arithmetic is permitted. Domain/API code must reject or explicitly handle any BIGINT value outside JavaScript's safe-integer range rather than silently rounding it.

If an organisation budgets in AUD and has a USD purchase commitment, that USD commitment is not converted automatically. It remains a CURRENCY_MISMATCH / NO_ACTIVE_BUDGET exception unless a USD Budget exists.

Foreign-exchange conversion, rates, revaluation, and base-currency reporting are outside C7.7.

## 10. Cost-centre integrity prerequisite

commercial_cost_centres currently predates the composite tenant-integrity convention used by newer Commercial entities.

Before a C7.7 migration adds composite FKs from Budget structures to cost centres, the migration should add:

- UNIQUE (id, organisation_id)

to commercial_cost_centres.

Because id is already the UUID primary key, this is additive and does not change row identity. It exists solely as the structural target required for tenant-safe composite FKs.

No cost-centre hierarchy is introduced.

## 11. Budget activation transaction

Activating a DRAFT Budget version must be one transaction.

The transaction must:

1. lock the Budget header;
2. confirm the version belongs to the authenticated tenant and Budget;
3. confirm financial year status is OPEN;
4. validate tax basis and currency are fixed;
5. validate every Budget line references active account/cost-centre records;
6. for PERIODISED Budgets, validate each line's allocations exactly equal annual_budget_cents;
7. reject allocations outside the Budget financial year;
8. supersede the previous ACTIVE version if one exists;
9. mark the new version ACTIVE;
10. update commercial_budgets.active_version_id;
11. write an audit record.

A CLOSED financial year cannot accept a new Budget activation.

Reading an already ACTIVE historical Budget remains allowed after the year later becomes CLOSED.

## 12. Authorization

All C7.7 read/write paths use authorizeCommercialRequest(), never legacy getAuthSession() alone.

Proposed floors:

- list/read Budget accounts: budgeting/view;
- list/read Budgets and versions: budgeting/view;
- read Budget-vs-commitment reporting: budgeting/view;
- create/edit DRAFT Budget accounts, mappings, Budgets, versions, lines, and allocations: budgeting/createEdit (manager);
- activate/supersede a Budget version: budgeting/administer (admin);
- deactivate an account referenced by an ACTIVE Budget or replace an ACTIVE Budget version with revised mappings: budgeting/administer (admin).

A mutation must derive organisation_id only from the authenticated session.

## 13. Audit and history

Audit events should cover at minimum:

- budget_account.created;
- budget_account.updated;
- budget_account.deactivated;
- budget_commitment_mapping.created;
- budget_commitment_mapping.changed while DRAFT;
- budget.created;
- budget_version.created;
- budget_line.changed while DRAFT;
- budget_period_allocation.changed while DRAFT;
- budget_version.activated;
- budget_version.superseded.

ACTIVE and SUPERSEDED Budget versions are immutable.

No hard-delete API should exist for an ACTIVE or SUPERSEDED version.

## 14. Legacy financial_models coexistence

C7.7 does not write to financial_models.

The new Budget model is authoritative only for new governed Budgeting functionality.

Legacy financial_models.line_items remain unchanged and continue to serve the legacy /api/financial and command/financial surfaces until a separate migration/reconciliation phase.

No automatic mapping from:

- financial_models.line_items.gl;
- description;
- category;

to commercial_budget_accounts is allowed.

A future legacy migration requires an explicit, reviewable mapping artifact and reconciliation report.

## 15. What "Actual" means in C7.7

C7.7 deliberately does not define Actual spend.

POSTED supplier bills are governed billed facts, but the repository has not yet established whether Budget Actual should mean:

- supplier-bill posting;
- payable recognition;
- accounting-ledger posting;
- cash payment;
- another accounting basis.

Therefore C7.7 must keep these concepts separate:

- Budget;
- committed;
- billed;
- actual.

C7.8 must make the Actual-source decision before BrainBase presents a full Budget vs Actual vs Committed result.

## 16. Required derived read-model grain

The future C7.7 Budget consumption read model should be able to produce one row per:

- organisation;
- active Budget/version;
- Budget account;
- cost centre;
- financial year;
- financial period when PERIODISED;
- currency.

Metrics:

- annual_budget_cents;
- period_budget_cents nullable for ANNUAL_ONLY;
- committed_cents;
- billed_cents as an informational governed fact only;
- commitment_count;
- unresolved_exception_count.

C7.7 should not persist committed_cents or billed_cents onto Budget lines. They remain derived from Purchasing facts.

## 17. Migration shape

Preferred migration is additive raw SQL following existing Commercial conventions.

Candidate artifacts:

- scripts/create-commercial-budgeting.sql;
- lib/commercial/budgetAccounts.ts;
- lib/commercial/budgets.ts;
- lib/commercial/budgetCommitmentMappings.ts;
- containment schema/domain/auth tests;
- disposable PostgreSQL migration + activation-concurrency proof.

No prisma db push.

No destructive rewrite of financial_models.

No columns added to commercial_purchase_orders or commercial_purchase_order_lines for Budget totals, Budget account, committed values, or financial period.

The only existing-table schema addition expected by this design is the tenant-integrity anchor UNIQUE (id, organisation_id) on commercial_cost_centres.

## 18. Pre-migration test plan

### A. Schema/tenant integrity

1. Every new table carries organisation_id.
2. Budget -> financial year is composite tenant-scoped.
3. Budget version -> Budget is composite tenant-scoped.
4. Budget line -> version/account/cost centre are composite tenant-scoped.
5. period allocation -> Budget line/financial period are composite tenant-scoped.
6. Budget-version-scoped cost-centre/account mapping cannot cross tenants or Budget versions.
7. commercial_cost_centres exposes UNIQUE (id, organisation_id).
8. no new Budget columns are added to PO/PO-line tables.

### B. Budget invariants

9. annual_budget_cents cannot be negative.
10. period allocation cannot be negative.
11. duplicate account × cost-centre lines in one version are rejected.
12. duplicate period allocation for one Budget line is rejected.
13. PERIODISED activation rejects allocation sum below annual amount.
14. PERIODISED activation rejects allocation sum above annual amount.
15. PERIODISED activation accepts exact equality.
16. ANNUAL_ONLY activation rejects any period allocation.
17. period outside the Budget financial year is rejected.
18. CLOSED financial year rejects activation.
19. ACTIVE/SUPERSEDED versions reject mutation.
20. activation atomically supersedes the prior ACTIVE version.

### C. Commitment consumption

21. EXCLUSIVE Budget consumes outstanding_subtotal_cents.
22. INCLUSIVE Budget consumes outstanding_total_cents.
23. billed value alone is never labelled Actual.
24. line cost-centre override is honoured.
25. missing cost centre becomes UNATTRIBUTED_COST_CENTRE.
26. missing mapping becomes UNMAPPED_ACCOUNT.
27. duplicate/overlapping mappings inside one Budget version become AMBIGUOUS_ACCOUNT or are structurally rejected.
28. unresolved/ambiguous financial period remains outside period Budget consumption.
29. missing Budget line becomes NO_BUDGET_LINE.
30. currencies never combine.
31. supplier, description, product, and legacy GL text never infer account.
32. cancelling a supplier bill restores committed Budget consumption through C7.6.
33. receipts and match allocations do not change committed Budget consumption.

### D. Authorization/audit

34. reads require budgeting/view.
35. DRAFT editing requires budgeting/createEdit or stricter.
36. activation requires budgeting/administer.
37. request-provided organisation IDs cannot override session tenant.
38. activation writes an audit event.
39. DRAFT mapping changes are audited and ACTIVE/SUPERSEDED mappings are immutable.

### E. Real PostgreSQL proof

40. migration applies fresh and idempotently.
41. cross-tenant composite FKs fail in real Postgres.
42. concurrent activation cannot leave two ACTIVE versions.
43. activation validation and state change are one transaction.
44. period-allocation equality is tested using exact integer cents.
45. no hosted DB is contacted by the harness.

## 19. Explicit non-goals

C7.7 does not implement:

- statutory general ledger;
- journal entries;
- accounts payable;
- payment settlement;
- accrual accounting;
- cash accounting;
- FX conversion;
- tax return/GST reporting;
- cost-centre hierarchy;
- automatic account classification;
- AI-generated account mapping;
- Purchase Requests;
- budget transfer workflow;
- supplementary Budget approvals;
- Actual-spend source;
- forecast engine;
- replacement of financial_models.

## 20. Recommended implementation sequence

C7.7A — migration design + containment tests for Budget accounts, Budgets, versions, lines, allocations, mapping, and cost-centre tenant anchor.

C7.7B — disposable PostgreSQL migration/idempotency and tenant-FK proof.

C7.7C — tenant-scoped domain services for DRAFT Budget editing.

C7.7D — atomic Budget-version activation with budgeting/administer authorization and audit.

C7.7E — derived commitment-to-Budget resolver with tax-basis and exception states.

C7.7F — budgeting/view read API and Budget consumption UI.

Only after C7.7 is stable should C7.8 decide the governed Actual source and build Budget vs Actual vs Committed reporting.
