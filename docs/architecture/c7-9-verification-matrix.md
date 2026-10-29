# C7.9 Verification Matrix

This matrix maps the 35 required C7.9 finance-close, reconciliation and reporting invariants in
`docs/architecture/c7-9-finance-close-reconciliation-design.md` to executable evidence on this branch.

It is a review aid, not a substitute for the test suites. The authoritative result remains the
containment suite, disposable-Postgres finance harness, browser suite and production build.

## Local evidence validation receipt, 24 October 2026

Implementation candidate: `bf4d4003`, on prerequisite build fix `b76d1f48`.
The user resumed validation/completion and froze feature expansion behind an
explicit explained yay/nay decision. No push or deployment was requested or run.

| Final check | Result | Local evidence |
|---|---|---|
| Commercial containment plus four affected HR route suites | 154 files, 2,609 tests passed | `test-results/finance-commercial-containment.log` |
| Adjustment, control recovery, coordination and new evidence-reader components | Four files, 51 tests passed | `test-results/finance-component-validation.log` |
| Export/model boundary cases including all seven adjustment formats | 13 focused evidence-bundle cases passed, included in containment total | `test-results/finance-exports-validation.log` |
| Independent application/test TypeScript | Passed, `npx tsc --noEmit --incremental false` | `test-results/finance-evidence-types.log` |
| Focused changed-file lint and final runtime-script/export-test lint | Passed | `test-results/finance-evidence-lint.log`, `finance-final-lint.log` |
| Production build | Passed, `npm run build -- --webpack` | `test-results/finance-evidence-build.log` |
| Disposable PostgreSQL | PASS=30 / FAIL=0, including native integration suites | `test-results/finance-disposable-database.log` |
| Complete production-runtime browser regression | Passed, synthetic tenants/accounts and owned temporary database | `test-results/finance-evidence-runtime.log`, `finance-evidence-final-runtime/evidence.json` |
| Added native evidence flow | Passed: scoped reads, foreign tenant rejection, history HTML, comparison/swap JSON, snapshot HTML/JSON/totals CSV, linked invalidated close, Back/Forward, GET-only requests and unchanged saved facts/events | `test-results/finance-evidence-final-runtime/finance-evidence-acceptance.json` |
| Mobile and print evidence | Mobile report fits; generated four-page A4 PDF preserves text; all four rasterised pages visually inspected | `finance-evidence-final-runtime/evidence-report-mobile.png`, `evidence-report-print.pdf`, `print-page-1.png` through `print-page-4.png` |
| Final source review | Included previously untracked candidate files; staged whitespace check clean | Code candidate `bf4d4003` |

Commands were run from the candidate checkout. Containment used Vitest project
`containment`, filter `commercial`, the four explicit affected HR suite paths and
`--maxWorkers=4`. Component validation used the explicit four finance files in
project `components`. Artifacts live under the ignored local `test-results/`
directory; this record preserves their outcomes without committing synthetic
fixture dumps or generated screenshots/PDFs as product source.

The production build used
`postgresql://postgres:test@127.0.0.1:1/finance_build_only` solely to initialise the
existing database client while collecting dynamic routes. It did not use customer
credentials or establish database correctness. Native proof came from separately
owned loopback Docker PostgreSQL fixtures. Runtime used
`FINANCE_RUNTIME_TIMEZONE=Australia/Adelaide` and
`FINANCE_RUNTIME_ARTIFACTS=test-results/finance-evidence-final-runtime` with
`node scripts/tests/verify-finance-controls-runtime.mjs`. Temporary browsers,
servers and database containers were cleaned up; the unrelated existing container
was not touched.

Failures corrected during close-out:

- Existing UI/static tests and runtime selectors now follow extracted cards,
  explicit table switches, retained evidence disclosures and current wording.
  Browser scrolling is stubbed only in jsdom tests, matching existing test practice.
- History read invalidation schedules its guarded state clear asynchronously,
  resolving the React lint error while preserving pause/old-read suppression.
- Three pre-existing HR register route handlers now require their Request argument
  as Next.js route typing expects; their tests supply real Request objects. This
  build-only compatibility repair is isolated in `b76d1f48`.
- Disposable PostgreSQL readiness waits for TCP rather than the transient bootstrap
  socket; the database harness binds its published port to loopback. A legacy
  reporting assertion now checks explicit unavailable/no-snapshot semantics rather
  than assuming an em dash. Neither correction changes finance domain behaviour.
- New browser API acceptance uses authenticated browser fetch, preserving Chromium's
  secure localhost cookie behaviour instead of relying on APIRequestContext cookie
  handling. Finance authentication was not weakened for testing.

Limits: this is local synthetic acceptance, not a hosted or Production receipt.
Existing nonblocking build warnings remain for middleware deprecation, jose Edge
runtime APIs and the missing optional Command Centre dashboard-copy source. No
unrelated framework migration or dashboard work was added. The printed report
review covers the generated representative saved snapshot, not every possible
customer content length. Future features, push/deployment and any customer setup
remain separate explicit decisions.

## Local evidence bundle acceptance gate, 20 October 2026

Historical close-out plan: the "not run" states below are superseded by the
24 October receipt above for implementation candidate `bf4d4003`.

