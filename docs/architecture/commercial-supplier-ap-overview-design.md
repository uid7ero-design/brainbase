# Supplier AP overview and aging

Status: implementation design following AP-1 through AP-5.

## Purpose and existing contracts

Supplier-bill detail already exposes governed settlement summary/history and record/reverse actions. `lib/commercial/supplierPayments.ts` derives paid amounts from bill allocations attached to RECORDED payments. Supplier master data lives in `lib/commercial/suppliers.ts`; payable facts live in `lib/commercial/supplierBills.ts`.

Add a read-only portfolio view of current supplier liabilities, with links into those existing bill workflows. No new schema or payment mutation endpoint is required.

Supplier payments remain cash settlement. This view must not change C7.8 Budget Actual, C7.9 finance snapshots, close controls, reconciliation, or External GL evidence. It is an operational AP view, not a statutory ledger.

## Current balance rules

- Include only POSTED supplier bills belonging to the authenticated organisation.
- Include inactive suppliers when they have POSTED bills; deactivation cannot hide a liability.
- Payable is the bill's gross `total_cents`, including tax.
- Paid is the sum of allocations to that bill whose parent payment is RECORDED. Use allocated amounts, never the entire remittance amount.
- Outstanding is payable minus paid. REVERSED payments contribute zero paid amount while their history remains available on bill detail.
- Group supplier summaries and portfolio totals by currency. Never sum AUD and another currency into one money metric or infer FX conversion.
- A fully paid bill contributes to payable/paid totals but zero outstanding and no aging amount.
- Zero-total bills contribute zero amounts; do not invent a payment requirement.
- Negative remaining balances indicate an invariant failure. Do not silently clamp them away; return a controlled report error rather than misstate liabilities.

Labels use “Posted payable”, “Paid against posted bills”, and “Outstanding”. Paid here is allocated settlement of currently POSTED bills, not all supplier cash paid during a period.

## Aging policy

The report has an explicit `aging_date` in canonical YYYY-MM-DD form. The first UI supplies today's browser-local calendar date, displays that date, and permits changing it. A direct API caller must supply it; the server must not silently choose its own timezone's day. Validate both syntax and actual calendar validity.

For each outstanding bill, subtract due date from aging date using calendar-day arithmetic, independent of timezone and daylight-saving transitions. Read database DATE values as canonical text so driver conversion does not shift a day. Reuse Commercial date formatting in the UI.

Mutually exclusive buckets:

| Bucket | Rule |
| --- | --- |
| Not yet overdue | due date is on or after aging date |
| 1–30 days overdue | day difference 1 through 30 |
| 31–60 days overdue | day difference 31 through 60 |
| 61–90 days overdue | day difference 61 through 90 |
| 91+ days overdue | day difference at least 91 |
| No due date | due date is null |

Overdue is the sum of the four overdue buckets. No due date stays outstanding but is not classified as overdue. Do not substitute bill date or infer payment terms.

These buckets classify **current** balances using the selected aging date. Changing the date does not reconstruct historical payment state. Show “Current outstanding balances aged at [date]”; do not label it “historical AP as of”. Historical AP would need explicit recorded/reversed event-cutoff policy and separate implementation.

## Read model and query

Introduce server-only `lib/commercial/supplierApOverview.ts` and a client-safe types module. Obtain bill amounts, allocation totals, and supplier display fields in one SQL statement so summary and detail are derived from the same statement snapshot.

Pre-aggregate active allocations by organisation and bill before joining supplier bills. This prevents multiple allocations from multiplying bill totals. Scope all bill, supplier, allocation, and payment joins by organisation; retain the supplier/currency relationships from the settlement schema.

Use PostgreSQL numeric/bigint sums and return aggregate cents as exact decimal strings. Do not cast portfolio sums to PostgreSQL INTEGER; many individually valid bills can overflow that range. Use the existing exact money formatter for aggregate values.

The response contains:

- `aging_date` and `balance_basis: CURRENT_POSTED_BILLS`;
- portfolio totals per currency;
- supplier/currency summaries with supplier ID, name, active flag, bill count, outstanding bill count, payable, paid, outstanding, overdue, and all six aging amounts;
- bill rows with stable bill/supplier IDs, bill number, supplier invoice number, due date, currency, payable, paid, outstanding, and bucket.

Summary invariants: payable equals paid plus outstanding; bucket totals equal outstanding; supplier/currency totals sum to portfolio totals in the same currency. Keep stable ordering by supplier name/ID, currency, due date, and bill ID.

The initial report returns summaries and bill rows together, following the existing Commercial report pattern. Measure representative large-tenant output before rollout; if pagination is needed, retain full-scope totals and implement server-side filtering rather than deriving totals from a page of bills. No per-bill query loop.

## HTTP and UI

Add `GET /api/commercial/purchasing/ap-overview?aging_date=YYYY-MM-DD`, guarded by `authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view)`. Derive organisation identity from the session. Invalid dates return 400; denied access returns the existing authorization response. Successful and error responses must be no-store. No write action or supplier-bank details are added.

Add an “AP Overview” entry in the Purchasing navigation and a link from Suppliers. Preserve the Suppliers master-data table; its rows are supplier records, while AP summaries are supplier/currency records.

Use existing App UI headers, fields, tables, state messages, and money/date helpers. Show separate currency totals, supplier summaries, aging buckets, and outstanding bill rows linking to bill detail. Include search, currency, supplier, and bucket filters; state whether displayed totals reflect filters. Prefer deriving displayed totals and rows from the same filtered dataset.

Handle loading, empty, forbidden, and failed reads distinctly. A failed request must not leave stale totals displayed as current. Viewers can read the overview; payment mutations remain on bill detail under their existing stricter role floor.

## Implementation slices and acceptance

1. Read-model foundation: exact amount types, calendar-date validation, bucket calculation, single-statement tenant-scoped data access, and focused domain tests.
2. HTTP surface: purchasing/view, session-owned tenant scope, validated date, no-store, stable failure mapping, and route tests.
3. UI: portfolio/currency summaries, supplier aging, bill links, navigation, filters, and browser coverage of the actual component.
4. Verification: disposable PostgreSQL tests for partial payment, reversal, multi-bill allocation, inactive suppliers, excluded DRAFT/CANCELLED bills, currency separation, null dates, bucket boundaries, aggregate overflow, and tenant isolation. Re-run Commercial containment, TypeScript/lint, and production build; commit locally without push or deployment.

Tests must prove multiple allocations do not multiply payable totals; a due-today bill is not overdue; leap-day and daylight-saving dates are stable; changing aging date changes classification without pretending to reconstruct historical balances; report totals reconcile; settlement still leaves finance evidence unchanged.

## Deferred work

Multi-bill remittance UI, bank feeds, payment approval, historical AP reconstruction, exports, FX, supplier bank details, and hosted migration/deployment remain separate slices. The existing settlement domain already supports multi-bill allocations; this read model must represent them correctly without adding another payment workflow.
