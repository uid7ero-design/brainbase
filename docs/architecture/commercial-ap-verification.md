# Supplier AP settlement verification

Verified locally on 5 October 2026. No hosted database, push, or deployment was used.

## Coverage

- AP-1: nine real PostgreSQL migration tests, including tenant relationships, positive amounts, provider identity, multi-allocation structure, and idempotency.
- AP-2: three real PostgreSQL concurrency tests proving competing payments cannot consume the same remaining balance, reversal restores the balance, and concurrent reversal permits one transition.
- AP-3/AP-4: Commercial containment covers authorization, bill-scoped HTTP contracts, summary/history, record/reverse actions, and cancellation protection.
- AP-5: the disposable budgeting harness applies the AP migration twice and runs all budgeting, Actual, finance close, adjustment, External GL, and reconciliation integration suites. The combined-report test compares report rows and finance rows before recording a settlement allocation and after both recording and reversal.
- Browser: the real supplier-bill client component is bundled for Chromium with navigation and HTTP seams. Tests exercise partial payment, required reversal reason, preserved reversal history, cancellation protection, and viewer-only access. These tests do not replace the separate server authorization or real PostgreSQL tests.

## Commands

```powershell
powershell -NoProfile -File scripts/tests/verify-commercial-budgeting.ps1
npx vitest run --project containment commercial
npx playwright test tests/browser/commercialSupplierPayments.spec.ts
npx next build --webpack
```

The AP migration and concurrency specifications run independently through `vitest.integration.config.ts`, each with a fresh disposable localhost database. Their setup creates prerequisite tables and must not share an existing application database.

Production builds use placeholder localhost database and session configuration. A successful build confirms compilation and page generation; it does not validate a deployed environment or apply the AP schema to a hosted database.
