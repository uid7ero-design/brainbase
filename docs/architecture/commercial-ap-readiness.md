# Supplier AP readiness — retry safety and verification

Local verification on 5 October 2026 covers payment retries, the UI-to-HTTP-to-database path, and overview load. No hosted database, push, or deployment is involved.

## Retry contract

Both single-bill and multi-bill payment POSTs require a UUID `Idempotency-Key`. The domain normalizes the key and hashes the supplier, amount, currency, method, reference, provider identity, explicit paid date, and sorted allocations. An omitted paid date stays null in the fingerprint, so a retry does not become a new request simply because time passed.

A transaction-scoped advisory lock serializes an organisation/key pair. The subsequent Read Committed statements lock bills in stable order, find an existing request, or perform the existing atomic balance-checked insert. A unique partial organisation/key index backs the invariant. A matching retry returns the existing payment and allocations even when its first attempt fully settled a bill; a changed request under the same key returns 409. A reversed payment remains reversed. The single-bill route retains its existing POSTED-bill prerequisite, so a later-cancelled bill is rejected before domain replay.

The forms persist a payload fingerprint and opaque UUID in tab session storage. They retain keys on errors and clear them only after parsing a successful response. A reload can recover the same intent; a confirmed new payment gets a new key. Allocation order is stable before the browser fingerprints a remittance. No payment amounts or references are stored in session storage. Closing/clearing the browser context or changing the payment details is outside the same-intent retry guarantee; payment history remains the source for resolving uncertainty. This does not deduplicate two independently initiated payments in different tabs.

Apply `scripts/add-commercial-supplier-payment-idempotency.sql` to an existing installation **before releasing the new code**. The base AP migration is also safe for fresh installation or reapplication. Nullable columns preserve existing payment records. The migration test removes the new columns from a populated disposable fixture, upgrades twice, verifies existing facts are unchanged, and proves duplicate keys are rejected.

## Executable evidence

`powershell -NoProfile -File scripts/tests/verify-supplier-ap-readiness.ps1` creates a loopback-only PostgreSQL 16 container with a separate fresh database per suite, restores the caller's database URL, and removes the container in `finally`. Chromium must already be available through Playwright. `-Suites supplierApReadiness` runs only the HTTP/browser/load slice.

- Migration: 10 tests for AP constraints, repeatability, and additive upgrade.
- Concurrency: 7 tests, including six simultaneous identical submissions, disjoint-bill key misuse, canonical allocation ordering, tenant-scoped keys, reversed replay, overpayment contention, and whole-remittance reversal. Identical retries produce one payment, one set of allocations, and one audit call.
- Overview query: 2 tests for active allocation totals, exact cents, aging, inactive suppliers, and tenant/lifecycle isolation.
- HTTP/browser/load: 4 tests. A real remittance submission commits to PostgreSQL and loses its JSON response body; repeating it returns the same payment. The bill-history UI reverses both allocations. A single-bill retry survives a page reload, while a later confirmed submission with the same details creates a new payment. Actual Commercial authorization composition rejects viewer mutation, missing entitlement, missing authentication, and another tenant's supplier.

The browser harness bundles the actual React pages and uses a loopback HTTP server that dispatches the production payment, reversal, summary, and overview handlers. It does not mock those HTTP responses or the settlement SQL. Test seams are identity/entitlement fixtures, audit-call capture, a pg adapter for the Neon tagged-SQL interface, Next navigation, and ancillary bill detail/attachment/tax responses. It does not exercise login cookies, middleware, Next's HTTP router, deployed infrastructure, or production styling. Separate existing browser tests cover the client interactions with controlled HTTP errors.

Final local gates passed: 1,923 Commercial containment tests across 129 files (`--maxWorkers=4`), 23 disposable-Postgres tests across the four suites above, nine existing Chromium flows, TypeScript, focused ESLint, and `next build --webpack` with placeholder localhost/session configuration. The build retains the existing middleware deprecation and missing `Dashboards/command-centre.html` source warnings. All 322 static pages generated successfully. Disposable containers were removed after verification.

## Load measurement

The fixture contains 1,000 suppliers (including inactive ones), AUD/USD bills, mixed due dates including null, partial payments, and reversed payments. All bill totals are 10,000 cents; active paid allocations sum to 800 cents per bill on average. Every sampled response reconciles exact paid/outstanding totals and excludes the other tenant's bills. It uses the actual AP payment migration and indexed minimal supplier/bill prerequisites.

Six HTTP samples are taken per size: the first request and five subsequent requests. Times include handler execution, JSON serialization, loopback transfer, and reading the response body; they exclude the test's later JSON assertions. Browser time includes navigation, actual-component rendering, and locating all outstanding bill links. These are local measurements, not production latency targets.

| Posted bills | Payments / allocations | First HTTP | Warm median / max | JSON response |
| --- | --- | --- | --- | --- |
| 10,000 | 5,000 / 5,000 | 102 ms | 96 / 109 ms | 4,360,945 bytes |
| 50,000 | 25,000 / 25,000 | 453 ms | 453 / 496 ms | 18,805,700 bytes |

The 10,000-bill page rendered in 1,392 ms and filtering to one bill took 183 ms in this sample. The 50,000-bill page was measured through HTTP only. The runner writes fresh measurements to ignored `test-results/ap-readiness-load.json`; repeated runs vary with machine load.

The measurements above record the original all-rows baseline. [Server-side filtering and pagination](commercial-supplier-ap-pagination.md) is now implemented, preserving full filtered totals and reducing the 50,000-bill response to about 130 KB. The same readiness runner now verifies bounded pages and both large datasets through the browser as well as HTTP. Historical AP, exports/remittance downloads, provider feeds, hosted migration, and deployment remain separate work.
