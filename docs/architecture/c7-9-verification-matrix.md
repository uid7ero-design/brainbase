# C7.9 Verification Matrix

This matrix maps the 35 required C7.9 finance-close, reconciliation and reporting invariants in
`docs/architecture/c7-9-finance-close-reconciliation-design.md` to executable evidence on this branch.

It is a review aid, not a substitute for the test suites. The authoritative result remains the
containment suite, disposable-Postgres finance harness, browser suite and production build.

## Verification matrix

| # | Required invariant | Primary executable evidence |
|---|---|---|
| 1 | CLOSED period rejects a new posted finance adjustment targeting it. | `scripts/tests/financeAdjustments.integration.test.ts` — “posting is rejected if the target period closes after DRAFT creation”; closed-period reversal rejection. |
| 2 | OPEN period accepts governed adjustment. | `scripts/tests/financeAdjustments.integration.test.ts` — DRAFT creation and POST lifecycle tests. |
| 3 | Posted adjustment cannot be edited. | `scripts/tests/financeAdjustments.integration.test.ts` — database triggers prevent mutation/deletion of posted monetary content; `tests/containment/commercialFinanceAdjustmentsSchema.test.ts`. |
| 4 | Correction requires reversal + replacement. | `scripts/tests/financeAdjustments.integration.test.ts` — reversal creates the correcting opposite POSTED adjustment; `tests/containment/commercialFinanceAdjustmentsSchema.test.ts`. |
| 5 | Reversal retains lineage to the original adjustment. | `scripts/tests/financeAdjustments.integration.test.ts` — reversal lifecycle and one-reversal concurrency coverage. |
| 6 | `supplier_bill.posted_at` never changes through finance correction. | Source-date immutability coverage introduced by `71384c36 test(commercial): lock supplier bill source dates`; `tests/containment/commercialSupplierBillsSchema.test.ts`. |
| 7 | `bill_date` never becomes automatic accounting recognition date. | `scripts/tests/budgetActuals.integration.test.ts` — POSTED bills recognised by `posted_at`, not `bill_date`; `tests/containment/commercialFinanceCloseDesign.test.ts`. |
| 8 | Late bill defaults to the `posted_at` period. | `scripts/tests/budgetActuals.integration.test.ts` — prior-period late bill remains recognised in posting period. |
| 9 | Late bill into prior CLOSED period raises reconciliation signal. | `scripts/tests/budgetActuals.integration.test.ts` — CLOSED bill-date period signal; `tests/containment/commercialLateBillReconciliation.test.ts`. |
| 10 | Late bill never automatically reopens a period. | `scripts/tests/budgetActuals.integration.test.ts`; `tests/containment/commercialFinanceCloseDesign.test.ts`. |
| 11 | Close and reopen require tenant-scoped admin authorization. | `tests/containment/commercialFinanceCloseApi.test.ts`; browser finance-control flows. |
| 12 | Reopen requires a non-empty reason. | `scripts/tests/financeCloseConcurrency.integration.test.ts` — period/year reopen reason tests; `tests/browser/commercialFinanceControls.spec.ts`. |
| 13 | Reopen invalidates, never deletes, prior close. | `scripts/tests/financeCloseConcurrency.integration.test.ts` — reopen invalidation + reclose sequence; hard-delete rejection. |
| 14 | Close/reopen concurrency cannot create two active close states. | `scripts/tests/financeCloseConcurrency.integration.test.ts` — concurrent close and concurrent reopen serialization. |
| 15 | Close captures one consistent snapshot. | `scripts/tests/financeCloseConcurrency.integration.test.ts` — atomic close and durable source-Actual controls. |
| 16 | Financial year cannot close with OPEN child periods. | `scripts/tests/financeCloseConcurrency.integration.test.ts` — OPEN-child rejection plus other year-close deterministic controls. |
| 17 | External GL mapping is explicit and tenant-scoped. | `scripts/tests/externalGlBoundary.integration.test.ts` — account/cost-centre mapping lifecycle, tenant isolation, effective dating; `tests/containment/commercialFinanceReconciliationSchema.test.ts`. |
| 18 | External GL import is idempotent by external identity. | `scripts/tests/externalGlBoundary.integration.test.ts` — exact duplicate import returns IDEMPOTENT. |
| 19 | No fuzzy account mapping. | `tests/containment/commercialFinanceReconciliationSchema.test.ts`; External GL mapping admin UI containment; architecture assertions. |
| 20 | Reconciliation never sums unlike currencies. | `scripts/tests/financeReconciliation.integration.test.ts` — unlike currencies excluded from one snapshot. |
| 21 | Zero-cent variance is RECONCILED. | `scripts/tests/financeReconciliation.integration.test.ts` — exact mapped totals at zero-cent tolerance. |
| 22 | Non-zero variance is VARIANCE by default. | `scripts/tests/financeReconciliation.integration.test.ts` — mapped variance surfaced with zero tolerance. |
| 23 | Unmapped BrainBase account remains visible. | `scripts/tests/financeReconciliation.integration.test.ts` — explicit `UNMAPPED_BRAINBASE_ACCOUNT`. |
| 24 | Unmapped external account remains visible. | `scripts/tests/financeReconciliation.integration.test.ts` — explicit `UNMAPPED_EXTERNAL_GL_ACCOUNT`. |
| 25 | External-only entry remains visible. | `scripts/tests/financeReconciliation.integration.test.ts` — mapped external-only cost-centre evidence; external-only outcome coverage. |
| 26 | Reopening makes prior reconciliation stale. | `scripts/tests/financeReconciliation.integration.test.ts` — reopen changes attached sign-off to STALE without deleting snapshot/items/events. |
| 27 | Changed external closed-period fact makes sign-off stale. | `scripts/tests/financeReconciliation.integration.test.ts` — new/changed GL fact staleness; rollback proof in `c7941424`. |
| 28 | Historical close remains reproducible after ACTIVE Budget version changes. | `scripts/tests/financeReconciliation.integration.test.ts` — prepared snapshot remains unchanged after later ACTIVE Budget classification; `scripts/tests/budgetActualCommitted.integration.test.ts`; fix `da380386`. |
| 29 | Legacy `financial_models` remains untouched. | `tests/containment/commercialBudgetActualsDomain.test.ts`; `tests/containment/commercialBudgetingSchema.test.ts`. |
| 30 | Customer `commercial_payments` remains unrelated to supplier finance Actual. | `tests/containment/commercialBudgetActualsDomain.test.ts`; `tests/containment/commercialBudgetActualsDesign.test.ts`. |
| 31 | No mutable `accounting_date` column on supplier bills. | `tests/containment/commercialSupplierBillsSchema.test.ts`; `tests/containment/commercialFinanceCloseDesign.test.ts`. |
| 32 | No hard delete of posted adjustment/close/reconciliation facts. | Adjustment/close database-trigger integration coverage; `aa8e01d7 fix(commercial): prevent hard delete of finance controls`; close hard-delete test. |
| 33 | Control mutations are transactionally durable. | Rollback proofs for adjustment events, reconciliation prepare/review/sign-off, GL stale transitions, mapping stale transitions and year close/reopen; commits `2bec0027`, `68bee1ae`, `dcc7c7e7`, `c7941424`, `dcbffda1`, `daf7080e`. |
| 34 | Generic audit-log failure cannot erase close/control evidence. | `scripts/tests/financeCloseConcurrency.integration.test.ts` — close/reopen remain durable when generic audit logging fails; `96b8ea95 test(commercial): prove finance control audit durability`. |
| 35 | Disposable Postgres proves tenant/FK/concurrency invariants. | `scripts/tests/verify-commercial-budgeting.ps1` plus the C7.7–C7.9 integration suites; latest finance harness result on `b4d5e8df` is PASS=30 / FAIL=0, including 111 integration tests across nine suites. |

