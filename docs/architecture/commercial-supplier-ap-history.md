# Historical recorded supplier AP

AP Overview offers `Current balances` (the existing default) and `Historical
recorded balances`. Both the overview and bills/aging CSV endpoints accept
`balance_basis=CURRENT_POSTED_BILLS|HISTORICAL_RECORDED_BALANCE`; unknown values
return 400. Existing callers retain current balances. Purchasing view access,
session tenant scoping, no-store responses, filters, pagination and exact cents
apply to both modes. Historical CSV filenames include `historical`, and rows
carry the balance basis and UTC cutoff timezone.

## Meaning of the selected day

Historical mode reconstructs recorded liabilities at the end of `aging_date`
in UTC and ages those balances on the same day. The next UTC midnight is an
exclusive boundary, computed explicitly in SQL independently of database/session
timezone. Events exactly at that midnight belong to the following day. This
uses recorded lifecycle timestamps, not invoice dates or a forecast.

- Include bills posted before the boundary. A currently CANCELLED bill remains
  included if cancellation occurred at or after the boundary.
- Include allocations only if payment `created_at`, payment `paid_at` and
  allocation `created_at` are all before the boundary. A backdated payment
  entered later does not rewrite an earlier report. A future-dated payment
  becomes effective only when its paid date has been reached.
- A currently REVERSED payment still settles its allocations before its reversal
  timestamp; after reversal, the full remittance returns to outstanding balances.
- Fully paid bills are included in payable/paid totals and CSVs, while the
  outstanding-bill table continues to show positive outstanding balances only.

For example, a $100 bill posted October 1 and paid $25 on October 2 has $75
outstanding on October 3 even if that payment was reversed on October 5. If the
bill was subsequently cancelled October 6, it remains included before October 6
and disappears afterwards. A payment entered October 4 with an October 1 paid
date does not reduce the October 3 recorded balance.

## Reliability boundaries

Posting and cancellation timestamps already persist in supplier bills. Payment
recording, paid dates, allocation creation and reversal timestamps already
persist in AP payment tables. Posted bill amounts, invoice numbers and due dates
are locked by the existing lifecycle. No schema migration or hosted change is
required for this report.

Names and supplier active status remain current master data, explicitly labelled
in the UI. This is a reconstruction from stored lifecycle facts, rather than a
frozen accounting close or evidence of transaction commit visibility at a past
instant. Dates before the dataset's retained history cannot recover deleted,
manually overwritten or never-recorded facts. Future selections classify known
facts; they do not predict future postings, payments or cancellations.

Missing posting/cancellation timestamps or contradictory lifecycle timestamps
anywhere in the tenant fail the historical read/export with 409 and
`AP_HISTORY_INCOMPLETE`, even outside the chosen filter/page. No timestamps are
guessed from `updated_at`, bill date or audit text. Current reporting continues
to work independently. Negative outstanding balances continue to fail closed.

The same SQL statement reconstructs balances, filters, aggregates and pages (or
all export rows), preserving one statement snapshot and currency separation.
Reports regenerated after later ordinary entries/reversals/cancellations retain
earlier balances under these timestamp rules.

## Verification

Run `scripts/tests/verify-supplier-ap-readiness.ps1 -Suites supplierApHistory`
for disposable PostgreSQL tests covering each lifecycle boundary, UTC session
independence, late-entered and future-dated payments, later allocations, exact
aggregate cents, filtered/paged totals, historical CSVs, fully paid bills and
incomplete-history failures. The default readiness runner includes this suite.

The browser/readiness suite exercises switching basis/date through the real UI,
HTTP handlers and PostgreSQL, downloads the historical CSV, and checks that an
incomplete-history error removes old totals and export links. Controlled browser
tests also verify that a late response from the previous basis/page cannot
restore stale balances or export links.

Local validation passed 1,954 Commercial containment tests, 12 controlled browser
tests, 10 historical PostgreSQL tests, 7 current overview PostgreSQL tests and 6
HTTP/browser/readiness tests, alongside TypeScript and focused ESLint. The
50,000-bill historical API sample returned bounded 50-row pages with reconciled
totals, 129,776 JSON bytes and 174 ms including loopback transfer. This local
fixture measurement is not a production SLA.

The production webpack build also passed, generating all 323 static pages. The
existing middleware-deprecation and missing command-centre dashboard warnings
remain. No hosted database, push or deployment was involved.
