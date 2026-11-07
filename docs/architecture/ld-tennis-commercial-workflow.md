# LD Tennis Commercial workflow bundle

## Problem and scope

The existing domain supports customer invoices, invoice lines, issue/payment transitions, purchase orders, receipts, supplier bills and supplier payments. LD Tennis already has an exact-cents, currency-separated monthly business summary. This bundle makes these existing workflows accessible together and closes demonstrated read/write-recovery gaps; it does not add another ledger.

- `/business/tennis/finance` uses the existing tenant-specific access resolver and current visible Invoicing/Purchasing grants. It presents invoiced amounts, recorded receipts, all-time outstanding issued invoices, dated supplier bills and recorded supplier payments separately.
- Invoice and supplier-bill creation now fail closed on failed prerequisite reads and support explicit retry. A non-personal session recovery marker is written before POST. Lost responses, 5xx/408 and malformed success bodies lock repeat creation across reloads. The user must review saved records and explicitly acknowledge that another draft is needed; unlocking also requires a fresh successful ledger read. In-flight and confirmed navigation guards suppress repeat clicks in the current tab.
- Invoice and supplier-bill lists distinguish loading, failed reads and genuine empty lists. Failed reads never display a zero-record assurance.
- The business workspace and guide link the lesson/payer/invoice/payment and supplier/order/receipt/bill/payment steps. Stale pre-cutover coaching instructions are replaced with the released Scheduling workflow.

## Boundaries

No schema, hosted settings, money movement, email sending or production records are changed. Existing routes remain responsible for tenant, capability, role, origin, lifecycle and audit enforcement. The concurrent Learnli connected-finance branch changes different surfaces; its connected-sales semantics and shared sidebar/layout are not imported or overwritten.

Invoice drafts still require explicit customer, line, price, tax and issue decisions. A booking reference is not a durable invoice linkage or deduplication key. Supplier costs still use the existing controlled purchasing process; this is not a standalone cash-expense journal. Receipts/payments are saved records, not verified bank settlement or profit/tax accounting. No GST status is inferred.

Recovery is intentionally conservative: the marker is tab-scoped and contains no customer or draft data. It is not cross-device/server idempotency. A marker can block another organisation in the same tab until an explicit review; it never exposes another organisation's records. Clearing browser storage or affirmatively creating another draft after review can still produce a duplicate. The UI must not claim exactly-once processing.

## Verification

Focused component/containment command:

`npx vitest run tests/components/app/TennisFinanceWorkflow.test.tsx tests/components/app/TennisBusinessRecovery.test.tsx tests/components/scheduling/CoachingInvoicePreparation.test.tsx tests/containment/commercialInvoiceUiContract.test.ts tests/containment/commercialSupplierBillDetailPageRefresh.test.ts tests/containment/tennisBusinessModel.test.ts`

`node scripts/tests/verify-hr-full-local.mjs --tennis-finance` owns a disposable loopback Postgres database and real local Next/login/session stack. It blocks external provider egress. Invoice and bill draft creation are driven through actual browser forms, their responses are lost after the real route commits, and reloads remain locked with exactly one row. Existing actual HTTP domain transitions add lines, issue/post and record synthetic payments. Saved monetary summaries are asserted against the resulting database. This does not certify every downstream financial form, PDF/email delivery, live bank/provider behavior or real customer setup.

The harness also checks billing-customer linkage/recovery, failed supplier-list retry, managed finance-page denial, revoked grants, foreign tenant denial and finance layout at 390/768/1440px. Screenshots contain synthetic data only. Application build/TypeScript, changed-file lint and final-head CI/security/preview are separate gates. Release requires explicit authorization.

## Local acceptance receipt — 6 November 2026

77 focused component/containment checks passed. The final real Next/login/disposable-Postgres browser journey passed and removed its owned services. Browser-led invoice and bill creation each produced one row despite a lost response and reload; invoice issue/partial receipt and bill posting/full payment reconciled to AUD 60.00 / 20.00 / 40.00 and AUD 15.00 / 15.00 respectively. Failed supplier-ledger reads recovered through explicit retry. Managed access, tenant denial and 390/768/1440 layout checks passed. Changed-file lint and the optimized production build with TypeScript passed. Hosted checks remain an exact-PR-head gate; no production release is included in this receipt.

## Unpaid customer invoices

The finance workspace links to `/business/tennis/finance/unpaid` for staff with invoicing access. The list covers all months. Each row opens the issued invoice and shows the saved billing customer, due date, currency, invoice total, recorded allocations and remaining balance. Due dates use the Adelaide calendar. A failed read offers a retry and keeps the empty-list message hidden.

The production-mode local finance rehearsal used a synthetic AUD 60 invoice. It verified AUD 40 outstanding after a partial receipt, disappearance after final payment, reappearance after reversal, read-error recovery, a narrow viewport and denial for CRM-only staff.

## Paid receipt expenses

LD Tennis finances shows a separate monthly AUD total for purchases already paid from a receipt. Open **Receipt expenses** to select a month, review purchases or start an entry. Record the actual purchase date, merchant, description and gross amount, plus the receipt number when available. Keep the original receipt separately. This entry records a purchase and does not calculate a tax credit, move funds, or add a supplier bill or purchase order.

The release requires `scripts/create-tennis-receipt-expenses.sql` (one table and its month lookup index). The form uses a fresh entry ID for each new purchase. The same ID and contents can be confirmed again after a lost response. Conflicting contents cannot replace the saved entry. Independently starting a new entry creates a new purchase, so check the month register before re-entering a receipt. Purchasing readers can review the register. Recording a paid receipt uses the existing supplier-payment role floor and requires Purchasing use for managed staff.

## Shared Commercial registers

Organisations with Invoicing can open **Commercial → Unpaid Customer Invoices** to see issued invoices that still have a balance, including partial payments. Open an invoice to review its payment history.

Organisations with Purchasing can open **Commercial → Receipt Expenses**, choose the purchase month and select **Record a paid expense**. Use the gross AUD amount on the receipt. Administrators with Purchasing write access can save purchases. Readers can review saved receipts. If a save is interrupted, use **Check saved receipt** before starting another entry.

LD Tennis can use either its finance workspace or Commercial to reach the same records. Both routes use the existing organisation-scoped receipts table and invoice allocations. Enabling these screens requires no data migration or new module.