**Status: not run for the accumulated local evidence/interface candidate.** Older
receipts in this matrix do not validate later changed or untracked files. This
gate bounds the finishing scope described in `commercial-finance-pilot.md` and
does not authorise tests, database access, push or deployment. The earlier testing
deferral remains in place. Source inspection and this checklist are not passing
test evidence.

| Area | Required coverage before acceptance | Current evidence |
|---|---|---|
| Administrator and tenant boundaries | Each new GET rejects missing entitlement, wrong role and cross-tenant identities; exact year/period/source/currency checks; generic unavailable/not-found responses; no mutation/audit events from reads. | Source inspected; focused route/database proof not run. |
| Adjustment discovery | Applied type/status/literal search across pages; invalid inputs; case handling and SQL binding; pending search edits suppress exports; independent register/detail scope and status. | New cases need coverage; not run. |
| Saved reconciliation and close reads | Durable identities, historical/stale/invalidated evidence, complete lifecycle details, all-item arithmetic/counts, selected page and filter, current-at-read labels/links versus captured totals. | Source inspected; database/browser proof not run. |
| History and latest designation | Newest record calculated before lifecycle filtering; stable pagination and empty pages; separate versions without summation; current close hidden by a local filter. | New cases need coverage; not run. |
| Snapshot comparison | Two distinct records in exact same scope; independent successful reads required; exact signed comparison-minus-baseline amounts/counts; null/empty header differences; swap/reload; failures/supersession. | New cases need coverage; not run. |
| Evidence trail | Valid references, one calendar context, 16-reference limit, Back/Forward, cycle/revisit, forward-branch replacement, failed reads, fresh readers and parent locks. | New cases need coverage; not run. |
| CSV/JSON exports | Scope, identity and read/download provenance; displayed-page versus full-total/event coverage; exact huge cents; missing/empty values; formula-like text; zero versus unavailable; safe filenames. | New cases need coverage; not run. |
| Printable reports | HTML escaping, no external assets/scripts, current-at-read versus captured facts, original timestamps, long notes/IDs/event JSON, empty pages, responsive/A4 print layout. | Implemented styles only; rendering/browser proof not run. |
| Downloads and read lifecycle | All five download panels, delayed URL cleanup after unmount, setup/click failures, repeated/blocked downloads; AbortController cleanup with late/failed responses and paired sibling failure. | Shared implementation source reviewed; browser proof not run. |
| Cards, tables and actions | Matching values/identities and action callbacks, status filters, zero/clean records retained, unchanged Review/Sign off gates and server rules, locks, keyboard/focus return, narrow layouts. | Source reviewed; existing table-based checks need review; not run. |
| Suggested inspection | Incomplete/ambiguous/stale/prepared/reviewed/signed-off scopes; zero net variance with unresolved items; non-zero variance with zero unresolved count; current-close linkage; no readiness inference. | New cases need coverage; not run. |
| Finance containment | Tenant/identity server-owned; supplier settlement separate from Budget Actual; originals/reversals and versions separate; unchanged posting/recognition/close rules. | Older suites exist; current candidate has no new passing receipt. |
| Type/lint/build | Changed application and test TypeScript, focused lint, full Commercial containment and production build on the exact eventual candidate. | Not run for this bundle. |
| Disposable runtime | Synthetic organisations/actors; isolated PostgreSQL; production-runtime UI flows, database outcomes, event counts, read-only exports and tenant/role rejection. | Existing harness needs extension/review; not run for this bundle. |
| Review and release | Review all tracked/untracked candidate files, record exact commit/check outputs and remaining limits, then separately approved push/deploy and hosted smoke evidence. | Uncommitted local work; no new release action. |

### Validation order when the deferral ends

1. Inventory the exact candidate and inspect existing focused/component/static
   tests for assumptions changed by card/table extraction. Add meaningful missing
   model, route, export, navigation and component cases; avoid tests that merely
   mirror source text or rendered implementation details.
2. Run focused tests, application/test TypeScript, focused lint and the full
   Commercial containment suite. Fix failures and repeat the affected checks.
3. Build the production candidate, then extend/run disposable PostgreSQL and
   production-runtime browser acceptance. Review existing harness safety before
   executing it; never point fixtures at configured customer/Production databases.
4. Review generated reports and CSV/JSON files including hostile/large/empty
   evidence, keyboard/mobile flows and printed long-content pagination. Confirm
   read-only operations preserve finance facts and event counts.
5. Record the exact candidate and outputs, inspect the final diff including
   newly tracked files, and prepare reviewable commits. Release requires its own
   applicable authorisation; neither passing local checks nor a production build
   establishes a deployed result.

Existing validation entry points include `tests/components/commercial/`, the
Commercial files in `tests/containment/`,
`scripts/tests/verify-commercial-budgeting.ps1` and
`scripts/tests/verify-finance-controls-runtime.mjs`. These are starting points,
not assertions that their present cases cover the new bundle. TypeScript must
also be checked independently as described in the pilot document.

### Scope after close-out

New accounting-system connectors, file-import workflows, tolerance policies,
additional year-close reconciliation policy, customer setup and further interface
features are outside this acceptance pass. Existing deliberately deferred policy
decisions below remain unchanged. Additional work should be scoped after the
current candidate has been validated rather than silently extending it.

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
