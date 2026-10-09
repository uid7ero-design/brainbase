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

## Repeatable runtime evidence

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
