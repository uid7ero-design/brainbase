# Commercial finance pilot

Prepared 7 October 2026, after finance runtime fixes in PR #375. This is a
walkthrough and implementation plan; it does not enable a customer capability
or create finance records.

## Released finance scope, 24 October 2026

The bounded finance evidence work was pushed and merged through PR #488 as
`b610301eb52dfedc3392bee4478b5755692f6f50`. Production deployment
`dpl_eNCvnS1srcaYeUQpkiwp1i8Axt6M` was READY. The usual
`brainbase-uid7ero-designs-projects.vercel.app` address was reassigned from the
previous release to that deployment and its resolved commit was verified.
Release CI passed 19,039 tests (64 skipped, plus the repository's three existing
excluded files). Live read-only checks confirmed the finance page's login
redirect and application Unauthorized responses from all three new evidence
endpoints. Authenticated customer workflows were not exercised in Production.

The earlier local-only and pending-release notes below are historical and do
not describe the final release state. The release's standard Turbopack build
passed; the additional local Webpack check found an existing Scheduling route
signature error introduced on main, outside this finance feature scope.

## Approved Help & How to addition, 25 October 2026

The user approved one bounded help section after the release. `/commercial/help`
explains setup order, everyday supplier bills/payments and reporting, a small
illustrative AUD subscription budget, plain-English terms, advanced controls and
recovery guidance. The Commercial sidebar shows its link for Purchasing or
Budgeting organisations. The page requires the existing session/capability/viewer
gate; destination links respect purchasing, budgeting and administrator access.
It adds no financial mutations, schema changes, imports or external services.

The starter example uses AUD 574 monthly / 6,888 annually, grouped into SOFTWARE
(6,408 annually) and HOSTING (480 annually), with explicit currency/tax-basis
confirmation and no automatic record creation. Payment guidance distinguishes
recording/reversing settlement from moving money and from Budget Actual.

This help addition is local work on `feat/commercial-finance-help`, not part of
the previously deployed finance commit. Validation and release state must be
reported for this addition separately.

Local acceptance passed: 144 tests across the help access/navigation suite and
the existing business-module design regression suite; focused ESLint; and
`npm run build` with an unreachable loopback build-only database URL. Standalone
renders of the real guide/header components and their styles were inspected at
1200px and 390px without page overflow. An axe scan of the rendered guide with
advanced details expanded passed 19 applicable WCAG A/AA rules with no violations.
These render checks do not exercise the authenticated hosted shell. Local
receipts, HTML and screenshots are under ignored `test-results/finance-help-*`.
No push, deployment, customer configuration or customer-data writes were made
for this Help addition.

## Historical local status, 24 October 2026

**The bounded finance evidence/interface implementation is locally validated and
committed as `bf4d4003`.** The prerequisite Next.js HR-route signature fix is
separate in `b76d1f48`. The branch remains `feat/finance-calendar-save-recovery`.
No push, hosted deployment, customer configuration or Production data change was
performed. Local production-build/runtime proof is not hosted release proof.

The user resumed completion/validation and required a yay/nay decision with an
explanation before any new feature. The finishing scope is frozen to adjustment
discovery/evidence, close/reconciliation inspection and navigation, history and
comparison, read-only CSV/JSON/HTML exports, readable controls and recovery/download
handling. Completion work added tests and corrected failures; it did not add a
new product feature.

Final local checks passed:

- 2,609 containment checks across 154 Commercial and affected HR test files.
- 51 focused component tests across four finance test files.
- Independent application/test TypeScript and focused lint.
- Production webpack build, with an unreachable loopback build-only database URL.
- All 30 disposable PostgreSQL verification gates and their integration suites.
- The full synthetic-account production-runtime browser regression in
  Australia/Adelaide, extended for evidence reads, history, comparison/swap,
  downloads, linked invalidated close inspection, Back/Forward and foreign-tenant
  rejection. Read-only acceptance preserved saved facts and finance event counts.
- Mobile evidence report rendered without horizontal overflow; its four-page A4
  print PDF was rendered to images and visually inspected, including continued
  table headers, retained identities and lifecycle details.

