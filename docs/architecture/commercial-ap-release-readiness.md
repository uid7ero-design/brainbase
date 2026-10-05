# Supplier AP release readiness and rollout

Local implementation is complete: AP-1 schema, AP-2 governed settlement and
concurrency, AP-3 HTTP, AP-4 bill payment UI and AP-5 finance isolation. Subsequent
slices add multi-bill remittance, safe retries, filtered/paged aging, PDF/CSV
downloads and historical recorded balances. Bank feeds, reconciliation, approval
and scheduled payment workflows, FX and unapplied cash are optional expansions.

This document is the current release index. Older design documents and their
test counts describe the slice at the time it was implemented. The branch is now
pushed for review in draft PR #342. Git integration triggered an automatic
Vercel preview; no hosted migration or production deployment has been performed
by this work. Production rollout requires a separate explicit user request.

## Local gates

From the worktree, with Docker PostgreSQL 16, Chromium and installed dependencies:

```powershell
./scripts/tests/verify-supplier-ap-readiness.ps1
npx vitest run --project containment commercial --maxWorkers=4
npx playwright test tests/browser/commercialSupplierPayments.spec.ts tests/browser/commercialSupplierApOverview.spec.ts tests/browser/commercialSupplierRemittance.spec.ts
# Use explicit disposable/placeholder configuration; never inherit a hosted URL.
$env:DATABASE_URL='postgresql://review:review@127.0.0.1:1/review'
$env:SESSION_SECRET='local-build-placeholder-not-production'
npx next build --webpack
node scripts/tests/verify-supplier-ap-runtime.mjs
```

The runtime harness launches the built application with `next start` on a free
loopback port. It creates fresh local PostgreSQL data, uses actual production
supplier-bill/payment migrations and rehearses the additive payment upgrade
twice. Ancillary organisation/user/capability/PO tables are minimal fixtures;
this is not a clone of the full hosted database or a test of PO creation.

No application route, authentication, entitlement, audit or browser UI module is
mocked. Real username/password login creates the production secure HttpOnly/Lax
session cookie. Real middleware redirects unauthenticated pages; API routes
independently return 401. Invalid/expired sessions, DB role downgrades, inactive
users, org reassignment, disabled capabilities, viewer mutation and other-tenant
payment/bill identities are checked.

`localNeonFetch.cjs` is a **test-only Node preload**, never application code or
deployment configuration. It adapts Neon's HTTP transport to the one disposable
loopback PostgreSQL database. SQL, transactions and Neon's own type parsers stay
real. Mismatched database URLs and external fetches are blocked; Chromium also
blocks external requests. Never carry this preload's `NODE_OPTIONS` into another
process/environment. The harness only sets it for its child Next server.

The production server/browser flow records and reverses one multi-bill payment,
checks persisted audit events, downloads recorded/reversed PDFs and a historical
CSV, and captures desktop/mobile UI screenshots. Fixed timeline data makes the
historical assertions reproducible. The date regression checks a DATE column
round trip: the same September 5 due date appears on bill detail and AP Overview.
Bill read queries now return bill/due calendar dates as canonical text rather
than serializing driver Date objects through a timezone-dependent instant.

Evidence, screenshots, PDFs, CSV and server logs live in ignored
`test-results/ap-runtime/`. The harness closes Chromium, stops its Next process
tree and removes its disposable database container in `finally`, including on
failure. It does not verify hosted TLS, hosted Neon transport, proxy/CDN behavior,
production credentials, real customer data or live infrastructure.

### AP baseline evidence (5 October 2026)

- Commercial containment: 1,954 tests across 131 files passed after the date fix.
- Disposable PostgreSQL AP suites: 40 tests passed (migration 10, concurrency 7,
  overview 7, history 10, readiness 6). The readiness fixture includes the
  production bill calendar-date columns.
- Production webpack build: TypeScript and 323 static pages completed. Existing
  middleware-deprecation and missing command-centre HTML warnings remain.
- Production runtime: all 12 checks passed against build
  `5MrgdGBgLzyrj3mzbSLJe`; desktop/mobile screenshots were reviewed locally.
- Focused ESLint and Git whitespace checks passed. The earlier controlled
  browser suite remains separate evidence; the runtime pass exercises the actual
  built application and authentication.

### PR #342 CI remediation (6 October 2026, Adelaide)

GitHub's initial repository-wide CI run found eight failures in shared styling
and navigation guards, beyond the earlier Commercial-only run. The new Budgeting
pages and added PO sections now use theme/semantic tokens and restrained radii;
finance forms and tables use shared controls/styles. Navigation guards include
Budgeting as an active Commercial capability, matching the existing layout.

Two unchanged Data Hub source-reading tests also normalize CRLF before their
existing assertions, so Windows fixtures retain the same tenant and forbidden-
scheduler checks as Linux. No Data Hub runtime or SQL was changed.

- Repository-wide CI test command: 14,703 passed across 681 files; 64 tests and
  five files skipped. The same three existing CI file exclusions remain.
- Targeted shared/Commercial checks: 643 passed; portability/import checks: 125
  passed. An import timeout during concurrent build execution passed on rerun.
- TypeScript and focused ESLint passed.
- Existing controlled finance/export browser suites: 24 passed. These use
  controlled fixtures, rather than a hosted environment.
- Fresh production webpack build passed; all 12 local production AP runtime
  checks passed against build `3xPHaPSwliVUtaZecxH1K`.

These results resolve the observed CI failures; the draft still requires review
of the complete purchasing/budgeting/finance/AP diff and target-schema inventory.

### Purchase-match migration review