## Additional boundary proofs

The implemented reconciliation model treats financial period and currency as hard snapshot
boundaries rather than persisted mismatch outcomes:

- `scripts/tests/financeReconciliation.integration.test.ts` proves unlike currencies are never
  combined in one reconciliation snapshot.
- The same suite proves external entries whose transaction date falls outside the selected
  financial period are excluded before aggregation.

External GL account and cost-centre mapping history is effective-dated and non-overlapping, and
mapping changes over existing evidence stale affected signed reconciliations atomically.

## User-facing control evidence

In addition to domain/integration tests:

- `tests/browser/commercialFinanceControls.spec.ts` covers governed year close/reopen, period
  close/reopen, reconciliation prepare/review/sign-off and read-only signed/stale states.
- `tests/browser/commercialBudgetExportControls.spec.ts` covers C7.9F legacy/finance export
  separation, source selection, stale evidence, duplicate/empty rows, RFC4180/formula safety and
  UTF-8 preservation.
- The Finance Controls console, External GL mapping administration, finance-adjusted reporting,
  reconciliation queue and exact-money rendering have focused containment coverage.

### Production-runtime regression added in PR #375

`scripts/tests/verify-finance-controls-runtime.mjs` runs against an actual Next production
build with real login, a disposable PostgreSQL database and the loopback-only Neon transport
adapter. It supplements the domain and browser suites with:

- real mapping forms, create/retire responses and exact calendar-date readback;
- reconciliation preparation and period-reopen event parameter typing;
- exact BIGINT import values beyond JavaScript's safe-integer range;
- database-gated overlapping identical imports returning one IMPORTED and one IDEMPOTENT,
  plus changed-identity concurrency preserving the winning fact;
