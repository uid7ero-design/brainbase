# Commercial finance pilot

Prepared 7 October 2026, after finance runtime fixes in PR #375. This is a
walkthrough and implementation plan; it does not enable a customer capability
or create finance records.

## Current readiness

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
current app has no setup UI for creating years, periods, Budget accounts,
cost centres, budgets or draft Budget lines. Domain functions exist in
`lib/commercial/financialPeriods.ts`, `budgetAccounts.ts`, `costCentres.ts`
and `budgets.ts`, but are not exposed as a complete setup workflow. The
financial-periods route currently provides GET only. Budget activation has
an API, but does not supply the missing draft creation workflow.

External GL mapping has a UI; entry import currently has an administrator
JSON API, not a file-import screen or automatic accounting-system connector.

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

## Next implementation: administrator setup

Build the missing setup workflow locally before the customer pilot. Keep the
existing session -> budgeting capability -> administrator role checks and
derive the organisation exclusively from the authenticated session.

Suggested delivery slices:

1. Financial calendar creation and readback: year and explicit child-period
   forms, date-only responses and server validation of boundaries. Define
   overlap/containment behavior against the existing schema and domain before
   exposing mutations; do not silently rewrite existing periods.
2. Account and cost-centre configuration: reuse existing domain functions and
   tenant uniqueness rules. Expose active/inactive state without deleting
   historical references.
3. Draft Budget configuration: header, lines, period allocations and explicit
   commitment mapping; reuse the existing version activation rules. Never
   make an incomplete draft ACTIVE as a setup shortcut.
4. Connect setup to the existing mapping, reporting and finance-control screens
   with clear empty-state links. Keep administrator mutations inaccessible to
   viewers and other organisations.

Acceptance requires a fresh, entitled demo organisation to complete setup
through the app without manual SQL, then complete the walkthrough above.
Verify malformed dates, tenant references, amount precision, duplicate/retry
behavior, activation failures, desktop/mobile layout, Commercial containment,
disposable database integration and production build. Push and deployment are
separate release steps after review.

Capability enablement is a separate customer decision, not a side effect of
setup or testing. Keep zero-cent reconciliation tolerance and the current
year-close policy; requiring an external sign-off for every year close remains
a deferred policy decision in the finance-close design.

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
It proves the operational controls, not the planned setup UI.

See [the verification matrix](c7-9-verification-matrix.md) and
[the finance-close design](c7-9-finance-close-reconciliation-design.md).
