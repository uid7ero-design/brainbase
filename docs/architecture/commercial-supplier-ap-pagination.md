# Supplier AP filtering and pagination

Implemented locally on 5 October 2026 after the AP readiness load test found an 18.8 MB response for 50,000 posted bills. Bill detail and supplier aging now return separate bounded pages, while currency totals always cover the entire filtered scope. No schema migration is required for this read-model change.

## HTTP contract

`GET /api/commercial/purchasing/ap-overview` retains purchasing/view authorization, session-owned tenant scope, required `aging_date=YYYY-MM-DD`, and no-store responses. It accepts:

| Parameter | Meaning | Default / bound |
| --- | --- | --- |
| `search` | Case-insensitive literal substring across supplier name, bill number, and invoice number | Empty; trimmed; at most 200 characters |
| `currency` | Exact three-letter uppercase code | All currencies |
| `supplier_id` | Tenant-owned supplier UUID | All suppliers |
| `bucket` | One of the existing six aging buckets | All buckets |
| `page` | Outstanding-bill page | 1; positive integer, maximum 1,000,000 |
| `supplier_page` | Supplier/currency aging page | 1; same bound |
| `page_size` | Rows in each table | 50; positive integer, maximum 100 |

Malformed input returns 400 before querying. Valid but absent/cross-tenant suppliers yield an empty scope; the tenant still comes exclusively from authorization. Search `%` and `_` are literal characters, not SQL wildcard operators.

The response retains `report.aging_date`, `balance_basis`, `currencies`, `suppliers`, and `bills`, and adds validated `filters`, `pagination`, and `options`. `pagination` contains requested pages, page size, the full matching outstanding-bill count, and the full matching supplier/currency-row count. Out-of-range pages are empty with their scope counts and currency totals intact.

`currencies` contains exact totals and buckets across every matching posted bill, including fully paid and zero-value bills. `suppliers` contains a page of complete supplier/currency totals. `bills` contains a page of outstanding bills only. Clients must never reconstruct portfolio totals from those pages. Amounts remain decimal strings.

One SQL statement preaggregates recorded allocations, classifies current balances by calendar date, applies filters, aggregates totals, and only then limits the two row sets. All response sections share its statement snapshot. A negative balance anywhere in the tenant's posted scope fails closed even when filtered out or on another page. Bill ordering is supplier name under explicit C collation, supplier ID, currency, due date with null last, then bill ID. Supplier/currency rows use name, ID, and currency. Separate live requests can reflect intervening settlements; pagination does not pin a historical snapshot.

`options` contains currency choices and a compact supplier ID/name directory for the tenant's posted scope, independent of current filters and page. This preserves filter discovery across pages. The directory is not paginated and grows with distinct suppliers; the load fixture covers 1,000 suppliers. Very large supplier directories would need remote supplier lookup separately. Full bill/aging rows are bounded regardless of bill count.

## Client behavior

The existing filters now query the server. Search is debounced by 250 ms; changing any filter or aging date resets both pages. Previous/Next controls page bill rows and supplier aging independently. Totals explicitly cover all matching bills across pages. Stable filter options remain available after narrowing the result.

Each response is associated with the exact request key, pending reads are aborted, and changing a filter hides previous totals immediately. Older page responses cannot restore balances under newer inputs. An unchanged search never resets pagination. Failed/forbidden reads clear report data and filter options. Empty pages are distinguished from an empty full scope by their counts and currency totals.

## Verification and local measurements

Six disposable-PostgreSQL overview tests cover allocation aggregation, reversal, tenant/lifecycle exclusion, exact aggregate overflow, full totals across one-row pages, fully paid bills, canonical page order, literal search, currency/supplier/bucket filters, every aging boundary, and negative-balance failure outside a selected filter/page. Four actual-component overview browser tests cover filtering, denied reads, independent pagination, full totals, page reset, filter discovery, and delayed-response races. The readiness harness also exercises the real UI, HTTP handlers, and PostgreSQL at both 10,000 and 50,000 bills; existing retry/reversal checks still pass.

| Posted bills | JSON bytes | First HTTP | Warm median / max | Browser render |
| --- | --- | --- | --- | --- |
| 10,000 | 129,203 | 92 ms | 64 / 83 ms | 195 ms |
| 50,000 | 129,617 | 204 ms | 186 / 198 ms | 427 ms |

The fixture uses 1,000 suppliers, 5,000/25,000 payments and allocations, AUD/USD, inactive suppliers, null dates, partial settlement, and reversals. Every HTTP sample asserts the two 50-row limits, a response under 250 KB, full bill counts, and exact full-scope paid/outstanding totals. The browser moves to page two without changing totals, then searches for a bill and returns to page one. Relative to the earlier 18,805,700-byte all-row response, the 50,000-bill response is 99.3% smaller. Measurements are local and include the test harness's transport/render observation; they are not deployed latency guarantees. Fresh samples are written to ignored `test-results/ap-readiness-load.json`.

The existing supplier-remittance candidate query remains separate. Settlement facts, Budget Actual, finance close/reconciliation, historical AP, exports, and hosted rollout are outside this read-only slice. No hosted database was accessed, pushed to, or deployed.

Final gates passed: 1,936 Commercial containment tests across 129 files, 11 browser flows, six overview PostgreSQL tests, four UI/HTTP/PostgreSQL readiness tests including both load sizes, TypeScript, focused ESLint, and the production webpack build. All 322 static pages generated. The build retains existing middleware deprecation and missing dashboard-source warnings. Disposable test containers were removed.
