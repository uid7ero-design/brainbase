# Supplier AP settlement verification

Verified locally on 5 October 2026. No hosted database, push, or deployment was used.

The [release-readiness index and rollout/rollback guide](commercial-ap-release-readiness.md)
consolidates completed slices and adds actual `next start` login/middleware/UI
verification. Counts below record earlier implementation slices.

## Coverage

- AP-1: ten real PostgreSQL migration tests, including tenant relationships, positive amounts, provider identity, multi-allocation structure, and legacy request-key migration/reapplication.
- AP-2: seven real PostgreSQL concurrency tests proving competing payments cannot consume the same remaining balance, reversal restores the balance, concurrent reversal permits one transition, and payment retries cannot duplicate settlements.
- AP-3/AP-4: Commercial containment covers authorization, bill-scoped HTTP contracts, summary/history, record/reverse actions, and cancellation protection.
- AP-5: the disposable budgeting harness applies the AP migration twice and runs all budgeting, Actual, finance close, adjustment, External GL, and reconciliation integration suites. The combined-report test compares report rows and finance rows before recording a settlement allocation and after both recording and reversal.
- Browser: the real supplier-bill client component is bundled for Chromium with navigation and HTTP seams. Tests exercise partial payment, required reversal reason, preserved reversal history, cancellation protection, and viewer-only access. These tests do not replace the separate server authorization or real PostgreSQL tests.
- AP readiness: four additional browser/HTTP/disposable-Postgres tests join the actual payment UI, route authorization composition, settlement domain, and database. They cover lost-response retries, page reload, whole-remittance reversal, access denial, tenant isolation, and 10,000/50,000-bill load measurement. See [readiness evidence and limits](commercial-ap-readiness.md).
- AP pagination: six overview PostgreSQL tests and four overview browser flows verify full-scope totals, independent pages, server filtering, fully paid bills, SQL aging boundaries, and response races. The readiness load test now verifies 50-row bill/aging limits and response size below 250 KB at both 10,000 and 50,000 bills. See [pagination contract and evidence](commercial-supplier-ap-pagination.md).

## Commands

```powershell
powershell -NoProfile -File scripts/tests/verify-commercial-budgeting.ps1
powershell -NoProfile -File scripts/tests/verify-supplier-ap-readiness.ps1
npx vitest run --project containment commercial --maxWorkers=4
npx playwright test tests/browser/commercialSupplierPayments.spec.ts tests/browser/commercialSupplierApOverview.spec.ts tests/browser/commercialSupplierRemittance.spec.ts
npx next build --webpack
```

The AP migration and concurrency specifications run independently through `vitest.integration.config.ts`, each with a fresh disposable localhost database. Their setup creates prerequisite tables and must not share an existing application database.

Production builds use placeholder localhost database and session configuration. A successful build confirms compilation and page generation; it does not validate a deployed environment or apply the AP schema to a hosted database.
