# Supplier multi-bill remittance

The supplier detail workflow links to `/commercial/purchasing/suppliers/[id]/remittance`. Purchasing viewers can read outstanding candidates; Purchasing admins can record one payment allocated across up to 100 POSTED bills of one supplier and currency. Inactive suppliers remain payable.

`GET /api/commercial/suppliers/[id]/payments` returns outstanding candidates. `POST` requires a UUID `Idempotency-Key` header and accepts currency, payment method, reference, optional paid_at, and positive integer bill allocations. The server derives organisation/user from authorization, supplier from the route, and payment total from allocations. Client-supplied provider identity or authority fields are ignored. All responses disable caching.

The existing `recordSupplierPayment` transaction remains authoritative for supplier, currency, bill status, balance and concurrency. A failed allocation prevents the whole remittance. UUID duplicate detection now ignores letter casing in both the HTTP surface and domain validation.

The form parses decimal inputs exactly, checks remaining amounts, clears allocations when currency changes, and shows the remittance total. The payment total cannot exceed the existing PostgreSQL INTEGER storage range. The UI records at the current time; the HTTP surface retains the domain's optional explicit paid_at support. It adds no scheduling, bank feed, payment approval, provider integration, or unapplied cash workflow.

Success links to every allocated bill's payment history. A balance conflict preserves inputs and offers refresh. An uncertain failure advises checking bill history before retrying; automatic application retries are not used. Both payment forms retain the retry key for the same payment details in tab session storage, including across a reload. A confirmed response clears it so an intentional subsequent payment can use identical details. Editing details or using another browser context is a new intent; check history first after an uncertain outcome. Storage contains opaque keys and payload fingerprints, not payment details.

The server serializes a key within the organisation before locking bill balances. Matching retries return the original payment and allocations without another audit event; reusing the key for changed details returns 409. Allocation order and UUID casing do not change the server's request fingerprint. Replaying a reversed payment never reinstates it, and the remittance UI identifies that state. Keys do not expire in the database. Legacy internal callers without a key remain supported; both HTTP payment-recording endpoints require one.

Reversal stays on bill detail and reverses the entire payment, including allocations to other bills. The confirmation now displays the full remittance amount and this bill's allocation. Individual allocation deletion or partial reversal is not supported.

Verification includes focused HTTP/input tests, real PostgreSQL concurrency tests, and actual-component Chromium tests. The readiness harness additionally connects the real UI to HTTP-dispatched production payment/overview handlers and disposable PostgreSQL, including a committed payment whose response body is lost. See [AP readiness](commercial-ap-readiness.md) for test boundaries and load measurements.

Existing AP installations must apply `scripts/add-commercial-supplier-payment-idempotency.sql` before this code is released. Fresh installations and reapplications of `scripts/create-commercial-supplier-payments.sql` also include the nullable request columns and unique organisation/key index. Only disposable local databases have been migrated; hosted migration and deployment remain separate actions.