Review found that PostgreSQL's nullable CHECK semantics allowed a reversed
purchase-match allocation with a null reason. The purchase-match migration now
requires a non-null, non-blank reason and atomically replaces the earlier check
for existing installations. Reapplication preserves valid facts; invalid legacy
facts block constraint validation without removing the old check or rewriting
history. Inventory such rows and agree on recovery before applying the upgrade.
This concerns purchase matching, not supplier-payment settlement.

The disposable PostgreSQL migration suite passed all nine tests covering fresh rejection, legacy
upgrade/reapplication and atomic failure on invalid existing facts. Commercial
containment passed again after the SQL fix (1,954 tests).

## Release handoff

The remote CI rerun after the Commercial fixes exposed an unrelated Docker
fixture startup race: a socket readiness probe accepted PostgreSQL's temporary
initialization server just before shutdown. All three Docker-backed containment
fixtures now wait for TCP readiness; the affected Data Hub bootstrap also uses
that TCP endpoint. Their targeted suites passed all 80 tests locally. No test
assertions were removed and no application or Data Hub SQL changed for this fix.
The latest remote CI result must be checked before marking the draft ready.

The original tested application candidate is commit
`e65ce37bba71646f5c0c1018d8e5c283de55d474` on
`feat/c7-7-budget-account-design`. Later documentation-only commits do not change
that application candidate. Build ID `5MrgdGBgLzyrj3mzbSLJe` identifies that local
runtime verification. The subsequent CI-remediation candidate is `e4c36ace`,
verified against build `3xPHaPSwliVUtaZecxH1K`; a future deployment must record
its own build identity.

The AP implementation starts with design commit `53ccc137`, after `ca5d5c86`,
and includes schema/domain/API/UI, containment, reporting and runtime checks.
This range also contains production-build compatibility commit `3efb16ea`,
including changes outside AP. It is a local review range, not a confirmed diff
against a hosted release. Before rollout, compare the selected candidate with
the actual target's deployed commit and review the entire resulting diff.

Migration identities at the tested commit (Git blob IDs, independent of Windows
working-copy line endings):

| Installation | Script | Git blob ID |
| --- | --- | --- |
| Fresh AP, with existing supplier/bill prerequisites | `scripts/create-commercial-supplier-payments.sql` | `60c7fdb8c0058abe8c9cf2155495abe07a7ac5d4` |
| Existing AP tables | `scripts/add-commercial-supplier-payment-idempotency.sql` | `0749366b0b0a39f7813cc4b54c0fd7b7736967f8` |

Verify these identities from the selected candidate with:

```powershell
git rev-parse e65ce37b:scripts/create-commercial-supplier-payments.sql
git rev-parse e65ce37b:scripts/add-commercial-supplier-payment-idempotency.sql
```

The remaining release inputs are the explicitly authorized target environment,
its deployed commit and schema inventory, a recorded backup/recovery point,
and a compatible AP-aware rollback commit. Those inputs have not been inferred
from local environment files or verified against hosted infrastructure.

## Rollout prerequisites

1. Identify the exact target environment and approved AP-aware application
   release. Confirm its existing Purchasing supplier/PO/bill prerequisites and
   capability configuration. Save a restorable database backup/branch snapshot
   using the target provider's approved mechanism before schema changes.
2. Inventory whether AP payment tables already exist. For a fresh AP installation,
   apply `scripts/create-commercial-supplier-payments.sql`. For existing AP,
   apply `scripts/add-commercial-supplier-payment-idempotency.sql` **before**
   releasing retry-aware code. Use the approved migration mechanism and a
   maintenance window appropriate to table/index locks. Scripts are additive and
   idempotent; do not run Prisma schema push as a substitute.
3. Verify the payment/allocation foreign keys, request-key uniqueness, existing
   payment/allocation counts and sums, and absence of negative bill balances.
   Confirm the additive migration preserved existing payment facts. Do not print
   credentials or supplier/payment references in release logs.
4. Check POSTED/CANCELLED bill posting/cancellation timestamps and payment
   lifecycle consistency before enabling historical reports. Missing chronology
   returns `AP_HISTORY_INCOMPLETE` (409); never backfill guessed dates from
   `updated_at` merely to make this gate green.
5. Deploy only after authorization, with genuine session secrets and provider
   configuration. The production runtime must not include the local transport
   adapter, disposable database URL, placeholder secrets or test fixtures.
6. Run approved live smoke checks: signed-in viewer/admin access, tenant
   isolation, current/historical totals and downloads. Any live payment
   record/reversal must be an explicitly approved controlled transaction. Compare
   AP totals and audit evidence; confirm Budget Actual and finance evidence remain
   unchanged by settlement. Record release identity and results.

## Rollback

Pause new payment entry while investigating a release failure. Roll application
code back to a known compatible **AP-aware** build, preserving payment tables,
allocations, audit facts, nullable request columns and indexes. An old build that
lacks active-payment bill-cancellation protection or retry protection is not a
safe default rollback target. Confirm compatibility before reopening writes.

Do not drop AP tables or delete payments to undo an application deployment. Do
not reverse genuine payments just to roll code back. If a schema migration
fails, resolve its failed transaction or use the recorded provider recovery plan
under separate authorization; a database restore after new writes needs an
explicit data-recovery decision. Reconcile payment/allocation counts, exact
balances and audit events before restoring normal operation.

## References

- [Settlement verification and finance isolation](commercial-ap-verification.md)
- [Retry and disposable readiness evidence](commercial-ap-readiness.md)
- [Remittance and migration prerequisites](commercial-supplier-remittance.md)
- [Paged aging and load evidence](commercial-supplier-ap-pagination.md)
- [PDF/CSV downloads](commercial-supplier-ap-downloads.md)
- [Historical recorded balances](commercial-supplier-ap-history.md)
