# Commercial finance pilot

Prepared 7 October 2026, after finance runtime fixes in PR #375. This is a
walkthrough and implementation plan; it does not enable a customer capability
or create finance records.

## Current readiness

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
