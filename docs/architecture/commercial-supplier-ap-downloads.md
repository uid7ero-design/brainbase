# Supplier AP downloads

Purchasing viewers can download remittance PDFs from the payment result and each
bill's payment history, and filtered bills/supplier aging CSVs from AP Overview.
All routes use the session organisation, purchasing view authorization and
`Cache-Control: no-store`. Downloads do not send email or initiate bank payments.

## Remittance

`GET /api/commercial/supplier-payments/[id]/remittance` returns an attachment PDF.
An absent or foreign-tenant payment returns 404. One database statement reads an
explicit allowlist of payment, supplier, purchaser and allocated bill fields.
All allocation joins retain organisation, supplier and currency. Missing or
non-reconciling allocations fail closed. Provider metadata, request keys and
internal user IDs are excluded.

The document includes payment ID, reference, date, method, currency, every bill
allocation and the exact payment total. Reversed payments remain downloadable;
every page says `REVERSED - NO ACTIVE SETTLEMENT`, with the reversal date and
reason in the document body. Names reflect current master records and the PDF
states that it describes a recorded payment, rather than bank confirmation.
Generation stays server-side and jsPDF is excluded from client components.

## AP CSV

`GET /api/commercial/purchasing/ap-overview/export` accepts the overview's
`aging_date`, `search`, `currency`, `supplier_id` and `bucket` filters, plus
`view=bills|aging` (default bills). Paging parameters are ignored. The UI offers
links only while the displayed report matches the applied filters.

Both exports use the same SQL snapshot and filtering/aggregation as the paged
overview. No page loop or arbitrary maximum row count is used. Bills CSV includes
all matching POSTED bills, including fully paid and zero-value bills, so payable,
paid and outstanding columns reconcile. Aging CSV includes every matching
supplier/currency aggregate, all six aging buckets and bill counts. Currencies
are separate; aging classifies current balances at the selected date and is not
a historical liability report. Totals retain exact decimal strings in integer
cents, without converting through JavaScript floating-point numbers.

CSV uses UTF-8 BOM, CRLF records, quoted multiline fields and formula-prefix
protection including leading whitespace/control characters in untrusted text.
No new database migration is required. Existing AP payment/idempotency migration
prerequisites still apply before any future deployment.

## Verification

Containment covers authorization before reads, tenant identity, invalid filters,
exact cents above JavaScript's safe-number range, CSV formula/quote/multiline
escaping, missing/corrupt allocations, private failure responses and multipage
PDF reversal markings. Disposable PostgreSQL/browser readiness tests download
actual recorded/reversed PDFs and CSVs, test viewer/entitlement/tenant isolation,
and reconcile complete exports at 10,000 and 50,000 bills despite page parameters.
PDF samples include long names/references, long reversal reasons and 100
allocations for rendering review.

Local validation: 1,949 Commercial containment tests, 11 browser tests and 12
disposable PostgreSQL overview/readiness tests passed, alongside TypeScript and
focused ESLint and the production webpack build (323 static pages). Existing
middleware-deprecation and missing command-centre dashboard warnings persist.
In the disposable load fixture, the 50,000-bill export contained
50,000 rows (9,552,425 UTF-8 bytes) and completed in 1,049 ms including download
and reconciliation. This is a local fixture measurement, not a production SLA.