The [24 October validation receipt](c7-9-verification-matrix.md#local-evidence-validation-receipt-24-october-2026)
records commands, artifacts, fixes and limits. Earlier dated "not run" and pending
acceptance notes below describe development history and are superseded for this
candidate by that receipt. Scope expansion requires a new explicit decision.
The remaining release step is separately authorised push/deployment and hosted
smoke acceptance; it is not an unfinished feature bundle.

## Historical pilot readiness, 7 October 2026

Local finance setup candidate `2c119581` has passed the remediation review below
and is ready for a reviewed pilot release. Publishing and customer configuration
remain separate authorized steps. The earlier HOLD is retained as review history.

Finance controls, External GL mapping, reconciliation and finance-adjusted
reporting are implemented. The released fixes preserve calendar dates, restore
Neon event queries and serialize overlapping ledger imports by tenant/source/
entry identity. Supplier settlement remains separate from Budget Actual.

The release passed 2,182 Commercial containment tests, all 30 disposable
database verification checks, repository CI, a production build and the real
production-runtime walkthrough. The live AP overview loaded correctly. The
live Brainbase organisation still showed the budgeting administrator access
message, so customer finance mutations were not exercised there.

Enabling budgeting alone is not sufficient for an empty organisation. The
released app has no setup UI for creating years, periods, Budget accounts,
cost centres, budgets or draft Budget lines. Domain functions exist in
`lib/commercial/financialPeriods.ts`, `budgetAccounts.ts`, `costCentres.ts`
and `budgets.ts`, but are not exposed as a complete setup workflow. The
financial-periods route currently provides GET only. Budget activation has
an API, but does not supply the missing draft creation workflow.

External GL mapping has a UI; entry import currently has an administrator
JSON API, not a file-import screen or automatic accounting-system connector.

### Calendar setup implementation on this branch

`/commercial/budgeting/setup` now provides administrator year and period
creation, with its navigation item gated by budgeting access and role. New
POST routes create financial years and child periods. The API takes the tenant
from the session and validates real calendar dates, names and ordered ranges.
Year ranges may not overlap within an organisation. Periods must fit within an
OPEN parent year, may not overlap in that year, and have unique names there.
All date ranges are inclusive; an adjacent period starts on the following day.
Gaps are permitted and periods are explicit rather than generated automatically.

Separate transaction lock statements serialize year creation by organisation
and period creation by parent year. The period lock also coordinates with
existing year close/reopen. Existing records are neither rewritten nor deleted;
legacy internal creation helpers remain unchanged. No schema migration or
customer entitlement change is needed. Account, cost-centre and draft Budget
setup are described below. This branch is not yet released.

### Account and cost-centre setup implementation

The local setup page now includes Budget account and cost-centre creation and
deactivation. Administrator routes reuse the existing tenant-scoped domain
functions and audit helpers, validate code/name/description input, and map
duplicate tenant codes to HTTP 409. Inactive records remain listed and their
codes remain reserved. No hard-delete route is added. The initial stage omitted
reactivation; the release-review remediation below adds it for draft recovery.
Deactivation checks cover active Budget lines and commitment mappings for both
dimension types. Existing historical mappings and finance evidence are retained.

This stage passed 2,231 Commercial tests, focused lint, production build,
PASS=30 / FAIL=0 database verification and the extended real-runtime UI
walkthrough after Docker became available. Activation locks its referenced
accounts and cost centres after locking its version. Deactivation takes the
same dimension row lock before checking active references in a fresh statement.
Database barriers prove both activation-first and deactivation-first orders
for both dimension types. The integration fixture now includes the existing
production cost-centre updated_at column required by deactivation.

No customer configuration, capability or production record was changed.

### Draft Budget setup implementation

The local setup page now creates a Budget header and its first DRAFT version,
then supports line amounts, explicit commitment mappings and period allocations.
Amounts are decimal integer minor-unit strings validated against PostgreSQL
BIGINT range without converting through JavaScript Number. Account and cost-centre
references must be active and tenant-owned; allocation periods must belong to
the selected Budget year. Existing activation validation remains authoritative.
An ACTIVE version displays its saved configuration without editing forms, and
the API rejects further edits. This stage creates initial drafts only; it does
not expose later version creation or deletion.

Budget creation locks its financial year before checking OPEN status and writing
the header/version, coordinating with year close. The setup navigation and all
mutations require budgeting entitlement and administrator access. Calendar and
dimension changes refresh Budget choices without requiring a page reload.

This stage passed 2,252 Commercial containment tests, focused lint, production
build, PASS=30 / FAIL=0 disposable database verification and the real-runtime
walkthrough in Australia/Adelaide. The walkthrough creates the draft through
forms, rejects an unbalanced allocation, activates the corrected version,
verifies its active pointer and rejects subsequent edits. It also checks duplicate
headers, unauthenticated/viewer/unentitled/foreign-tenant access and mobile fit.
All setup changes remain local and have not been pushed or deployed.

## Decisions for the walkthrough

Confirm these values before creating a customer configuration:

| Decision | Needed for |
| --- | --- |
| Pilot organisation and administrator | Tenant scope and budgeting entitlement |
| Isolated demo or customer records | Keeping synthetic evidence out of customer finance history |
| Financial-year boundaries and period schedule | Calendar and close controls |
| Currency and inclusive/exclusive tax basis | Like-for-like Budget and ledger comparison |
| Annual-only or periodised budget | Allocation and activation validation |
| Account codes, cost centres and commitment mapping | Source Actual attribution |
| External ledger source, account and dimension codes | Explicit effective-dated mapping |
| Sample source and ledger evidence | A meaningful matched reconciliation |

Do not infer the customer's year boundaries from the runtime fixture. The
fixture's FY27, September and AUD values are synthetic examples only.

## Walkthrough after setup

Use an isolated demo organisation for synthetic posting, reversal and reopen
exercises. Posted facts and their history are intentionally durable.

1. Sign in as the pilot administrator. Confirm budgeting navigation and access;
   confirm that an unentitled organisation remains denied.
2. Create the agreed year and periods, accounts and cost centres. Verify the
   displayed start/end dates match the entered calendar dates.
3. Create a draft Budget, lines and commitment mapping. Validate its selected
   tax and periodisation basis, then activate the intended version.
4. Create explicit External GL account and dimension mappings whose effective
   dates cover the selected period. Check the mapping source filter.
5. In the demo, prepare a matched source and ledger example. The established
   runtime fixture uses 10,000 AUD minor units on both sides ($100). Import
   with a stable external identity, payload hash and lineage. Replay exactly:
   the API should return IDEMPOTENT for the same stored entry.
6. Open `/commercial/budgeting/finance-controls`, select year, period, source
   and currency, and prepare reconciliation. Confirm Source Actual, Finance
   Adjustments, Effective Actual, External GL total and variance independently.
7. Review the snapshot. Sign-off must remain blocked until the period is
   closed. Close the period, then sign off the reviewed reconciliation.
8. Inspect the reporting screen at `/commercial/budgeting/commitments` and its
   finance export. Check the selected source, exact amounts and evidence status.
9. In the demo, exercise year close/reopen and period reopen with reasons.
   Prior close records should become INVALIDATED, the reconciliation should
   become STALE, and the original amounts and event history should remain.
10. In the demo, verify a changed immutable import is rejected without replacing
    its original fact, while affected sign-off evidence becomes stale. A new
    affected ledger fact must also stale its sign-off.
11. At mobile width, verify metric cards fit and each history table scrolls to
    its final column. Check viewer and foreign-organisation denial separately.

Retain record IDs, entered dates, mapping IDs, source lineage, reconciliation
and close IDs, expected amounts, screenshots and outcomes. Do not describe a
zero-row customer screen as a passed monetary reconciliation.

## Administrator setup delivery and remaining work

Complete the setup workflow locally before the customer pilot. Keep the
existing session -> budgeting capability -> administrator role checks and
derive the organisation exclusively from the authenticated session.

Delivery slices:

1. Implemented locally: financial calendar creation and readback, with explicit child-period
   forms, date-only responses and server validation of boundaries. Define
   overlap/containment behavior against the existing schema and domain before
   exposing mutations; do not silently rewrite existing periods.
2. Implemented locally: account and cost-centre configuration, reusing domain functions and
   tenant uniqueness rules. Expose active/inactive state without deleting
   historical references.
3. Implemented locally: initial draft Budget configuration, header, lines, period allocations and explicit
   commitment mapping; reuse the existing version activation rules. Never
   make an incomplete draft ACTIVE as a setup shortcut.
4. Implemented locally: connect setup to mapping, reporting and finance-control
   screens with shared workflow links and guidance for missing prerequisites.
   The server shell supplies budgeting administrator access to those links;
   existing API authorization remains authoritative. Viewers retain reporting
   access without administrator workflow links. Filtered empty reports do not
   imply missing setup: guidance uses the unfiltered report rows and explains
   that operational activity or ledger imports may still be needed.

Acceptance requires a fresh, entitled demo organisation to complete setup
through the app without manual SQL, then complete the walkthrough above.
Verify malformed dates, tenant references, amount precision, duplicate/retry
behavior, activation failures, desktop/mobile layout, Commercial containment,
disposable database integration and production build. Push and deployment are
separate release steps after review.

## Pilot review packet

The local implementation now covers all four setup delivery slices. Review the
administrator journey from an empty finance-control screen to setup, then back
to mapping, reporting and finance controls. New dimensions must appear in mapping
choices, the calendar must appear in control selectors, and the activated Budget
must remain read-only after navigating back. No financial records are created
by navigation or guidance alone.

| Review item | State |
| --- | --- |
| Calendar, dimensions and initial Budget setup | Implemented and verified locally |
| Activation validation and ACTIVE edit protection | Verified locally |
| Shared workflow links and prerequisite guidance | Implemented locally; browser verification recorded in the verification matrix |
| Monetary reconciliation, close/reopen and sign-off | Existing disposable-runtime regression retained; synthetic source/ledger fixtures |
| Release review | GO for the scoped pilot setup release after verified remediation |
| Push and deployment | Not performed; require separate authorization after remediation |
| Pilot organisation, capability and financial configuration | Customer decisions pending |
| Customer pilot acceptance | Pending after release and agreed configuration |

The fresh second organisation proves setup through the UI and reference readback
in mapping and controls. The matched monetary reconciliation uses the existing
first organisation's synthetic fixture; do not describe it as a customer pilot
or a complete fresh-organisation source-posting walkthrough. Use the acceptance
steps above for that final pilot once its configuration is agreed.

### Initial release review decision, 7 October 2026

**Historical HOLD for candidate `d51b2df4`, superseded by the remediation review below.** Review scope is
`0fc2f2977891651546acee6d2460a6d7073e57e5..d51b2df4a9724560e78d67d05239a64ac1b1f230`,
the six finance setup commits. The Data Hub changes already present in the base
are excluded. The checkout was clean at review start. This review is a local
code/evidence review, not an independent second-agent review or live customer test.

**Confirmed release blocker (P2): a draft can be stranded by dimension deactivation.**
Create a draft with an account/cost-centre line, then deactivate that dimension.
Deactivation excludes only ACTIVE versions in `lib/commercial/budgetAccounts.ts:119-132`
and `lib/commercial/costCentres.ts:92-100`, so DRAFT references do not stop it.
Activation rejects the retained inactive reference in `lib/commercial/budgetActivation.ts:36`.
The existing real-database concurrency regression explicitly proves successful
deactivation followed by `INACTIVE_REFERENCE` for both dimension types
(`scripts/tests/budgetActivationConcurrency.integration.test.ts:155-188`).
The new UI exposes only Deactivate (`DimensionSetup.tsx:69`); the setup API supports
only line upsert, allocation and mapping (`lib/commercial/budgetSetup.ts:54-68`).
Adding a replacement line does not remove the inactive original. Codes remain
reserved, and a second Budget for the same tenant/year/currency is forbidden by
`scripts/create-commercial-budgeting.sql:70`. There is no app-based recovery path.
This is a usability/recovery blocker, not evidence of posted finance data loss.

Remediation should provide an administrator recovery path, such as audited
reactivation of the retained dimension or governed removal/replacement of DRAFT
references. Preserve ACTIVE/historical evidence and existing activation rules.
Acceptance must reproduce deactivation of a referenced draft dimension, recover
through the app, and activate successfully; exercise both dimension types and
access boundaries. Do not resolve this by bypassing inactive-reference validation.

**Non-blocking input validation issue (P2): enum values are coerced before checking.**
`lib/commercial/budgetSetup.ts:41` accepts JSON arrays such as
`taxBasis: ["INCLUSIVE"]` or `periodisationMode: ["PERIODISED"]` because String(array)
matches the enum. The original array then reaches the strict domain check in
`lib/commercial/budgets.ts:18-19`, which throws an unmapped Error rather than a 400
response. This path is established by code inspection, not a new runtime reproduction.
It fails before creation and does not admit malformed records. Require actual
string enum values and add malformed JSON-type coverage before release.

Positive evidence remains: 2,252 Commercial tests, focused lint and production build
passed on the candidate, and the real production-runtime walkthrough passed in
Australia/Adelaide. PASS=30 / FAIL=0 database verification was run for the preceding
Budget implementation; the final workflow-link commit changes no database logic.
Existing authentication/capability/admin gates, session tenant scoping, exact
minor-unit strings, activation/deactivation locking and ACTIVE edit protection
remain intact. The passing happy-path evidence does not cover draft recovery.

Next action: implement and verify draft recovery and strict enum validation, then
repeat the release review on the resulting commit. No push, deployment, entitlement
enablement or customer finance mutation is authorized by this review decision.

### Remediation review decision, 7 October 2026

**GO for the scoped pilot setup release on code candidate
`2c119581f86f7ecf89013c25f17ac5b047f2b426`.** Both initial findings are resolved.
The review includes the original finance-only diff from base `0fc2f297` plus
the recovery fix. This is a local implementation readiness decision; no PR,
remote CI result, deployment or customer acceptance is claimed.

Administrator Reactivate actions now restore retained accounts and cost centres
using a tenant-scoped, inactive-only UPDATE. Identity, codes, draft references
and historical records remain unchanged. Repeated requests return the retained
record without writing another reactivation audit. Audit recording follows the
existing best-effort configuration audit convention; it does not change the
durable finance evidence policy. Activation still rejects inactive references,
and ACTIVE Budget edits and dimension deactivation remain governed as before.

Budget tax basis and periodisation now require actual string enum values.
Array/object/null/boolean malformed input returns 400 before creation. The real
API regression also exercises both formerly accepted one-element enum arrays.

Verified against the same production build:

- 2,266 Commercial containment tests, including 63 focused setup/recovery tests;
- PASS=30 / FAIL=0 disposable PostgreSQL verification;
- focused lint and production build;
- actual login and Next production-runtime walkthrough in Australia/Adelaide;
- both dimension types deactivated while referenced by a draft, activation
  rejected, restored through UI, then the original draft activated successfully;
- retained session actor, one transition audit on retry, unauthenticated/viewer/
  unentitled/foreign-tenant denial, workflow readback and mobile viewport fit.

The evidence files are `draft-recovery-containment.log`,
`draft-recovery-integration.log`, `draft-recovery-lint.log`,
`draft-recovery-build.log`, `draft-recovery-runtime.log` and
`draft-recovery-adelaide/evidence.json` in the local finance-review artifact folder.
The build retains the pre-existing middleware deprecation and missing dashboard
copy warnings; neither prevented a successful build.

Remaining scope limits are intentional: this UI configures initial Budget drafts;
later version creation and line deletion are not exposed. Currency, financial
year and periodisation remain fixed. Name and tax basis corrections for
unpublished Budgets are described below. External
ledger import remains an administrator JSON API. The customer still needs an agreed
calendar, currency/tax basis, dimension codes, entitlement and pilot organisation.
No schema migration, capability enablement, push or deployment was performed.

Capability enablement is a separate customer decision, not a side effect of
setup or testing. Keep zero-cent reconciliation tolerance and the current
year-close policy; requiring an external sign-off for every year close remains
a deferred policy decision in the finance-close design.

## Budget allocation review

The setup screen now shows exact annual and period-allocation totals, checks
each line independently, and lists saved allocations in financial-calendar
order. Offsetting shortages and excesses cannot make the review appear balanced.
Amounts remain integer cents through calculation, including aggregate totals
above the database's single-value BIGINT range. Annual-only Budgets show their
annual total without period-allocation requirements. The activation action
follows the review; existing server activation validation remains authoritative.
A balanced allocation does not certify tax treatment or commitment mappings.

Verification: 12 focused calculation/rendered-component tests, 2,297 Commercial
containment tests, targeted lint and the production build passed. The disposable
Adelaide runtime verified shortage/excess feedback, corrected allocation and
activation, read-only ACTIVE behavior, and both review tables within the mobile
viewport. Evidence is in `allocation-review-focused.log`,
`allocation-review-containment.log`, `allocation-review-build.log` and
`allocation-review-runtime.log` under the local finance-review artifact folder.
No schema or customer finance data changes are required by this feature.

## Unpublished Budget settings corrections

Administrators can expand **Edit draft settings** to correct a Budget name or
tax basis before any version is activated, while its financial year is OPEN.
The settings belong to the Budget and apply to all its drafts. Tax-basis changes
do not recalculate money; annual lines, allocations, currency, calendar and
periodisation remain intact. A later draft cannot change settings inherited from
an ACTIVE or SUPERSEDED version. Existing session/capability/administrator checks
and tenant-scoped references remain authoritative.

The mutation locks the Budget and year, then versions in the same order as
activation, and rechecks eligibility in a fresh Read Committed statement. This
prevents a request that initially saw DRAFT from writing after publication or
year close. The existing configuration-audit convention records the session
actor and before/after name and tax basis after a successful mutation.

Verification: 40 setup boundary tests, all 2,310 Commercial containment tests,
targeted lint and production build passed. The disposable Adelaide runtime
verified populated forms, retained amounts/allocations, audit values, mobile
layout, ACTIVE and later-draft rejection, and database-gated activation/year-close
races. Evidence is `draft-settings-focused.log`, `draft-settings-containment.log`,
`draft-settings-build.log`, `draft-settings-runtime.log` and
`draft-settings-adelaide/evidence.json` in the local finance-review artifact folder.
No schema migration or automatic customer settings change is required.

## Saved draft line editing

Draft Budget review rows provide an Edit action that prefills the exact annual
amount in currency units. Account and cost centre remain fixed while editing;
Update line uses the existing line upsert and retains the line ID and period
allocations. Cancel sends no request, and switching versions clears the editor.
The review shows any allocation shortage or excess caused by the new amount.
ACTIVE versions do not offer editing; existing server controls remain in force.

Focused rendered tests cover exact BIGINT prefills, fixed submitted IDs, cancel,
busy controls and draft-only actions. The disposable runtime additionally checks
cancelled and saved amounts in PostgreSQL, retained identity and allocations,
restored balance, ACTIVE controls and the mobile editor.

## Saved draft allocation editing

Saved period allocations provide an Edit action with the exact currency amount
prefilled and fixed line/period identity. Updating uses the existing allocation
upsert, preserving the annual amount and other periods. Cancel submits nothing;
version switching clears the editor. Only one saved line or allocation editor
is open at a time. ACTIVE versions and unavailable references offer no enabled
allocation editing. The existing review reports shortages and excesses.

Rendered tests cover fixed submitted IDs, exact BIGINT values, cancel, busy and
ACTIVE restrictions. Disposable runtime checks cover persisted amounts, invalid
input, cancellation, version switching, annual amount preservation, restored
balance and mobile layout. No migration or customer Budget change is required.

## Draft activation guidance

A Before activation checklist explains missing lines/mappings, a closed or
unavailable year, inactive/unavailable dimensions and allocation problems from
the loaded setup snapshot. It updates after setup saves and dimension changes,
and disappears on ACTIVE versions. It does not promise activation or replace
the server's fresh transactional validation. The existing activation controls
and authorization remain unchanged. Mapping guidance explicitly explains that
each cost centre routes commitments to one account, and saving again replaces
that account. No customer mapping or tax decision is automated.

Rendered tests cover empty/balanced drafts, missing mappings/year/periods,
inactive mapping references, exact offsetting imbalances and annual-only rules.
The disposable runtime checks progression through missing setup, imbalance,
balance, deactivation and activation without weakening server validation.

## Commitment mapping management

Saved mappings use the shared scrollable table with cost-centre/account codes,
reference status and draft-only Edit actions. The editor prefills the saved
account and fixes cost-centre identity. Updating uses the existing mapping
upsert, preserving mapping identity and all Budget amounts/allocations. Cancel
and version switching discard unsaved editing. Inactive saved accounts remain
visible; updating requires an active chosen account and cost centre. The
activation checklist links directly to the mapping setup section. ACTIVE
versions retain a readable mapping table without editing controls.

Rendered and disposable PostgreSQL/runtime checks cover prefills, fixed IDs,
cancel, version switching, retained identity/amounts/allocations, reset after
save, inactive references, ACTIVE visibility, checklist navigation and mobile
layout. No schema or authorization change and no customer mapping is created.

## Activation issue navigation

The draft checklist links missing lines to line setup, allocation problems to
the exact per-line amount review, and inactive references to account and
cost-centre setup. A financial-year warning links to Finance controls, where
year status is governed. Corrective links disappear when their issue resolves;
the mapping review link remains available for the required routing check.
In-page destinations accept keyboard focus and leave space below the header.
Navigation changes no saved amounts, settings or activation state. The checklist
remains loaded-snapshot guidance and does not replace server validation.

Rendered checks cover link destinations, conditional visibility and resolution.
The disposable runtime checks navigation, destination focus and unchanged
Budget behavior through line creation, allocation correction and dimension recovery.

## Returning from saved Budget edits

Saved line, allocation and mapping editors return focus and scroll position to
their corresponding saved review after cancellation or a successful save/readback.
Failed saves retain the populated editor. Creation forms keep their existing
navigation behavior. Cancellation clears the dismissed error and confirms that
saved records are unchanged; it sends no request. Returning to review uses an
instant scroll and the existing header spacing. Rendered parent-component tests
cover all three editors for cancellation, successful readback and rejected saves;
the disposable runtime checks focus alongside persisted record invariants.

## Saved Budget setup exports

The selected version provides CSV downloads of saved lines, allocations and
commitment mappings from its loaded setup snapshot. Each row identifies the
Budget, financial year, version, status, currency, tax basis and periodisation.
Money is exact currency-unit text with two decimals; period dates use
DD/MM/YYYY. Line exports retain per-line shortage/excess checks. Annual-only
allocation values are not applicable rather than zero. Missing or inactive
mapping references remain explicit. Empty collections and busy saves disable
their export controls. Unsaved editor values are excluded; no server mutation,
activation, Actual calculation or approval is implied by downloading a file.

The shared CSV serializer retains BOM/CRLF and quoting; text fields apply the
Commercial formula-prefix protection, including leading whitespace and controls.
Focused checks cover exact BIGINT amounts, offsetting imbalances, calendar order,
reference status, formula-like text, disabled controls and temporary URL cleanup.
The disposable runtime downloads all three files during an unsaved edit and
checks their contents, dates, saved amounts and absence of finance POST requests.

## Financial calendar save recovery

Year and period creation use a synchronous submission lock. A lost response,
server failure, or incomplete successful response pauses both calendar editors
until an explicit GET-only reload succeeds. Failed reloads retain entered values
and the save lock. A successful reload clears unsaved calendar entries, returns
focus to financial-period review, selects the recovered year where available,
and refreshes the parent Budget calendar. Rejected saves remain editable. An
initial calendar read failure does not claim that the organisation has no years.
Closed years continue to prevent period creation.

The disposable runtime deliberately loses a real year-creation response after
PostgreSQL commits, attempts duplicate submission, fails the first reload, then
recovers with GET. Database rows and audit events prove that exactly one year was
created and that recovery did not resubmit it. Component checks also cover
period recovery and incomplete successful responses.

## Budget account and cost-centre save recovery

Both dimension editors use a synchronous lock across creation, deactivation and
reactivation. An uncertain or incomplete save response pauses mutations until a
GET-only reload succeeds. A failed reload retains entered values and the lock;
a successful reload clears unsaved entries, focuses the section heading and
refreshes parent Budget references. Rejected saves remain editable and keep the
saved status. Initial load failures show records as unavailable rather than empty.
Existing server role, tenant and active-Budget restrictions remain authoritative.

Focused component checks exercise creation and both status transitions for each
resource. The disposable runtime loses real creation and deactivation responses
after persistence, fails a reload, then checks the recovered UI against PostgreSQL.
It verifies retained IDs, exactly one audit event per mutation, actor attribution,
and existing access and active-Budget restrictions. These changes do not write
Budget Actual or reconciliation records.

## Complete saved Budget snapshots

Budget setup validates all four read responses before replacing its saved view:
versions and nested lines, allocations and mappings; the financial calendar; and
account/cost-centre records. Missing collections, malformed references,
numeric money values and invalid integer strings pause editing, activation and
exports through the existing recovery flow. A failed reload retains the last
complete view and requires another explicit reload. A committed save with an
incomplete readback is recovered with GET rather than repeating the mutation.
Amounts remain exact strings, including values beyond JavaScript's safe integers.
Missing or inactive dimension references remain visible for corrective review.

Component checks cover each response, malformed nested collections and amounts,
readback recovery and large exact amounts. The disposable runtime corrupts a real
Budget read response, verifies paused controls and retained saved amounts, then
recovers through GET and proves no POST or database line change occurred.

Snapshot recovery validation passed 13 focused checks and 2,470 Commercial tests,
standalone TypeScript, targeted lint and the production build. The first complete
browser run timed out after five seconds waiting for an existing allocation save
at the Balanced check while the UI remained busy; its evidence is retained in
`snapshot-recovery-runtime-first.log`. The unchanged rerun passed the full flow
(`snapshot-recovery-runtime-retry.log` and `snapshot-recovery-adelaide-retry`).

## Coordinated finance setup recovery

An uncertain calendar, account or cost-centre save now pauses Budget editing,
activation and exports as well as the affected setup editor. A named recovery
region links to each unresolved section. Reloading Budget alone does not clear
a source's uncertain outcome. Successful source recovery refreshes the Budget
snapshot; changes remain paused until that snapshot matches the latest setup
revision. Multiple unresolved sections must each recover. Authoritative rejected
saves leave the unchanged Budget usable.

The synchronous setup revision/recovery check also guards submissions before new
props render. Revisions received during a Budget save are read after it finishes,
preventing the view from remaining stale. Failed source reloads retain the lock.
Role, tenant, lifecycle and active-Budget restrictions remain server-authoritative.
The browser runtime loses real dimension reactivation responses, proves that a
Budget-only reload cannot unlock changes, then recovers the source and checks
fresh controls, retained exact line amounts/references, and one reactivation
audit event. No Budget mutation is sent while source recovery is unresolved.

Coordination validation passed seven focused checks on rerun, 2,477 Commercial
tests on the final candidate, standalone TypeScript, targeted lint, the production
build and the full disposable browser/PostgreSQL flow. The initial focused run
hit the existing five-second test deadline; its output is retained separately in
`setup-coordination-focused-first.log`. The unchanged focused rerun passed before
the final full-suite run. Runtime evidence and mobile capture are in
`setup-coordination-runtime.log` and `setup-coordination-adelaide`.

## Budget reporting read recovery

Budget reporting now catches failed requests and undecodable responses for the
report, External GL source list and reconciliation queue. A missing report,
incomplete report collections/counts, malformed source collection or missing
queue item collection is unavailable rather than an empty successful result.
This is a collection-boundary check, not a new validator for every report row.

`Reload report` reads both the report and queue again for the selected source.
The source selector remains available during loading and failure. Results are
associated with their source and reload, and cancelled reads are checked again
after body decoding so delayed old-source responses cannot overwrite the current
view. Exports are unavailable while the report is loading or failed. A failed
queue displays an unavailable count rather than zero; a valid report remains
independently usable. Source-list recovery uses the existing `Refresh sources`
control and retains its last successful choices while unavailable.

The bundle preserves operational payable recognition, numeric legacy reporting,
exact-string finance amounts, source provenance, filters and full-report CSV
semantics. It adds no mutation, migration or release action. Seven component
checks cover report failure/retry, denied access, source recovery, independent
queue recovery and delayed source responses. The disposable runtime interrupts
real API responses, recovers both reads and checks that recovery sends only GET
requests. Evidence uses the `report-recovery` prefix in the local finance-review
artifact folder.

Final validation passed 2,484 Commercial tests across 155 files, standalone
TypeScript, targeted lint, the production build and the full disposable runtime.
The first runtime assertion also matched Next's hidden route announcer. The
assertion now selects the visible report error by its text; the complete rerun
passed. Both outputs are retained as `report-recovery-runtime-first.log` and
`report-recovery-runtime-retry.log`. The reviewed screenshot is
`report-recovery-adelaide-retry/report-recovery.png`.

## External GL mapping recovery

Account and cost-centre mapping editors now hold a synchronous operation lock
through POST and complete readback. Lost responses, incomplete successful
responses, server failures and failed readback pause further creates and
retirements. Authoritative rejected saves retain editable inputs. No mapping
is automatically resubmitted.

`Reload saved mappings` checks all four governed GET responses: sources, account
mappings, cost-centre mappings and active reference data. Incomplete collections
or malformed records do not replace the previous saved view. A failed reload
retains entered values and the recovery lock. A successful reload clears unsaved
forms and retirement dates, then focuses the saved review heading. Initial read
failure does not display fabricated empty mapping tables or setup guidance.
Source/status changes invalidate previous reads before loading; delayed decoded
bodies cannot replace the current filter's view. Filters are locked during an
operation or unresolved recovery.

The bundle preserves explicit dimension IDs, mapping dates, overlap rejection,
retirement semantics, tenant boundaries and existing API contracts. It changes
no database schema or reconciliation rules. Twelve component checks exercise
incomplete reads, both uncertain creates, confirmed-response/readback failures,
authoritative rejection, retirement recovery, duplicate submissions and delayed
filter bodies. Disposable runtime checks commit both kinds of create and
retirement before interrupting responses, then prove GET-only recovery, failed
reload retention, one durable identity and authenticated actor ownership.
Evidence uses the `mapping-recovery` prefix in the local finance-review folder.

Final validation passed 2,496 Commercial tests across 156 files, standalone
TypeScript, targeted lint, the production build and the disposable browser /
PostgreSQL runtime (`mapping-recovery-runtime-final.log`). The first runtime
also passed; its mobile capture exposed review focus beneath the fixed header.
The final candidate adds explicit scrolling with header clearance and repeats
all validation. The reviewed mobile capture is
`mapping-recovery-final-adelaide/external-gl-mobile.png`.

## Finance control lifecycle recovery

Finance controls now loads one complete selected-scope view: calendar and close
history, source choices and reconciliation control state. Failed or incomplete
reads retain the previous view and pause actions; initial failure is not an empty
calendar or queue. Reconciliation amounts remain exact integer strings, including
values beyond JavaScript's safe numeric range. Scope changes invalidate previous
reads before starting the replacement, including delayed body decoding.

All seven lifecycle actions hold a synchronous lock through POST and readback.
An uncertain response, incomplete success or failed readback requires read-only
Refresh before further actions. Authoritative rejection preserves editable
reasons. Failed recovery retains reasons and notes; successful Refresh clears
them and focuses the saved heading with clearance for the fixed header. Scope
choices and action inputs are locked during mutation and unresolved recovery.

The bundle preserves server-governed close, reopen, review and sign-off rules,
current-close identity, historical evidence, explicit source/currency scope and
tenant authorization. No endpoint, database schema or finance calculation changes.
Seventeen component checks cover unavailable versus empty state, exact amounts,
all lifecycle actions, incomplete response/readback, rejected actions, duplicate
submissions and scope races. The disposable runtime interrupts the committed
response of each lifecycle action and proves recovery without repeat POSTs,
including failed GET retention and unchanged durable event counts. Evidence uses
the `controls-recovery` prefix in the local finance-review folder.

Final validation passed 2,513 Commercial tests across 157 files, standalone
TypeScript, targeted lint, the production build and the full disposable runtime.
Two new assertions were corrected to supply administrator context and use the
existing dollar formatter. A subsequent run hit an unchanged Budget focus
assertion; the unchanged full rerun passed. Those outputs remain in
`controls-recovery-commercial-first.log` and
`controls-recovery-commercial-retry-first.log`.
The first runtime reached the expected recovery state but its label selector
could not find the disabled notes textarea. Selecting its accessible textbox
name resolved the assertion; the complete rerun passed in
`controls-recovery-runtime-retry.log`. The first output is retained in
`controls-recovery-runtime-first.log`. Reviewed captures and structured evidence
are in `controls-recovery-adelaide-retry`.

## Australian dates and finance scope consistency

External GL account and cost-centre mapping forms now use explicit DD/MM/YYYY
entry, including retirement dates. Conversion to ISO calendar text happens only
at submission; API payloads and stored DATE values remain unchanged. Impossible
dates and reversed ranges retain user entries and send no write. Saved mappings
also require real, ordered calendar boundaries before they can unlock editing.
Mapping forms use equal-width columns with consistent spacing, reducing to two
columns and then one column on smaller screens. Retirement date controls lock
alongside other inputs while a save or recovery is unresolved.

Finance controls display year and period boundaries day first. Audit timestamps
use en-AU notation, 24-hour time and an explicit timezone label in the viewer's
timezone. Calendar DATE values are never converted through an instant. Complete
control views reject invalid calendar/audit dates and periods outside their year.
Reconciliation results must belong to the resolved year, period and any selected
source/currency before they replace the saved view or enable actions.

Successful mapping acknowledgements must match the submitted source, code,
dimension and dates (or retirement identity and date). Finance acknowledgements
must match the targeted year, period or reconciliation, including source/currency
and the current close for sign-off. A mismatch keeps the existing recovery lock;
GET-only recovery checks saved state without repeating a committed action. Automatic
scope effects and their queued callbacks cannot start a read during an action or
unresolved recovery, preventing a scheduled refresh from clearing that lock. No
endpoint, schema, authorization rule or finance calculation changes.

Focused coverage includes Australian entry and leap dates, no-write validation,
invalid saved dates, wrong-scope reads and mismatched successful acknowledgements.
The expanded disposable runtime verifies day-first UI dates against unchanged
ISO API/database values, no POST for invalid entry, wrong-period read recovery,
and committed Review, period close and year close with mismatched acknowledgements.
Other lifecycle and mapping actions retain lost-response recovery proof. All
checks continue to use the isolated local database, real login and production
runtime. Evidence uses the `finance-consistency` prefix in the local finance-review
folder.

The final full Commercial run passed 2,544 tests across 157 files, with standalone
TypeScript and targeted lint clean. Initial focused fixtures were corrected to
represent the real acknowledgement contracts after an interrupted fixture edit;
that output remains in `finance-consistency-focused.log`. A subsequent focused
run exposed the queued automatic-refresh race above; its output remains in
`finance-consistency-focused-final.log`. The guard and no-automatic-GET assertions
passed in `finance-consistency-commercial-final.log`. The first production build
and expanded runtime passed before the guard. After the correction the production
build and complete expanded runtime passed again; final logs are
`finance-consistency-build-final.log` and `finance-consistency-runtime-final.log`.
Reviewed screenshots and structured evidence are in
`finance-consistency-adelaide-final`. Mobile page width remains 390px at a 390px
viewport, with mapping forms stacked and history tables contained for scrolling.

## Complete Budget reporting snapshots and mobile review

Budget reporting now validates every consumption row, exact finance row, Actual
and Commitment exception, reconciliation snapshot and nested unresolved item
before it can render as a saved result. Legacy cents remain safe integer numbers;
finance cents remain signed integer strings, including values beyond JavaScript's
safe numeric range. Nullable unknown measures remain null, distinct from zero.
Required provenance, counts, statuses, currency and audit/calendar dates are
checked without recalculating amounts or changing recognition/settlement rules.

A malformed report prevents all report exports until a complete GET succeeds.
An unavailable reconciliation queue leaves a separately valid report and its
exports usable, and shows Unavailable rather than a zero count. Finance rows can
carry ledger evidence only for an explicitly selected matching source; the queue
retains its documented all-source scope when none is selected. Malformed source
choices preserve the last valid choices and selection. Source refreshes now read
without cache, as the report and queue already do. Delayed prior-scope bodies
remain unable to replace the current response.

Summary cards stack on small screens. Currency summaries can shrink below their
previous minimum width, and the source selector stays within its container.
Resolved consumption, finance-adjusted reporting, exception tables and each
reconciliation detail table are named keyboard-focusable scroll regions. Queue
summaries also show the prepared timestamp using Australian notation and an
explicit timezone label. UI table filters continue to leave CSV export scope
unchanged; export values still come from the governed server endpoints.

Focused checks cover malformed rows/items/amounts/counts/dates/provenance,
source mismatches, nullable measures, exact large strings, export availability,
GET-only recovery and failed source-choice refresh retention. The disposable
runtime prepares an actual new reconciliation variance, compares its API snapshot
identity and variance with PostgreSQL, corrupts each report collection and a
selected-source response, then corrupts an item's currency. Browser verification
also downloads the finance CSV through its scoped UI link and compares its exact
amounts and source provenance with the same saved report. Recovery must retain
the selected source, distinguish unavailable detail from a valid report, and send
only GET requests without adding durable finance events. Mobile checks verify page width and scrolling to the last detail column. Evidence uses
the `report-integrity` prefix in the local finance-review artifact folder.

Final validation passed 2,585 Commercial tests across 158 files, standalone
TypeScript, targeted lint, the production build and the full expanded disposable
runtime. The initial 55 focused checks and both full Commercial runs were green;
the second full run includes the completed source-refresh retention checks.
Evidence is in `report-integrity-commercial-final.log`,
`report-integrity-types-final.log`, `report-integrity-lint-final.log`,
`report-integrity-build.log` and `report-integrity-runtime-final.log`.
The first runtime also passed; a screenshot-positioning adjustment was verified
by the complete final rerun. Reviewed desktop/mobile captures, the exact CSV and
structured evidence are in `report-integrity-adelaide-final`. The new report snapshot remains separate from older
STALE finance-adjusted evidence: a PREPARED queue variance does not grant sign-off
or overwrite the report's governed reconciliation basis.

## Explicit report scope and filter recovery

A successfully refreshed source list can no longer silently change a selected
finance source into BrainBase-only reporting. If the selected source disappears,
the selector retains a disabled unavailable option, focuses the control, pauses
report/queue reads and hides both CSV links. The administrator or viewer must
choose an available source, explicitly choose BrainBase only, or refresh sources
until the original choice returns. A failed or malformed source refresh preserves
the previous choices and report. Source choices reject surrounding whitespace so
the visible selection agrees with the exact resolved source identity. Every
successful manual source refresh requires fresh report and queue reads; restored choices cannot re-enable an older snapshot.
Delayed responses from a removed scope remain cancelled through body decoding.

Refreshed report dimensions can leave a previously chosen table filter absent.
Each such selector keeps a clearly labelled unavailable option, with a notice
identifying the affected filters. Clear unavailable filters resets only those
selections and retains valid account/currency/other choices. The existing Clear
filters action still resets all filters when deliberately selected. No filters
are silently discarded. Queue scope and governed CSV scope remain independent
of these table filters, including while a table-filter correction is needed.

Manual reloads and explicit source choices focus the failed report alert or the
successfully loaded heading, with clearance for the fixed header. A loaded report
announces the resolved source scope of its finance-adjusted rows; the independent
all-source queue remains explicit when BrainBase only is selected. Source loss
focuses the selector, while an unconfirmed report or missing source never becomes an authoritative empty view.

The bundle changes client review behaviour only. It adds no endpoint, schema,
mutation, calculation, recognition or settlement rule. Focused checks cover each
filter dimension, selective clearing, missing/restored/failed source choices,
fresh-read requirements, stale response cancellation, source-scoped export links
and error/success focus. The expanded disposable runtime reuses real saved
finance data and intercepts only read responses to simulate removed source and
period choices. It verifies no implicit fallback requests, fresh restored reads,
explicit BrainBase-only export scope, retained valid filters, CSV scope independent
of table filters, keyboard focus and GET-only recovery without new finance events.
Evidence uses the `report-review` prefix in the local finance-review folder.

Final validation passed 2,600 Commercial tests across 159 files, standalone
TypeScript, targeted lint and the final production build. Fourteen focused review
checks plus the malformed whitespace-source case were added in this bundle.
The scope-message refinement was checked again in the focused review file before
the final build. Logs are `report-review-commercial-final.log`,
`report-review-types-complete.log`, `report-review-lint-complete.log`,
`report-review-build-complete.log` and `report-review-runtime-final.log`.

The first browser run reached the correct BrainBase-only result but assumed an
annual-only fixture would have finance-adjusted rows. The assertion was corrected
to compare the real API result and require an empty section with disabled finance
export when no rows exist; the complete rerun passed. The initial output remains
in `report-review-runtime.log`. Reviewed mobile captures and structured evidence
are in `report-review-adelaide-final`. No domain behaviour was changed to satisfy
the test, and no release action was performed.

## Exact totals and finance evidence coverage

Resolved Budget summaries now group by currency and tax basis and accumulate
validated safe numeric row amounts with BigInt. A sum can exceed JavaScript's
safe integer range even when each row is safe; the display retains exact cents
instead of rounding the aggregate. Inclusive and exclusive bases do not share a
summary card. Legacy row/API/export contracts remain numeric and unchanged.

Finance-adjusted summaries add exact Budget, Source Actual, Finance Adjustments,
Effective Actual, Committed and Exposure totals for the filtered account, period
and currency rows. Cost-centre filters remain inapplicable to this finance grain.
Amounts group separately by currency and known or unavailable Budget tax basis.
An unavailable Budget basis yields an unavailable summary Budget measure rather
than presenting an unqualified zero allocation.

External GL and variance totals appear only when every included row has both
monetary measures and an identified signed-off or stale snapshot from a source.
Incomplete coverage yields Unavailable, never a partial or fabricated zero total.
Identified snapshot row statuses are counted separately from complete monetary
coverage, so a stale row remains flagged even if its variance is unavailable.
These are row counts, not unique reconciliation counts or a new approval status.
A fully qualified zero ledger total remains zero. Stale rows are explicitly
flagged, and no totals card grants sign-off or replaces the reconciliation queue.

Summary cards wrap on mobile, including long exact amounts. Report count cards
have named accessibility groups so unavailable queue counts remain distinguishable
from unavailable ledger measures. CSV scope and contents remain governed by the
existing server exports; this bundle adds display summaries without changing any
server finance calculation, database schema, posting/settlement or authorization rule.

Focused checks exercise safe-row/unsafe-total aggregation, exact signed strings,
separate currencies/bases, unknown Budget basis, real zero evidence, partial
provenance, stale status with missing measures, input immutability and filter scope.
The disposable runtime checks actual saved legacy and stale finance summary values,
then intercepts read responses for large individually safe rows, mixed tax bases
and missing variance evidence. It verifies exact display, mobile containment and
recovery to the real saved view without changing finance events. Synthetic read
cases are display proof; they are not acceptance of unsafe legacy row amounts by
the database or the API. Evidence uses the `report-totals` artifact prefix.

Final validation passed 2,623 Commercial tests across 161 files, standalone
TypeScript, targeted lint, the production build and the complete disposable
browser/database runtime. Desktop, mobile and incomplete-evidence captures were
reviewed; the mobile document remained 390 pixels wide at a 390-pixel viewport.
Logs are `report-totals-commercial-final.log`, `report-totals-types-final.log`,
`report-totals-lint-final.log`, `report-totals-build.log` and
`report-totals-runtime.log` under the local `brainbase-finance-review` artifact
directory. Structured evidence and captures are in `report-totals-adelaide`.

The first full suite exposed an existing global Unavailable selector that also
matched the new, correctly unavailable ledger measures. The queue count assertion
now targets its named accessibility group; its recovery checks remain intact.
The initial result is retained in `report-totals-commercial.log`. This bundle
adds 23 checks and makes no push, deployment or production-data change.

## Consistent row precision and finance evidence

Resolved Budget table amounts now use the same exact-cent formatter as their
summary cards. Safe numeric cents can still lose a cent when divided into a
floating-point dollar amount near the safe-integer boundary. All six monetary
columns retain the original cent value, including negative planning measures.
The numeric wire and existing CSV contracts remain unchanged.

The finance table now states each row's Budget basis and shows Unavailable for
the Budget measure when that basis is unknown. A known allocation of zero
continues to display as money. Source Actual, adjustments and other operational
measures remain independent of Budget availability.

Table rows and summaries share display qualification for reconciliation
evidence: a nonblank snapshot identity, source, SIGNED_OFF or STALE status, and
both ledger amount and variance are required to present the pair as complete
evidence. Incomplete rows show Unavailable for both ledger measures and explain
that evidence is incomplete. An identified stale status remains visible even
when money is unavailable; a row without an identified snapshot says so.
Qualified stale values retain their historical amounts and status. These
display checks do not approve, refresh or mutate any finance record.

Rendered tests compare table and summary evidence, known zero versus unknown
Budget basis, both snapshot statuses, incomplete identity and monetary pairs,
and positive/negative safe-integer boundaries. The disposable runtime verifies
real saved unknown-basis and stale rows, intercepted exact safe row amounts,
partial monetary evidence, last-column mobile scrolling and recovery to the
saved view without adding finance events. Synthetic intercepted responses
remain display proof rather than database acceptance of those amounts.

Final validation passed 2,638 Commercial checks across 162 files, standalone
TypeScript, targeted lint, the production build and the full disposable runtime.
The bundle adds 15 rendered checks. Desktop and mobile captures were reviewed;
the finance table's final evidence columns remain reachable at mobile width.
Logs use the `report-row-evidence` prefix under the local
`brainbase-finance-review` artifact directory. The final suite receipt is
`report-row-evidence-commercial-final.log`; runtime evidence and captures are
in `report-row-evidence-adelaide`.

An initial full-suite run alongside the build timed out in two existing
repository-scan checks. The complete rerun passed with two workers and the same
assertions and time limits. Its initial output is retained in
`report-row-evidence-commercial-full.log`. A mixed-basis test fixture now uses
distinct cost-centre identities to avoid duplicate React keys. No push,
deployment, schema or production-data change was performed.

## Administrator ledger entry import and identity recovery

The External GL screen now includes a single-entry administrator import form.
It takes the original ledger source and external entry identity, account code,
transaction date, currency, signed decimal amount, evidence hash and lineage.
Optional journal, cost centre, period and description references are retained.
Dates use DD/MM/YYYY, and signed amounts convert directly to exact integer
strings within PostgreSQL's signed BIGINT range. Source evidence is supplied
by the administrator; this screen does not fabricate hashes or lineage. Preview
and the import service enforce the existing database minimum of 32 hash
characters, returning useful validation instead of a constraint-driven 500.

Review displays every submitted fact before confirmation. Cancelling preserves
the form and writes nothing. Import uses the established immutable domain
function and tenant/session actor. Exact duplicates return the saved entry;
changed immutable facts retain the original entry and follow the existing
conflict/staleness rules. Receipts must include matching immutable facts,
an exact amount, calendar date, import timestamp and complete outcome metadata.
Any affected stale snapshot count directs the user back to Finance controls.

An unconfirmed response pauses imports with the original reviewed facts intact.
Check saved entry performs an administrator, tenant-scoped, uncached identity
GET and compares every immutable fact. It never resends the POST. A missing,
incomplete or wrong-scope readback cannot unlock an uncertain attempt; a late
commit can become visible on a later check. Matching saved facts confirm
persistence without claiming the original import outcome or stale-event count.
A different saved fact is shown as an immutable conflict, and the administrator
can explicitly start a separate entry with its own identity.

Lookup requires budgeting entitlement and administrator access, binds source
and entry identity as query parameters, derives the tenant only from session,
and returns explicit null for an entry outside that tenant. Dates and amounts
are selected as text to preserve calendar and cent precision. It introduces no
schema, migration, posting/settlement change or accounting-system connector.
The existing import endpoint and server reconciliation rules remain authoritative.

Tests cover signed bounds, malformed precision and dates, all immutable fields,
preview/cancel, duplicates, conflicts, uncertain receipts, failed/absent/foreign
readback, duplicate-click prevention and authorization. Disposable runtime
acceptance imports through the real form/API, verifies persisted exact signed
amounts and actor, replays a duplicate, checks a conflict and interrupts a
committed response before recovering through GET-only reads. It also exercises
viewer/tenant/entitlement denial and mobile review containment.

Final validation passed 2,697 Commercial checks across 165 files, standalone
TypeScript, targeted lint, the final production build and the full disposable
browser/database runtime. This bundle adds 59 checks. Final logs are
`ledger-import-commercial-complete.log`, `ledger-import-types-final-complete.log`,
`ledger-import-lint-complete.log`, `ledger-import-lint-fixtures.log`,
`ledger-import-build-complete.log` and `ledger-import-runtime-final.log` under
the local `brainbase-finance-review` artifact directory. A typed test-mock cleanup
is covered by the additional `ledger-import-lint-final.log` and focused final run.
Reviewed mobile/desktop captures and structured evidence are in
`ledger-import-adelaide-final`. The mobile document fits its 390-pixel viewport.

The first runtime attempt exposed a short evidence hash reaching the existing
database CHECK constraint. The new preview/service validation fixes that gap,
and the final runtime verifies HTTP 400 for a short hash. The initial output
remains in `ledger-import-runtime.log`. The intermediate full suite exposed
seven supported-amount cases using an unrealistically short hash fixture; those
fixtures now satisfy the database minimum so the cases exercise money validation
again. Its receipt remains in `ledger-import-commercial-final.log`; the complete
rerun passed. No schema, production data, push or deployment action was performed.

## Saved ledger history, scope and page exports

External GL now includes administrator ledger history, refreshed after a
confirmed import or identity recovery. History filters are independent of the
mapping filters: exact source and account code, currency and inclusive transaction
date boundaries. Browser dates use DD/MM/YYYY and convert to validated ISO
calendar values before the read. Invalid dates, reversed ranges and unbounded
filter/page inputs are rejected without a database query.

The history endpoint applies the session tenant and administrator/budgeting
authorization. One SQL statement provides a stable page, matching count and
currency-grouped totals from the same filtered statement snapshot. Pagination
uses 25 rows and deterministic transaction-date/import-time/ID ordering. Signed
SUM results are text, retaining precision even above a single BIGINT's range.
These totals sum matching imported entry amounts; they confer no reconciliation,
posting, settlement or Budget Actual status. No schema change is needed.

The client validates all saved fields, requested scope, page size/count,
currency totals and each row's filter membership. A superseded response cannot
replace a newer request. Loading, failed, incomplete or wrong-scope reads hide
details and disable export until a fresh complete read succeeds. Empty results
are distinct from unavailable results. An empty page beyond the latest matching
count offers a return to page one.

Evidence details retain saved identity, hash, lineage, journal, external cost
centre, period reference and description. The CSV export contains only the
confirmed displayed page, explicitly labelled in both the screen and filename;
the aggregate cards cover all matching rows across pages. Changed filter fields
disable export until applied. CSV uses exact integer strings and ISO dates and
protects spreadsheet text from formula prefixes, including leading whitespace.
Negative cent strings follow the existing serializer's text-protection convention.

Focused checks cover filter/date boundaries, tenant authorization, a one-statement
query, snapshot incompleteness, page sizes, separate currencies, exact large sums,
CSV lineage/text protection, applied scope, details, recovery and superseded reads.
Disposable browser acceptance imports 27 synthetic facts through the existing
API, reviews 25/2 pagination and currency totals, checks inclusive dates and page
CSV, interrupts history reads, verifies GET-only recovery without finance events,
and checks mobile scrolling plus viewer/tenant/entitlement boundaries.

Final validation passed 2,740 Commercial checks across 167 files, standalone
TypeScript, targeted lint, the final production build and complete disposable
browser/database runtime. This bundle adds 43 checks. Final receipts use the
`ledger-history` artifact prefix under `brainbase-finance-review`:
`ledger-history-commercial-complete.log`, `ledger-history-types-verified.log`,
`ledger-history-lint-verified.log`, `ledger-history-build-final.log` and
`ledger-history-runtime-final.log`. Reviewed desktop/mobile captures, the exact
page-two CSV and structured evidence are in `ledger-history-adelaide-final`.
The mobile document remains 390 pixels wide and the final evidence column is
reachable by scrolling its table rather than overflowing the document.

The first complete runtime passed; a subsequent refinement ensures Apply and
Clear invalidate the prior read even when filter values are unchanged. The final
runtime holds that read in flight and confirms export remains unavailable until
the fresh response is verified. It records three recovery/refresh GET requests
and no added finance events. An intermediate full suite caught an existing
source-loss focus assertion checking before the passive focus effect completed.
The assertion now waits for the same focus result; its original failure remains
in `ledger-history-commercial-final.log`. The complete rerun passed. No schema,
production-data, push or deployment action was performed.

## Finance adjustment register and lifecycle review

Finance controls now includes a read-only administrator adjustment register for
the confirmed selected financial period and currency. The External GL source
selector does not filter adjustments. Status filtering keeps DRAFT, POSTED and
REVERSED records distinct. A bounded, deterministic 25-row register and its
matching count share one statement snapshot. Adjustment numbers are text so
large generated identities cannot round in the browser.

Selecting an adjustment reads its header, signed lines, saved classification
and immutable lifecycle events in one statement. Session-derived tenant joins
cover header, period, lines, account/cost-centre labels and events. A detail
outside the requested tenant/period/currency/status scope returns 404. The reads
require budgeting entitlement and administrator access, are uncached, and expose
no mutation. Existing create/post/reverse routes and domain rules remain
authoritative. The real reversal walkthrough exposed untyped JSON event
parameters in the existing Neon transport; explicit text bindings now retain
the same related identities and reason without a PostgreSQL 42P18 error.

Line displays retain exclusive, tax and inclusive cents exactly. Saved line
totals use BigInt and are explicitly separate from posting/classification.
An unresolved DRAFT Budget classification is Unavailable; a resolved zero is
shown as money. Posted and reversed evidence must retain complete classification,
nonempty lines and their required lifecycle events. Partial classification,
inconsistent tax arithmetic, mismatched scope or missing/duplicate event stages
cannot become a trusted detail view. No roll-up combines original and reversal
records into a new approval or recalculates Budget Actual.

Lifecycle review retains actor IDs, timestamps, reversal reasons and related
adjustment identities. Timestamp ties order CREATED before POSTED before
REVERSED. Related corrections can belong to another financial period; their
identity remains visible without silently changing the current scope. Closing
detail returns keyboard focus to its originating register button. Status changes,
control locks and successful control refreshes invalidate prior evidence reads;
superseded responses cannot restore an older selection. Failed reads remain
unavailable until a fresh register/detail read succeeds.

Focused checks cover header/line/event completeness, exact values, zero versus
unknown, original/reversal lifecycle, tenant/role/input boundaries, status scope,
read recovery and focus. Disposable acceptance creates a separate synthetic
tenant/calendar/active Budget fixture, then uses the real adjustment APIs to
create a large unresolved draft, post a known zero, and post/reverse an original.
The browser reviews all four saved records, signed totals, classification,
reason/history, status filters, mobile scrolling and GET-only recovery without
new journal events. Fixture setup is isolated test configuration, not a customer
setup walkthrough or release proof. No schema migration is introduced.

Acceptance passed 2,784 Commercial checks across 169 files, standalone TypeScript,
targeted lint, the final production build and the complete disposable runtime.
This bundle adds 44 checks. After visual review, numeric cells adopted the
existing nonwrapping money-column style; focused checks, lint, a new production
build and the full browser/database run passed for that final display refinement.
Final receipts are `adjustment-review-commercial-complete.log`,
`adjustment-review-focused-accepted.log`, `adjustment-review-types-complete.log`,
`adjustment-review-lint-final.log`, `adjustment-review-lint-complete.log`,
`adjustment-review-lint-accepted.log`, `adjustment-review-build-accepted.log` and
`adjustment-review-runtime-final-accepted.log` under `brainbase-finance-review`.
Reviewed captures and structured evidence are in
`adjustment-review-adelaide-final-accepted`. The mobile document fits 390 pixels,
and register/line/event tables scroll to their final evidence columns.

The initial runtime fixture used nonexistent calendar creator columns; its setup
was corrected to the existing schema. The next attempt exposed the reversal
transport's 42P18 event-binding error and led to the explicit text bindings above.
Further browser checks corrected an existing currency-field selector, replaced
the status selector with the standard labelled Field, and scoped old finance
notice assertions so the new adjustment loading status cannot make them ambiguous.
These initial outputs remain in the `adjustment-review-runtime*` logs; the final
complete walkthrough passed. Read-only recovery records only GET requests and
retains the adjustment event count. No production data, schema migration, push
or deployment action was performed.

## Repeatable runtime evidence

Run `npx tsc --noEmit` separately before release verification. This checks the
test sources as well as application code; a passing production build and
Vitest run do not establish that the test TypeScript passes CI. Testing Library
role queries match string names exactly by default and do not accept an `exact`
option. Keep Playwright's supported `exact` options on browser locators.

After a production build, run:

```powershell
$env:FINANCE_RUNTIME_TIMEZONE = 'Australia/Adelaide'
node scripts/tests/verify-finance-controls-runtime.mjs
```

This uses a disposable local Docker PostgreSQL database, real login and Next
production runtime, with the test-only Neon adapter restricted to loopback.
It checks mapping forms, date preservation, exact BIGINT imports, database-gated
concurrent retries/conflicts, close/reopen/sign-off, staleness, mobile tables,
permissions and tenant isolation. It cleans its browser, server and database.
It now also creates a year and period through the calendar setup UI in the
initially empty second organisation and checks persisted dates, concurrency,
closed-year rejection, validation, mobile layout and access boundaries. It
also exercises account/cost-centre creation and deactivation, draft Budget forms,
allocation mismatch rejection, successful activation and locked ACTIVE editing.

See [the verification matrix](c7-9-verification-matrix.md) and
[the finance-close design](c7-9-finance-close-reconciliation-design.md).

## Local development: adjustment evidence downloads (14 October 2026)

**Implemented locally; validation deferred at the user's request.** No tests,
TypeScript check, lint, production build, browser walkthrough, push or deployment
was run for this bundle. The previous released acceptance does not validate these
changes. Leave this bundle out of a release until the checks below are complete.

Finance adjustment review now provides a displayed-register-page CSV and, after
loading a selected adjustment, summary, line and lifecycle CSV downloads plus a
versioned complete JSON evidence record. All files are generated from the loaded
read results without extra requests, mutation, posting, reversal or classification.
Existing administrator/tenant/entitlement read boundaries remain authoritative.
The export builder reuses register/detail parsers and requires the selected
adjustment to belong to the loaded register page. Scope changes, control locks,
reloads and superseded reads remove the export surface through the existing
request keys; the export error state resets when the detail selection changes.

Files retain selected period/currency/status, saved identities and status, source
references, reversal lineage, reasons, actor IDs and original audit timestamps.
Human-readable timestamps use the existing Australian day-first formatter in the
viewer's timezone and are labelled accordingly. Export time means download time,
not database snapshot time. Each detail download describes its own saved header;
it does not substitute an older register status if the detail read is newer.

Signed money uses BigInt exclusively. CSV includes exact cents and two-decimal
currency units, forcing amounts and generated adjustment numbers to text to avoid
spreadsheet precision loss. Unresolved Budget values are blank with an explicit
UNRESOLVED marker; a resolved zero remains a known value. Summary totals sum saved
lines and can exceed one BIGINT line without conversion through floating point.
Formula-like free text, including leading whitespace/control characters, is
protected before the standard BOM/CRLF CSV serializer. JSON preserves original
strings and complete event details. It is an evidence record, not a restore file
or a new sign-off, and never combines an original adjustment with its reversal.

Pending acceptance for the next validation session:

- Export formats: page scope/count, all CSV column mappings, exact large positive
  and negative amounts, zero/unresolved distinction, empty drafts, totals above
  BIGINT, formula prefixes, quoting/newlines and JSON round-trip preservation.
- Rejection paths: partial evidence, wrong period/currency/status, adjustment
  absent from the loaded page, missing evidence and unsupported export kind.
- UI: disabled detail downloads before a complete read, stale/superseded reads,
  control-lock invalidation, scope/reload error reset, failed download messaging,
  object URL cleanup and desktop/mobile button wrapping.
- Changed-file lint, standalone TypeScript, full Commercial containment,
  production build and disposable browser/database acceptance. Confirm exports
  add no HTTP mutations and preserve adjustment event counts.

### Continuation: read provenance and download scope (15 October 2026)

This continuation also remains local and unverified: no tests, lint, type check,
build, browser check, push or deployment was run. It extends the same bundle;
the earlier release receipts do not cover either day's export changes.

Register and selected-detail reads now retain separate browser read-completion
timestamps, set only after a complete parsed response is accepted. Failed reads
clear their timestamps along with their data. Existing request keys still gate
every visible/exportable result; no new HTTP request or database field is added.
CSV metadata and JSON records separate read-completion times from download time.
These are browser observations, not a claim that the database took a snapshot
at that exact instant. The selected detail can be newer than its register row.

A register-page JSON download retains the validated page, scope, matching count
and original header values. Its format is distinct from selected-detail JSON;
it explicitly excludes records on other pages. Numeric-looking text identifiers
and codes are text-protected in CSV as well as generated numbers and amounts,
preserving leading zeroes and long digit strings in spreadsheet use. JSON retains
the original strings without CSV protection prefixes.

Download controls now live in a native disclosure with separate register-page
and selected-adjustment groups, visible page/selection context and loaded times.
Disabled detail actions explain that a saved adjustment must first be reviewed.
A polite status confirms only that a download was requested; it does not claim
the browser saved a file. Scope/selection changes reset that notice and errors.

Additional pending acceptance: separate register/detail/download times, failed
and superseded read timestamps, invalid/missing metadata, invalid register page,
page JSON scope/count and empty-page controls, leading-zero numeric text,
disclosure keyboard access, download notices, and all existing export checks.

### Continuation: readable adjustment evidence report

The selected adjustment's downloads now include a self-contained HTML report
alongside CSV and JSON. This is feature implementation only: it has not been
generated against fixtures, rendered, printed, tested, linted or built. No push,
deployment or live data changes were performed. All earlier pending acceptance
items still apply.

The report is created only after the existing export builder validates complete
loaded register/detail evidence, matching scope, page membership and observed
read times. It contains the saved adjustment header, source/reference identities,
reasons, original audit timestamps plus Australian-formatted dates, exact saved
line totals, individual line classification and lifecycle event details. Original
and reversal records are not netted. A newer detail status is shown separately
from the register-row status at its own read. Unresolved classification remains
unavailable; resolved zero remains money. The report does not add a Budget total
that could mix different saved tax bases.

The file uses local CSS with responsive and A4 print rules, no external assets,
no scripts, no forms and no data requests. All saved text and event-detail JSON
are HTML-escaped. A restrictive document CSP blocks scripts, network resources,
base changes and form submissions. Printing or saving a PDF is an explicit user
action through the browser after opening the downloaded file; downloading does
not open a new window, invoke printing or claim that a file was saved.

Pending report acceptance: HTML escaping with hostile descriptions, names,
narratives and event JSON; no external requests or executable markup; exact huge
signed totals and resolved zero/unresolved values; original and reversal IDs;
different register/detail saved statuses; long IDs/narratives, empty draft lines,
mobile wrapping and multipage A4 print/PDF layout. Run the existing source,
containment and production checks with the rest of this unverified export bundle.

## Local development: scoped adjustment discovery (16 October 2026)

**Implemented locally; not validated.** Testing remains deferred. No tests,
lint, TypeScript check, build, browser/database run, push or deployment was run
for this bundle. It extends the unverified export work above, not the released
acceptance baseline. No database connection or schema migration was performed.

The adjustment register now adds a type selector and an explicitly applied
literal search, while retaining period, currency and status. Search covers saved
number, adjustment UUID, description, reason, source type and source ID across
all matching pages. The existing one-statement matching count and 25-row page
use the same filters. Search uses bound parameters with strpos/lower; percent,
underscore and quotes are literal text, not wildcard or SQL syntax. Search is
trimmed and capped at 200 characters, with control characters rejected. Only the
four existing adjustment types are allowed; no domain mutation rules change.

Detail reads enforce those same filters as well as the selected identity and
tenant. Client parsers verify the echoed applied register filters and matching
headers before exposing rows, details or downloads. Older callers can omit the
new optional type/search fields to retain their unfiltered behavior. Expected
page bounds and canonical filter values are also checked by the client parser.
Authorization, no-store reads, tenant joins, deterministic ordering and the
separate supplier-settlement/Budget Actual boundary remain in place.

Type/status changes immediately alter the read key. Apply and Clear search start
a fresh read even if the applied text is unchanged, return to page one and drop
the prior detail selection. Clear search retains the other selectors. Pending
search edits are labelled separately from the applied search; downloads are
removed until edits are applied or cleared. Applying filters does not create
an adjustment or change any saved finance evidence.

CSV, page/detail JSON and the readable evidence report retain the applied type
and search. Existing page-only export labels remain explicit; matching counts
cover all filtered pages. Search text is escaped by the existing CSV and HTML
export paths. Read and download times remain separate browser observations.

Pending acceptance before committing this bundle as release-ready:

- Server/API: tenant/role/entitlement boundaries, all types/statuses, combination
  filters, literal percent/underscore/quote searches, null source references,
  large adjustment numbers, search limits/control characters, pagination/count
  agreement and out-of-filter detail denial. Revisit query plans only against an
  isolated representative fixture if its scale warrants it.
- Parser: old omitted filter fields, explicit defaults, mismatched echoed scope,
  wrong-type or nonmatching rows/details, invalid filters/page and Unicode
  case-folding agreement between PostgreSQL and JavaScript.
- UI: draft/applied distinction, Apply/Clear refresh when unchanged, page reset,
  type/status changes, ignored stale responses, failed reads, keyboard/mobile
  layout, export suspension while editing and restoration after a complete read.
- Exports: filter metadata in every format, page count, formula/markup handling
  for search text, and continued exact amounts, unknown/zero distinction and
  original/reversal separation.
- Update existing focused fixtures for optional scope fields and new bound query
  parameters as needed, then run standalone TypeScript, changed-file lint, full
  Commercial containment, production build and disposable runtime acceptance
  together with the pending export/report checks.

## Local development: finance control review checklist

**Local implementation only, validation deferred.** No tests, type checks, lint,
build, browser/database acceptance, push or deployment ran for this checklist.
It joins the unverified local adjustment discovery/export/report bundles above.
Existing release receipts must not be reused as acceptance for these changes.

Finance controls now presents a compact next-review summary and an expandable
checklist for its loaded year/period/External GL source/currency selection. The
pure review helper uses the already loaded control data and adds no requests,
mutation, persistence or approval state. It is unavailable while the parent
control scope is loading, working, mismatched or waiting for read-only recovery.
An incomplete selector scope does not infer a comparison or a zero variance.

The checklist selects only an exact year, period, source and currency match.
No match means no saved comparison for that scope; duplicate latest matches are
ambiguous and require refresh. Incomplete snapshot IDs, audit times, variance or
unresolved counts are unavailable. Signed variance remains an exact cent string
and is displayed with the existing BigInt formatter. PREPARED, REVIEWED, STALE
and SIGNED_OFF records receive distinct guidance. Stale zero-variance evidence
cannot become current; signed-off evidence retains its unresolved-item count.

Recorded sign-off is linked only when its close ID matches the loaded current
CLOSED record and the period is CLOSED. The checklist does not claim a complete
year or all-source close outcome from one selected comparison. Draft adjustments,
overlap checks, concurrency and all other server close invariants are explicitly
not assessed here. The loaded adjustment review remains scoped to the selected
currency, while a period close checks all currencies. Existing close, reopen,
review and sign-off handlers and authority remain unchanged.

Native fragment links target the existing scope/refresh, year controls, period
controls, preparation, adjustment evidence and reconciliation table sections.
Targets have focusability and scroll offset. An unresolved-item link goes to
External GL setup for investigation; it neither corrects mappings nor prepares a
fresh snapshot automatically. The checklist is descriptive, not a new action gate.

Pending acceptance: every missing/unavailable scope, old scope responses during
refresh/recovery, exact matching with other-source/currency rows present,
duplicate latest snapshots, incomplete evidence, all lifecycle states, known
zero versus unavailable variance, huge/negative variance, unresolved counts,
closed-year/open-period combinations, missing/mismatched/invalidated close IDs,
sign-off against a current close, unchanged mutation/network behavior, anchor
focus, collapsed checklist access and mobile layout. Complete focused checks,
TypeScript, lint, full Commercial containment, production build and disposable
runtime acceptance with the remaining local bundle before release.

## Local development: reconciliation evidence inspection

**Implemented locally; unverified.** No tests, TypeScript, lint, build, browser or
database validation, push or deployment ran. No database connection or schema
change was performed. This bundle and all preceding local additions still need
their own acceptance; the released finance receipts do not cover them.

Latest reconciliation control rows now offer a distinct Inspect evidence action
alongside the existing review/sign-off controls. Inspection selects an exact
saved reconciliation ID and the row's year, period, source and currency, including
when the control table currently spans multiple currencies or sources. Changing
the parent scope, completing a control refresh or starting a finance action hides
and invalidates prior inspection through the parent scope/revision key. Closing
inspection returns focus to the originating button. No review, preparation,
close or sign-off handler is reused to inspect evidence.

The new administrator-only, tenant-scoped, no-store GET reads a selected header,
complete saved-item count/totals, one 25-item outcome-filtered page and lifecycle
events in one statement. Header selection joins period and year by tenant;
item/event joins preserve tenant identity. Current dimension labels use left
joins so a missing label does not remove a saved comparison item. Saved mapping
IDs, external codes and source/entry counts remain visible. No current source
facts, mappings or totals are recomputed or written.

Deterministic outcome/ID paging covers all outcomes, all unresolved outcomes or
one exact outcome. Header monetary totals always describe the complete saved
snapshot, even when only one outcome/page is shown. Aggregate saved-item totals
and unresolved counts must agree with the stored header. Client parsing also
checks scope/identity, page length, per-item currency/outcome, signed arithmetic,
known lifecycle evidence and unique item/event identities. When all items fit in
the loaded page, their sums and unresolved count are checked directly. Empty or
partial data cannot stand in for a zero-variance approved snapshot.

A same-scope newer snapshot is reported separately from lifecycle status, using
the existing prepared-at/ID ordering. Historical and stale evidence stays labelled
as such. Inspecting changed status does not silently change the older control
table or its actions; the user must refresh those controls. Read failures expose
only a read-only reload, not the previous amounts or downloads. Item filters,
paging and reload ignore superseded responses. The panel adds no mutations.

CSV exports include only the displayed item page, exact signed cents plus two-
decimal currency units, identity/mapping references, outcome/filter/count and
read/download metadata. Numeric and formula-like text is protected by the
existing serializer convention. Page JSON includes the saved header and complete
lifecycle events as well as the displayed items and all-item checks. Empty-page
CSV is disabled; empty snapshot JSON can retain its saved zero header/history.
Download messages confirm a request, not successful file persistence.

Pending acceptance includes tenant/role/entitlement and wrong-scope denials;
clean zero snapshots and all unresolved outcomes; historical/latest ordering;
empty, 25/26-item and out-of-range pages; one-statement count/total consistency;
header/item arithmetic and aggregate corruption; missing labels versus unmapped
IDs; all lifecycle states/actors/details; huge signed values and known zero;
failed/superseded reads; scope/revision invalidation; same-scope explicit reload;
focus return, mobile containment and JSON/CSV content/escaping/URL cleanup.
Confirm inspection/recovery uses GET only and adds no reconciliation events.
Update affected component/static fixtures, then run focused checks, standalone
TypeScript, lint, full Commercial containment, production build and disposable
database/browser acceptance across the whole unverified local bundle.

## Local development: period/year close evidence inspection

**Local implementation only; not validated.** No tests, type checks, lint,
build, browser/database checks, push or deployment ran. No database connection
or schema migration was performed. The previous local evidence/discovery work
also remains unverified and must be accepted with this bundle before release.

Period and year close-history tables now offer separate Inspect actions for each
durable sequence. Inspection does not call close, reopen, review or sign-off
handlers. It selects one close ID in the session tenant and explicit year/period
scope through a new administrator-only no-store GET. Queries choose only fixed
year/period table identifiers; user/session values remain bound parameters.
Calendar joins, later-sequence detection and period reconciliation links retain
tenant/parent identity in the same statement.

Evidence includes close/invalidation actors, timestamps and reasons, captured
control totals, current calendar labels/dates/status, later-close indication,
and current reconciliation links for period closes. Current-record designation
requires a CLOSED close, CLOSED calendar parent and no later sequence. Year-close
inspection does not infer child-period reconciliation links or current readiness.
No current mapping/source facts are recomputed and no source/settlement data is
changed.

Parsers enforce exact record/calendar scope and complete close/invalidation
shapes. Recognised period Source Actual totals retain separate currencies, exact
signed strings, saved source-line counts and inclusive = exclusive + tax. Saved
year counts remain the counts captured at close. Malformed recognised totals are
unavailable. An unrecognised totals format remains visible as raw evidence, never
an inferred zero or a current readiness assessment.

The close's reconciliation-status field is mutable: sign-off and reopening can
update it. The inspector and readable report label it as observed at read time,
separately from captured control totals. A missing current reconciliation link
does not establish that no historical sign-off occurred. Calendar labels/dates
also describe this read, not an invented immutable calendar snapshot.

Close inspection and reconciliation inspection are mutually exclusive. Parent
scope/revision changes and action/recovery locks hide previous evidence. Failed
or superseded reads cannot restore an older record or its downloads. Return to
history restores focus to the selected history button. Explicit reload remains
GET-only, with a new read-completion observation on successful parsed response.

Complete JSON preserves the selected record and original control totals with
scope/read/download metadata. The self-contained readable HTML report escapes
saved text/JSON, uses no scripts or external assets, applies a restrictive CSP
and provides responsive/A4 print styling. Browser Print/Save PDF is a user action
after opening the downloaded file. Neither file is a restore file or new approval.

Pending acceptance: tenant/role/entitlement and kind/year/period/ID mismatch
denials; all close/invalidation shapes and repeated sequences; historical versus
current calendar state; recognised/unknown/corrupt totals, empty currencies,
huge signed money and saved year counts; missing labels or links and mutable
reconciliation status; in-flight scope changes and action locks; reload failure,
GET-only recovery without new close/reconciliation evidence; history focus return,
mobile containment, escaped JSON/HTML and multipage report printing. Run focused
checks, standalone TypeScript, changed-file lint, full Commercial containment,
production build and disposable database/browser acceptance for the entire local
bundle before committing it as release-ready or deploying it.

## Local development: linked finance evidence trail

**Local implementation; not verified.** No tests, TypeScript, lint, build,
browser/database checks, push or deployment ran. This continuation does not
change the pending acceptance state of any earlier local bundle.

Evidence inspection now has one explorer for a selected close or reconciliation
record. A period-close inspector can follow an actually returned reconciliation
link. Reconciliation inspection can follow its saved close ID or a valid close ID
retained in an immutable lifecycle event. Event links are treated as references,
not a claim that the close is current; the existing tenant/calendar-scoped reader
must still return the record. Missing, malformed or inaccessible references do
not infer a replacement record or mutate anything.

Client navigation targets validate record/year/period UUIDs, close kind and
canonical reconciliation source/currency. Related targets must remain in the
originating year and period. A year-close inspector does not invent child-period
links. Existing server entitlement/administrator/tenant/scope checks remain the
authority; navigation validation does not grant access.

The visible native-button trail supports earlier records, back to the preceding
inspection, or dismissal to the originating table/history. Repeated records
collapse to their earlier position instead of growing a loop, and the trail is
bounded to 16 distinct targets. Visiting a prior record remounts its reader and
performs a fresh GET; no previous evidence result, filter/page state or download
receipt is reused as a new read. Selecting the same table/history record again
also starts a new inspection through an explicit root visit counter.

Following evidence links leaves control selectors untouched. The current panel
states its own source/currency and calendar identity; its exports continue to
cover only that inspected record/page, not the entire trail. Parent control
scope/revision changes, loading, mutations and uncertain-save recovery unmount
the whole explorer. Old requests use existing cleanup guards and cannot revive
a previously selected record. Returning to the originating history restores
focus to its original inspection button; linked/back reads focus their heading.

Pending acceptance: valid/invalid reference targets; cross-tenant and wrong-
calendar denial; lifecycle-event links after reopen; missing/deleted references;
trail loop collapse and depth limit; breadcrumbs/back fresh reads; root reselection;
scope/revision/action-lock invalidation; ignored out-of-order responses; focus
and keyboard/mobile behavior; stable control selectors; export scope; GET-only
navigation/recovery and unchanged close/reconciliation event counts. Run focused
checks, TypeScript, lint, full Commercial containment, production build and the
disposable database/browser walkthrough across the entire unverified local bundle.

## Local development: saved reconciliation history

**Implemented locally; validation is still deferred.** No tests, TypeScript,
lint, build, browser/database checks, push or deployment ran. No database
connection or schema migration was performed. Earlier local bundles remain
unverified; no previous release receipt covers this continuation.

Finance controls now includes an initially collapsed history section for one
explicit year, period, External GL source and currency. It reads only when opened
with complete, confirmed parent controls. Opening/reopening and explicit reload
request a fresh read. Parent unavailability discards the previously accepted page;
scope/status changes reset paging and remove old rows/downloads while the next
response is checked. Download notices/errors are keyed to their confirmed read
so another scope or page cannot inherit them.

The administrator-only no-store GET uses the session tenant and matching
year/period joins. One statement computes all matching header count and one
deterministic 25-row page. Latest-version designation uses prepared-at/ID order
before lifecycle filtering, so selecting STALE or another status cannot make
an older version latest. Historical, stale and current-ordering facts remain
separate. No sums across snapshot versions, accounting approvals or current
readiness are inferred.

Header completeness/arithmetic/lifecycle-shape validation is shared with the
existing local reconciliation evidence parser. History additionally checks the
echoed scope/status/page, exact expected page length, unique IDs, matching rows
and at most one latest designation for the exact scope. Saved amounts remain
signed strings and display with the existing exact currency formatter.

Every historical row can open the existing evidence explorer at that exact
saved identity and scope, retaining its historical/latest explanation and linked
close inspection. Existing mutation controls remain attached to the latest-state
table only. History navigation does not review, prepare, sign off or change the
parent selectors. Returning to a history row restores its inspection button;
if pagination has removed that button, focus falls back to the history section.

Page CSV contains saved headers, identities, actors/timestamps, close reference,
unresolved count, exact cents/two-decimal amounts, notes and scope/read/download
metadata. Numeric/formula-like text is protected by the established serializer
convention. JSON preserves the displayed header page and count/filter context.
These downloads do not include comparison items or lifecycle events, which need
separate inspection, and do not combine snapshot versions.

Pending acceptance: tenant/role/entitlement and wrong-calendar/source/currency
denial; old and current snapshots with equal timestamps; latest designation before
status filtering; all lifecycle states; empty, 25/26-record and out-of-range pages;
one-statement count/page agreement; shared header-parser regression checks;
malformed or wrong-scope payloads; exact huge signed values, zero and notes;
collapsed/reopened reads, parent action/recovery locks, failed/superseded requests;
page/selector invalidation of downloads and notices; historical evidence links,
root reselection, return-focus fallback; mobile/keyboard layout; CSV/JSON escaping
and GET-only behavior without additional finance events. Complete focused checks,
standalone TypeScript, lint, full Commercial containment, production build and
disposable database/browser acceptance across the entire local bundle before
committing it as release-ready or deploying.

## Local development: saved snapshot total comparison

**Local implementation, unverified.** No tests, TypeScript, lint, build,
browser/database checks, push or deployment ran. No new database query, schema
change or connection was introduced; comparison uses the existing local evidence
GET reader. All prior local bundles retain their pending acceptance status.

History rows now allow choosing one baseline and a different comparison snapshot
within the same year, period, source and currency. The baseline can remain chosen
across history pages and lifecycle filters, but a parent scope/revision change
invalidates the selection. Repeating a comparison starts a fresh reader through
an explicit visit key. Clearing/changing baseline removes the previous pair.

The comparison reads both complete evidence responses independently in parallel,
validates each using the existing scope/identity/page/arithmetic/aggregate and
lifecycle parser, then retains the saved headers and separate read observations.
Both reads must succeed before comparison or downloads are available; failures
do not substitute old or partially returned values. Superseded requests cannot
restore another pair. Parent action/recovery locks and unavailable history hide
and unmount the pair reader.

Every amount change is comparison minus baseline using BigInt for Source Actual,
finance adjustments, Effective Actual, External GL and variance. Direction is
explicit regardless of preparation ordering. Unresolved-count change is also
exact. This is a comparison of saved header totals only, not an item-level diff,
transaction, recomputed accounting fact, approval or sign-off. Zero amount changes
do not establish identical items, unchanged lifecycle or zero unresolved count.
Historical/stale/latest designation remains attached to each observed header.

The panel shows calendar/source/currency, both saved identities/statuses, snapshot
and preparation times, separate browser read times and close references. It states
that the two reads are not one simultaneous database snapshot. Either header can
open the existing evidence explorer. Closing comparison restores its originating
comparison button or falls back to the history section after paging.

CSV carries the fixed direction, both identities/statuses and timestamps, each
measure's exact cents/two-decimal baseline/comparison/change amounts, and unresolved
counts/change. JSON retains both observed saved headers and regenerated differences.
Exports revalidate/recompute from headers instead of trusting an edited differences
object, preserve scope/read/download metadata, protect spreadsheet text and use
bounded safe filenames. They do not claim to include comparison items or events.

Pending acceptance: different/same IDs and mismatched scopes; baseline selection
across pages/status filters; scope/revision invalidation; repeated comparison
fresh reads; one/two failed or out-of-order responses; parent locks/unmounts;
huge positive/negative/zero differences, counts and unchanged totals with changed
status/items; reversed baseline direction; historical/stale labels and separate
read times; evidence inspection and focus fallback; keyboard/mobile table access;
CSV/JSON direction/content/escaping/URL cleanup and GET-only requests without new
finance events. Complete focused checks, TypeScript, lint, Commercial containment,
production build and disposable database/browser acceptance across the full
unverified local bundle before release.

### Local snapshot comparison report and saved-header differences (17 October 2026)

The comparison now includes seven header fields observed at read: lifecycle
status, close reference, preparation identity, review identity/time, saved notes
and latest-snapshot designation. Strict value comparisons preserve absent notes,
empty saved text and recorded values. The optional differences-only display does
not change downloaded evidence. Cross-record differences do not infer lifecycle
events or prove when a field changed.

Swapping baseline and comparison updates the selected history baseline and
remounts the comparison reader, so both evidence responses must load again before
new results or downloads appear. Direction remains comparison minus baseline;
fresh reads can also observe a concurrent lifecycle change. Closing returns focus
to an available comparison trigger or the history section when that trigger is
removed or disabled by the new baseline selection.

Downloads now include a dedicated saved-header CSV with explicit value states,
enriched comparison JSON and a self-contained printable HTML report. The report
includes all compared header fields, amounts, unresolved counts, identities and
separate read/download times. Dynamic values are HTML escaped, assets/scripts are
not required, and print styles target A4 landscape. CSV retains spreadsheet text
protection. Builders regenerate comparisons from the observed validated headers.
No new endpoint, finance mutation or database operation was introduced.

Implementation and source inspection only: no tests, type checks, lint,
containment checks, builds, browser/database validation, push or deployment ran
for this continuation, preserving the requested testing deferral.

Pending acceptance additionally includes same/different/null/empty/multiline
notes; review metadata, close and latest changes with unchanged totals; display
filter versus complete exports; formula-like CSV text and HTML escaping;
swapping repeatedly with failed, superseded or concurrently changed responses;
baseline persistence across history pages; focus return after swapping; report
mobile layout and A4 print pagination. Run the full previously listed acceptance
and Commercial release checks before considering this local bundle verified.

### Local single-snapshot reconciliation report bundle (17 October 2026)

The saved reconciliation inspector now groups five downloads by their coverage:
the existing selected-item-page CSV and evidence JSON, a totals summary CSV,
a saved lifecycle-event CSV and a printable HTML report. All use the currently
accepted evidence response and its read-completion observation. They do not
request extra pages, reload evidence or call mutation routes.

The summary CSV includes five measure rows with exact header and complete-item
aggregate cents and two-decimal amounts, total/unresolved counts, selected page
and outcome-filter coverage, preparation/review identities, close reference and
saved notes. A separate notes value-state column retains missing versus empty
text. Lifecycle CSV includes event identities, types, original timestamps, actors
and saved JSON details independently of the item filter/page. Both retain scope,
snapshot identity/status/latest designation and read/download-request times.
Numeric-looking and formula-like strings retain existing spreadsheet protection;
filenames use bounded safe reconciliation identities.

The self-contained HTML report includes saved metadata, all-item totals and
counts, the selected item page and all returned lifecycle events. Item cards
retain mapping and dimension identities, external codes, current-at-read internal
labels, source/external counts and each saved amount. Coverage is explicit at the
start and again before items; missing labels are not presented as missing saved
identities. Historical/stale records retain their warnings. HTML values are escaped
and a restrictive content policy requires no scripts or external assets. Responsive
styles and A4 portrait print rules are included, with no claim of rendered proof.

Source inspection only: no tests, TypeScript, lint, containment, production build,
browser/print or database checks ran, and nothing was pushed or deployed. The
existing unverified local bundles remain unverified.

Pending acceptance: selected-filter and multi-page coverage versus complete
totals/events; zero-item pages with retained summary/history; historical/stale
records and independently observed timestamps; missing/empty/multiline notes and
labels; huge signed cents, exact zero and CSV formula/text protection; event JSON
and HTML escaping; keyboard/mobile download controls, failed/superseded reads and
object-URL cleanup; long item/event pagination in A4 print. Run the full deferred
Commercial checks and disposable database/browser acceptance before release.

### Local close-record spreadsheet evidence bundle (17 October 2026)

The close inspector now offers three CSV downloads alongside the existing HTML
report and JSON. All are built from the accepted scoped read after the existing
close parser validates identities, calendar scope, lifecycle structure and known
control-total arithmetic. No extra reads, close/reopen actions or sign-off calls
are made by downloads. Filenames use bounded safe close identities.

Record-details CSV uses field/value rows with explicit missing/empty/recorded
states. Provenance distinguishes saved record fields, control totals captured at
close and calendar/link-status observations at read. Invalidation fields describe
the saved record and are not labelled as captured when it was originally closed.
Each row retains close ID/kind, calendar identities, sequence, close status at
read and browser read/download-request timestamps.

Captured-totals CSV keeps each Source Actual currency separate, with source line
counts and exact cents/two-decimal exclusive, tax and inclusive amounts. Year
totals retain the two saved period counts without claiming current readiness.
Explicit states distinguish captured source rows, no captured currency rows,
captured year counts and unrecognised bases. Unknown/not-applicable amount fields
remain blank; the complete raw control totals remain included for every state.
No cross-currency sum, supplier-settlement total or new finance-adjusted fact is
inferred. Numeric-looking and formula-like text retains spreadsheet protection.

Reconciliation-links CSV retains observed identities, source, currency and status.
A period with no current links has a coverage row that explicitly does not rule
out historical sign-off. Year-close inspection uses NOT_ASSESSED for child-period
links rather than reporting an empty set as proof that none exist. All these
observations remain read-time evidence, not immutable reconciliation capture.

Source review only: tests, type checks, lint, containment, builds, browser/database
acceptance, push and deployment remain deferred under the current instruction.
Pending acceptance includes all three CSV layouts and value states; period/year,
current/historical/invalidated records; empty/unknown/zero/large signed totals;
mixed currencies; missing/empty/multiline reasons; leading-zero identifiers and
formula-like text; link coverage states and current-vs-captured provenance;
failed/superseded reads, download failure/URL cleanup and keyboard/mobile use.
Run full deferred checks across the accumulated local work before release.

### Local readable reconciliation history bundle (17 October 2026)

Saved reconciliation history defaults to snapshot cards with an explicit detailed
table toggle. Cards show the calendar names, status/latest designation, snapshot
and preparation times, identity, unresolved count and all five exact saved-header
amounts. Saved review/close metadata and notes remain expandable. Stale snapshots
retain a warning. Missing and empty notes have distinct labels in both views.

Inspection, baseline selection and comparison buttons share action renderers
between cards and table. Changing view uses the already accepted history page:
it does not alter scope, filter, pagination, comparison direction, chosen baseline
or the request key and does not issue another history request. Only the selected
view renders, avoiding duplicate action controls. If a comparison’s original
trigger was removed by switching views, the existing close handler falls back
to the history section rather than focusing a disconnected element.

The history download group now includes a self-contained printable HTML report,
alongside existing CSV and JSON. Its entry point revalidates the complete accepted
history page and read/download-request timestamps. The report retains scope,
lifecycle filter, selected page, displayed/matching counts, separate saved headers,
status/latest designation, original timestamps, preparation/review identities,
close references, unresolved counts and each header’s five saved amounts. Calendar
names describe the read. It does not include other pages, comparison items or
lifecycle events, sum versions or infer lifecycle transitions. A page without a
latest row is not presented as proof that none exists in the full scope.

Dynamic report values are escaped; the HTML requires no scripts or external
assets and includes responsive/A4 portrait styles. These styles are implemented
but not visually verified. No tests, type checks, lint, containment, builds,
browser/print/database acceptance, push or deployment ran for this bundle.

Pending acceptance: card/table parity; view switching with active comparison and
evidence inspection; keyboard/focus return after removed triggers; long labels,
IDs and notes at narrow widths; scope/revision/paging changes and parent locks;
empty/filtered pages and latest outside the page; exact signed amounts and stale
statuses; report coverage, escaping and long-content print pagination; request
counts and object-URL cleanup. The accumulated local work still requires the
full deferred Commercial checks before release.

### Local reconciliation item readability bundle (17 October 2026)

The saved reconciliation inspector now defaults to item cards with an optional
detailed table. Cards group saved outcome, current-at-read account/cost-centre
labels, all five exact saved amounts, source/external counts and expandable saved
identities. View selection is presentational only: it is not part of the request
key, does not change filter/page or issue another read, and does not affect export
coverage. One view renders at a time. The existing detailed table remains usable
for side-by-side examination.

A shared exhaustive outcome guide supplies readable labels, meanings and review
prompts for the seven saved outcome codes. The outcome selector, item cards,
guide and HTML report use the same definitions. Raw saved codes remain available
with the evidence and in existing CSV/JSON. Explanations describe the recorded
classification; they do not derive new outcomes, infer present mapping state,
decide an adjustment or establish review/sign-off. Mapping and comparison-level
wording was reviewed against existing account/cost-centre reconciliation branches.

Null dimension/mapping identities now say they were not recorded for the saved
row rather than automatically implying an unmapped dimension. Existing comparison
logic can legitimately retain null cost-centre identities in account-level rows
or null individual mapping identities when several mappings are aggregated.
Known identities with missing current labels remain distinct from absent saved
identities; empty label/text values also remain distinct. These interpretations
are shared by cards, table and printable evidence report without changing the
saved data or outcomes.

Lifecycle history now displays an ordered list of readable event labels, times
and actors, with original codes/IDs/timestamps and complete saved details behind
each disclosure. Existing event close links remain inspectable. The inspector
and report state that past sign-off events do not establish current approval;
events remain independent of the selected item page/filter.

Source review only: no tests, type checks, lint, containment, build, browser/print
or database acceptance ran, and nothing was pushed or deployed. Pending acceptance
includes all seven outcomes and saved-code retention; card/table/report parity;
account-level and aggregated null mappings versus genuine unmapped outcomes;
missing/empty/current labels; exact huge signed/zero amounts; view changes during
filter/page reads and parent locks; keyboard/mobile disclosures; lifecycle order,
close-link navigation and escaped event details; report coverage and print layout.
The accumulated local changes remain unverified until full deferred checks run.

### Local evidence navigation continuity bundle (17 October 2026)

Evidence exploration now retains a bounded in-memory reference list and a current
position, with Back, Forward, compact breadcrumbs and a full-reference disclosure.
Returning to an earlier reference no longer discards forward references. Following
a genuinely new reference from an earlier position replaces the forward branch;
following an already retained reference moves to its existing position without
duplicating it. The previous loop-collapse description is superseded by this
position-based behaviour. No browser history or persistent storage is changed.

Navigation helpers validate target shapes, a safe in-range position, unique
reference keys, at most 16 retained references and a single year/period calendar
context. New branches use the existing same-calendar reference guard. Existing
year-close inspection still does not manufacture child-period links. Sources and
currencies can differ across actual linked reconciliations in one period; the
current inspected source/currency is disclosed separately from the selectors.

Each successful navigation increments a reader visit key, including revisiting
the current reference through a saved link. The selected reader remounts and
must complete the existing authorised scoped GET/parser flow again. Only target
references are retained, never prior evidence responses or approval assertions.
Failed records remain navigable references, not claimed successful reads.
Downloads retain their existing current-record-only coverage. Scope/revision
changes and parent action/recovery locks still unmount the whole explorer.

The navigation panel labels the current position and record kind, shortens visible
breadcrumbs, retains complete IDs in accessible revisit labels and an expandable
list, and explains branch replacement and trail clearing on close. Inner readers
return to the previous position or the originating history. Existing child focus
on reader mount provides the reading position for each visit; keyboard and screen
reader behaviour remains pending browser acceptance.

Source review only: no tests, TypeScript, lint, containment, builds, browser or
database acceptance, push or deployment ran. Pending acceptance includes
root/previous/forward boundaries; repeated same-reference links; cycles and
revisits without duplicates; new branch after Back including at the 16-reference
limit; invalid/cross-calendar references and positions; failed and superseded
reads; switching linked sources/currencies without changing selectors; parent
unmounts, keyboard/focus and narrow layouts; record-only export coverage and
absence of mutation requests. Run the accumulated deferred checks before release.

### Local evidence download and read-lifecycle bundle (17 October 2026)

Adjustment, close, reconciliation-item, reconciliation-history and snapshot-pair
download panels now share one browser-save helper. Builders still validate and
generate their existing scoped evidence files first; the helper only constructs
a Blob, temporarily attaches an anchor and requests its download. It adds no
network request, storage, posting, review or sign-off operation. The filename,
format, content, precision and evidence coverage remain builder-owned.

Successful requests retain the object URL for 60 seconds before revocation rather
than revoking it in the click handler immediately. The independent timer remains
active if the reader unmounts; the temporary anchor is removed synchronously.
If scheduling, setup or clicking throws, the helper clears its timer, revokes the
URL immediately and propagates failure to the panel’s existing error handler.
Blob/URL construction failures also remain failures, not success notices. Browser
save notices consistently say the download was requested and direct the user to
browser downloads; no handler certifies file save or approval. Actual browser
download timing and cleanup remain pending verification.

Close evidence, reconciliation evidence, reconciliation history and paired snapshot
read effects now own AbortControllers. Cleanup first marks the effect inactive,
then aborts its browser request when selection/filter/page/reload changes or the
reader unmounts. Existing scope/read-key parsing and inactive-response guards are
retained; cancellation is not a substitute for those controls. Paired snapshot
reads share one signal and abort outstanding sibling work if either fails. Both
reads must still pass before comparison/export becomes available. An aborted
browser fetch does not prove cancellation of an already-running server query.

React source review covered unchanged hook ordering, effect ownership/cleanup,
scope-key invalidation, paired parallel reads, existing notice/error roles and
absence of retained anchors or new external requests. No tests, type checks,
lint, containment, builds, browser/database checks, push or deployment ran.
Pending acceptance includes all export formats across five panels; immediate
unmount/navigation after download; delayed URL revocation and setup/click failures;
repeated downloads, large files and browser-blocked saves; abort during response
and JSON reads; scope/page/filter changes, parent locks and Strict Mode remounts;
one failed paired read and late/superseded responses; no false success/error
notices or mutation requests. Run full deferred checks before release.

### Local prioritised finance inspection bundle (17 October 2026)

The finance review checklist now exposes a suggested next inspection above its
full expandable steps. It derives that suggestion from the existing loaded scope
assessment, not a fresh request or independent accounting calculation. Unavailable,
incomplete, missing or ambiguous evidence retains its existing refresh/scope/
preparation-control guidance. Stale evidence points to preparation review while
retaining access to the historical snapshot. Prepared, reviewed and signed-off
evidence points to the relevant saved comparison, calendar or close-link review.

Unresolved items or non-zero recorded variance prioritise inspecting saved
comparison items. The wording explicitly separates net variance from unresolved
item count: zero net variance does not establish that all items are resolved.
A signed-off record that retains either issue now has a warning summary rather
than an apparently clear close-linked summary. Status/linkage values are preserved;
the checklist does not rewrite evidence or infer that server sign-off checks ran.

When one validated saved snapshot is available, the checklist offers a direct
inspection button. It delegates to the existing locked/scope-aware parent handler,
opens the authorised evidence reader for the exact snapshot scope and retains the
trigger for focus return. It does not prepare, review, sign off, close, reopen or
change control selectors. With unavailable/invalid/ambiguous evidence no snapshot
inspection button is presented. Other sources/currencies and server close checks
remain outside this selected-scope suggestion.

React source review covered conditional button visibility, exact scope forwarding,
existing action/recovery locks and evidence reader/focus reuse. No tests, type
checks, lint, containment, builds, browser/database checks, push or deployment ran.
Pending acceptance includes every missing/ambiguous/stale/prepared/reviewed/
signed-off branch; unresolved items with zero variance and non-zero variance with
zero unresolved count; matching/missing/invalid close links; scope changes and
parent locks during inspection; navigation/focus return and mobile layout. The
accumulated changes remain local and unverified until deferred acceptance runs.

### Local adjustment register and retry bundle (18 October 2026)

The adjustment register defaults to readable cards with an optional detailed
table. Cards retain number, status, type, description, reason, creation time
and expandable saved identities/source/reversal/reference-period information.
One view renders at a time, sharing the same review-button handler. Switching
view does not change applied filters, page, selection or the register request
key and does not request another register read. Original and reversal records
remain separate; no card totals or cross-record accounting fact is inferred.

Selected adjustment evidence now has its own visit/reload counter. Reviewing the
same adjustment again or requesting a detail reload starts a fresh scoped read
without reloading the register. Old details/downloads are unavailable while that
read is pending; detail exports use the new accepted response and timestamp.
The register’s independent timestamp/status is retained, including the existing
warning when its saved status differs from the detail read. Failure offers retry
of the selected evidence and advises register refresh if status/scope changed.

Reload and Close controls remain available for the selected evidence during
loading or error (Reload is disabled while pending). Closing clears selection,
aborts the browser read via effect cleanup and returns focus to a connected,
enabled trigger or the register section if view changes removed that trigger.
Successful evidence reads focus the detail heading. Register and detail read
effects now own separate AbortControllers while preserving scope/read-key
validation and inactive-response guards. Browser abort does not prove database
query cancellation. Parent locks/revision/scope changes retain existing gating.

Source review only: no tests, TypeScript, lint, containment, builds, browser or
database checks, push or deployment ran. Pending acceptance includes card/table
parity and narrow layouts; repeated same-ID inspection; failed detail retry and
changed status/search/type scope; independent register/detail timestamps; close
while pending and late responses; parent locks and scope/revision invalidation;
focus after view changes; unchanged exports and no new mutation calls. Run the
full deferred Commercial checks across accumulated local work before release.

### Local selected-adjustment line and lifecycle bundle (19 October 2026)

Selected adjustment evidence now renders its saved lines through a dedicated
card/table component. Cards retain position, account and cost-centre codes/names,
exclusive/tax/inclusive amounts, saved Budget amount and basis, narrative and
expandable line/account/centre/Budget/version/line/source-bill-line identities.
The detailed table retains those same amounts and references. View changes use
the validated evidence already loaded and issue no requests or mutations.

Saved classification coverage is shown separately as total/resolved/unresolved
line counts. It does not infer current Budget readiness or recompute mappings.
Resolved zero amounts remain money; null Budget amounts remain unavailable with
an unresolved-classification label. Empty saved narrative text is distinct from
an absent value. Account and cost-centre labels describe the current read while
classification identities retain the saved Budget/version/line. Empty draft
evidence does not establish completed classification.

Adjustment lifecycle history now uses an ordered event list with readable labels,
actors and Australian timestamps. Original event codes/IDs/timestamps, reason,
all present related reversal identities and complete saved details remain
available. No precedence rule hides additional related references when more than
one is present. Related records are not fetched, combined or assumed to belong
to the same period. Past events do not certify current approval or readiness.

Shared display helpers keep lifecycle labels, classification counts and empty
narrative handling consistent with the existing printable adjustment report.
Report values remain HTML escaped; original event types and details are retained.
The accepted selected evidence remains the only input, with existing read keys,
export validation, parent locks and exact monetary arithmetic preserved.

React source review covered component boundaries, stable line/event identities,
view state, null-vs-zero rendering, detail remount keys and disclosure semantics.
No tests, type checks, lint, containment, builds, browser/print/database acceptance,
push or deployment ran. Pending acceptance includes empty drafts and resolved
posted/reversed records; mixed draft resolution; resolved zero versus null Budget
amounts; exact huge signed values; all reversal-reference combinations and event
JSON escaping; card/table/report parity; long narratives/identities, keyboard and
mobile layouts; reload/selection changes and unchanged request/export coverage.
Run all accumulated deferred Commercial checks before release.

### Local readable close-history bundle (19 October 2026)

Year and period control panels now share a close-history presentation component
with default cards, a detailed table and a loaded-record status filter. Cards
retain sequence, status, close time/reason, invalidation details, identity and
original timestamps. Period records retain the existing supplied current-close
identity and reconciliation status observed at read. Year records retain captured
control totals. Inspection uses the existing scoped handler from either view;
working/recovery locks still disable those buttons. Mutation forms and their
server-governed close/reopen rules are unchanged.

Filtering is local to the accepted history array, with displayed/loaded counts
and explicit empty-filter messages. It does not imply a server-wide search or
read another calendar scope. A supplied current period close outside the filtered
list is explicitly identified as outside the list. View/filter state resets when
the selected calendar identity changes. Only one view renders, retaining close
identity data attributes without duplicate card/table records.

Year count summaries now require the recognised C7_9_YEAR_CLOSE basis and safe,
nonnegative integer period/close counts, with close count no greater than period
count. Unknown formats or incomplete counts prompt inspection instead of becoming
zero or readiness evidence. Valid zero counts remain zero. Raw captured totals
remain available in year-card details and the existing complete evidence reader.
Reasons distinguish missing and empty text. No historical sequences are summed.

Close-evidence dismissal now restores focus only to a connected/enabled originating
button, otherwise to its year/period control section. This covers view/filter
changes that remove the original trigger while the evidence explorer remains
open. Existing authorised reader, trail and record-only exports remain in use.

React source review covered shared structural record types, stable keys, scoped
state reset, no new request effects, disclosure/empty states and focus fallback.
No tests, type checks, lint, containment, builds, browser/database acceptance,
push or deployment ran. Pending acceptance includes year/period card/table parity;
closed/invalidated/all filters and hidden current records; unknown/incomplete/zero
year counts; long reasons/timestamps/raw JSON; inspection and focus after filtering
or changing view; parent action locks and calendar changes; keyboard/mobile layout
and existing table-based acceptance assumptions. Run all deferred checks before
release of the accumulated local work.

### Local readable latest-reconciliation controls (20 October 2026)

Latest reconciliation controls now use a dedicated card/table component with a
local lifecycle-status filter. Cards group source/currency/status, calendar names,
prepared time, five exact amounts, unresolved count, original timestamps, notes
and close reference. The detailed table retains all existing measures and actions.
One view renders at a time, retaining reconciliation identity data attributes.
Displayed/loaded counts and empty-filter messages describe the accepted list only.
Scope-key remounting resets view/filter state when the parent control scope changes.

Default status selection includes all loaded latest records, including zero
variance/zero-unresolved records. The UI does not sum versions/currencies or infer
approval from either value. Signed-off cards state whether the retained close
reference matches the loaded active-close ID, while distinguishing that observation
from current readiness. Saved notes retain missing versus empty distinctions.

Both presentations share one action renderer using the unchanged
financeReconciliationAction status/active-close decision helper. Existing Review,
Sign off and evidence-inspection callbacks, active-close presence and working/
recovery locks are retained. Sign off remains disabled without the loaded active
close; stale/signed-off records remain read only. New explanatory text describes
blocked/read-only states and the separate server checks without asserting that an
available button proves eligibility. No mutation or action was executed by this
implementation work.

Reconciliation inspection records whether its trigger originated in latest
controls or history. If view/filter changes remove that trigger, dismissal now
focuses the corresponding section rather than always falling back to history.
The existing scoped GET evidence reader and export boundaries remain unchanged.

React source review covered generic record/callback typing, preserved decision
helper and callback arguments, locks, view/filter state, focus fallback and removal
of superseded table-only imports. No tests, type checks, lint, containment, builds,
browser/database acceptance, push or deployment ran. Pending acceptance includes
card/table parity; every lifecycle/active-close/working combination; clean records
and unresolved-zero-net-variance records; status filters and scope changes; exact
signed amounts; sign-off linkage text and independent server rejection; inspection
and focus return after removed triggers; keyboard/mobile layout and existing table
acceptance assumptions. Run all accumulated deferred checks before release.