- duplicate imports retaining sign-off, genuine conflicts/new facts staling affected evidence;
- close/reopen/sign-off history, mobile table scrolling, viewer denial and tenant isolation.

The release validation on head `6b99a47a` passed 2,182 Commercial containment tests,
PASS=30 / FAIL=0 database verification, production build and this runtime regression in
Australia/Adelaide. Earlier date and import runtime runs also passed in UTC. PR #375 merged
as `6ca8a81b`; production was READY and the live alias matched that merge. These are dated
release observations, not a claim that future builds or customer configuration are verified.

Customer setup and pilot acceptance are tracked in
[`commercial-finance-pilot.md`](commercial-finance-pilot.md). The PR #375 runtime fixture
created its prerequisites directly and did not prove an administrator setup UI existed.

### Calendar setup stage, 7 October 2026

The runtime regression now also starts the second organisation with no calendar, creates
a year and period through the administrator UI, verifies calendar-date persistence and
creation audit actor, rejects malformed dates/duplicate names/overlaps/outside-year ranges,
and exercises concurrent year and period creation plus year-close/period-create concurrency.
It checks closed-year, unauthenticated, viewer, unentitled and foreign-tenant rejection and
mobile layout. This stage passed the runtime regression in Australia/Adelaide, 2,203
Commercial tests, PASS=30 / FAIL=0 database verification, lint and production build locally.
Account, cost-centre and draft Budget setup are verified in the later local stages below.

### Dimension and initial Budget setup stages, 7 October 2026

Account and cost-centre forms create tenant-owned records, reject duplicate codes,
retain inactive records and prevent deactivation of ACTIVE Budget references.
Database barriers prove activation-first and deactivation-first serialization for
both dimension types using shared row locks.

The production-runtime walkthrough now completes an initial periodised Budget
through forms: header/DRAFT version, line, commitment mapping and allocation.
A mismatched allocation blocks activation; correcting it permits activation and
persists the active pointer. ACTIVE versions remove edit forms and reject API
edits. Duplicate headers and unauthenticated/viewer/unentitled/foreign-tenant
mutations are rejected. The complete setup screen fits the 390px viewport.

The Budget stage passed 2,252 Commercial containment tests, PASS=30 / FAIL=0
disposable database verification, focused lint, production build and runtime
regression in Australia/Adelaide. All setup stages remain local and unreleased.

### Connected finance workflow, 7 October 2026

The shared workflow links use budgeting administrator access supplied by the
server Commercial shell, with a false context default. Existing API authorization
is unchanged. Empty finance controls point to calendar setup; mappings point to
active dimension setup; unfiltered empty reporting points to Budget setup while
explaining the separate need for operational activity or ledger imports.

The real-runtime walkthrough follows those links from the empty second tenant,
completes setup, selects its new accounts/cost centres in mapping controls,
selects its new year/period in finance controls and returns to its ACTIVE Budget.
It verifies completed dimension guidance clears, viewers retain reporting without
administrator workflow links, unentitled reporting denies access and the complete
setup screen remains inside the mobile viewport.

This UI-only stage passed 2,252 Commercial containment tests, focused lint,
production build and the extended production-runtime regression in
Australia/Adelaide. The prior PASS=30 / FAIL=0 database verification belongs to
the unchanged Budget/database implementation; it was not rerun for these links.
The pilot review packet is in `commercial-finance-pilot.md`. No push, deployment
or customer configuration change was performed.

### Draft recovery remediation, 7 October 2026

Code candidate `2c119581` resolves the release-review draft recovery blocker with
administrator reactivation of retained accounts and cost centres. The real runtime
deactivates each dimension referenced by a draft, observes inactive-reference
activation rejection, restores it through its UI action and activates the original
version. It checks one audit transition on retry and authenticated tenant/role/
capability boundaries. Malformed tax-basis and periodisation arrays return 400.

The candidate passed 2,266 Commercial tests (63 focused setup/recovery tests),
PASS=30 / FAIL=0 disposable database verification, focused lint, production build
and the complete runtime regression in Australia/Adelaide. Mobile setup fit was
also checked. The remediation review in `commercial-finance-pilot.md` records GO
for a scoped pilot setup release, with no push, deployment or customer acceptance
claimed. Documentation-only review updates do not change the tested code.

## Deliberately deferred policy decisions

These are not missing implementations and must not be inferred silently:

1. Whether every financial-year close must require an External GL reconciliation in a specific
   signed-off state.
2. Whether reconciliation may ever use a non-zero tolerance.

Until an explicit policy decision changes either rule, year close uses the deterministic controls
implemented on this branch without silently requiring an external source, and reconciliation
remains exact at zero-cent tolerance.
