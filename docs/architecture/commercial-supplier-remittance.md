# Supplier multi-bill remittance

The supplier detail workflow links to `/commercial/purchasing/suppliers/[id]/remittance`. Purchasing viewers can read outstanding candidates; Purchasing admins can record one payment allocated across up to 100 POSTED bills of one supplier and currency. Inactive suppliers remain payable.

`GET /api/commercial/suppliers/[id]/payments` returns outstanding candidates. `POST` accepts currency, payment method, reference, optional paid_at, and positive integer bill allocations. The server derives organisation/user from authorization, supplier from the route, and payment total from allocations. Client-supplied provider identity or authority fields are ignored. All responses disable caching.

The existing `recordSupplierPayment` transaction remains authoritative for supplier, currency, bill status, balance and concurrency. A failed allocation prevents the whole remittance. UUID duplicate detection now ignores letter casing in both the HTTP surface and domain validation.

The form parses decimal inputs exactly, checks remaining amounts, clears allocations when currency changes, and shows the remittance total. The payment total cannot exceed the existing PostgreSQL INTEGER storage range. The UI records at the current time; the HTTP surface retains the domain's optional explicit paid_at support. It adds no scheduling, bank feed, payment approval, provider integration, or unapplied cash workflow.

Success links to every allocated bill's payment history. A balance conflict preserves inputs and offers refresh. An uncertain failure advises checking bill history before retrying; automatic retries are not used. This foundation does not introduce an idempotency token for browser-submitted payments.

Reversal stays on bill detail and reverses the entire payment, including allocations to other bills. The confirmation now displays the full remittance amount and this bill's allocation. Individual allocation deletion or partial reversal is not supported.

Verification includes focused HTTP/input tests, real PostgreSQL multi-bill record/reverse/no-partial-write tests, and actual-component Chromium tests using controlled HTTP responses. Existing AP overview and bill-payment browser flows remain part of the regression run. No schema or hosted environment is changed.
