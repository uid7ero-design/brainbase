# 0002 — Money & Currency Standard

Status: Accepted (Phase C1.5, Foundation Repair)

## 1. Context

The Phase C0/C0-R Commercial Suite audit found four incompatible money
storage conventions coexisting across this codebase, none formally
declared as a standard anywhere:

- Prisma `Float` — the oldest and still-dominant convention in the
  waste-ops vertical (`DebtorAccount.outstanding_amount`/`original_amount`/
  `last_payment_amount`, `Contract.value`, `SessionType.price_per_session`).
  Imprecise: binary floating point cannot represent every decimal currency
  value exactly, and repeated arithmetic accumulates rounding error.
- Prisma `Decimal @db.Decimal(10,2)` — used only in the Founder OS
  vertical (`DeploymentProposal.monthly_recurring`/`one_time_cost`,
  `ManagedService.monthly_value`). Precise, but a second, independently-
  chosen convention from the one above.
- Bare, unscaled raw-SQL `NUMERIC` — ad hoc tables created via
  `app/api/admin/migrate/route.ts` (a large legacy "run everything"
  script; see that route's own now-confirmed-broken `modules` INSERT,
  evidence it predates and was never reconciled with later schema
  changes).
- Untyped JSON — `FinancialModel.line_items`/`rise_and_fall` embed money
  inside a `Json` column, unqueryable and untyped at the SQL level.

Since the C0 snapshot, a fifth, new pattern appeared: the Events/Stripe
Phase 4 payments module (`event_ticket_types.price_cents`,
`event_orders.total_cents`, `event_order_items.unit_price_cents` — all
`INTEGER NOT NULL DEFAULT 0 CHECK (... >= 0)`, each paired with an
explicit `currency TEXT NOT NULL DEFAULT 'AUD'` column). This is the
first integer-minor-unit money storage anywhere in this codebase, and —
per the C0-R reconciliation's own finding — the best-designed of the
five: it is what Stripe's own API natively operates in (Stripe's
`amount` fields are always integer minor units), it side-steps binary-
float rounding error entirely, and every price is paired with an
explicit currency rather than assuming one implicitly.

No ADR or other document previously declared any of these five patterns
as the house standard. This ADR does that, for **new** commercial-suite
structures only.

## 2. Decision

**New commercial-suite tables (Sales, Quotes, Invoicing, Purchasing,
Expenses, Budgeting, Finance Intelligence, and any other structure built
in C2 or later) MUST store every monetary value as an integer count of
the currency's smallest unit ("minor units" — cents for AUD/USD, pence
for GBP, etc.), paired with an explicit currency column, following the
pattern already proven in `scripts/create-events.sql` /
`scripts/create-events-phase2.sql` / `scripts/add-events-payments.sql`.**

This ADR does not migrate any existing `Float`/`Decimal`/bare-`NUMERIC`/
JSON money field. Those verticals are unaffected and out of scope for
Phase C1 (see the C1 brief's explicit "no migration of legacy money
fields" instruction). This is a standard for what gets built *next*, not
a retrofit.

## 3. Naming convention

Column name suffix `_cents`, matching the Events precedent exactly:
`amount_cents`, `unit_price_cents`, `total_cents`, `tax_cents`,
`subtotal_cents`, `discount_cents`, etc. Never a bare `amount`/`price`/
`total` for a minor-unit integer column — the suffix is load-bearing
documentation, not decoration: it is the only signal, at the column-name
level, that a raw integer read from this column is not itself a dollar
value.

## 4. Currency representation

Every table with at least one `*_cents` column carries its own
`currency TEXT NOT NULL DEFAULT 'AUD'` column (ISO 4217 three-letter
code), scoped per-row — never a single implicit currency assumed
platform-wide, and never a currency column shared/joined in from a
different table for a value that could legitimately differ per row (a
quote line item's currency must be stored on the line item, even if every
existing row happens to be `'AUD'` today). This matches
`event_ticket_types.currency`/`event_orders.currency`'s existing,
row-scoped placement — not a single currency setting on `organisations`.

`DEFAULT 'AUD'` is a convenience default for this Australian-first
platform, not a hard-coded assumption: application code must always read
and use the row's actual `currency` value, never assume `'AUD'` in a
calculation or display path. A future multi-currency organisation is not
precluded by this schema shape — only by application code that ignores
the column and hard-codes the symbol/rate.

## 5. Tax / GST representation

No existing table anywhere in this codebase represents tax/GST as a
first-class concept — this is new ground, not a convention to inherit.
For Phase C1.5's purposes (a standard for *storage*, not a tax-calculation
engine, which remains explicitly out of scope per the Commercial Suite
brief's Section 4/12 boundaries):

- A tax amount, where one exists on a row (e.g. an invoice line item), is
  its own `*_cents` integer column (e.g. `tax_cents`), computed and
  stored at the time the row is created/finalized — never derived on the
  fly from a floating-point rate multiplication at read time.
- A tax **rate** (e.g. "10% GST") is a `NUMERIC(5,2)` percentage
  (0.00–100.00, two decimal places — sufficient precision for any
  currently-plausible GST/VAT/sales-tax rate; `NUMERIC`, not `Float`,
  because a rate is compared and stored exactly, not accumulated over
  many operations) stored alongside the row it applies to at the time of
  calculation — a rate change in configuration must never silently alter
  the tax amount on an already-issued document (see Section 8,
  snapshotting).
- Whether tax-inclusive or tax-exclusive pricing is used is an explicit
  boolean or enum column on the record it applies to (e.g.
  `quote_line_items.tax_inclusive BOOLEAN`), never inferred from context.
  BrainBase is Australian-first (GST-inclusive retail pricing is the
  cultural default in Australia), but this column must exist explicitly
  rather than assuming GST-inclusive silently everywhere — a future
  wholesale/B2B or multi-jurisdiction context may need tax-exclusive
  pricing on the same tables.

## 6. Percentage / rate precision

Any non-tax percentage/rate field (a discount rate, a commission rate, a
probability-of-close percentage) uses `NUMERIC(5,2)` (0.00–100.00),
matching Section 5's tax-rate choice — never `Float`, for the same
exact-comparison/no-accumulated-drift reason.

## 7. When integer minor units are insufficient

Two known cases where a plain `*_cents INTEGER` is not enough, to decide
explicitly if/when they arise rather than silently working around them
later:

- **Sub-cent precision** (e.g. a per-unit price computed by dividing a
  bulk cost across many units, producing a fractional cent). If a future
  commercial structure genuinely needs this, the column should be
  `NUMERIC` with an explicit scale (e.g. `NUMERIC(19,4)`, matching a
  common accounting-software convention of four decimal places), not a
  wider integer with an implied, undocumented sub-unit. No table
  currently needs this — noted here so a future author does not have to
  rediscover the tradeoff from scratch.
- **Currency amounts exceeding JavaScript's safe integer range**
  (`Number.MAX_SAFE_INTEGER`, ~9×10¹⁵) — effectively unreachable for any
  plausible single invoice/quote/PO line, but a running total/rollup
  across a very large dataset could theoretically approach it over a long
  enough horizon. If ever a real concern, the column stays a Postgres
  `BIGINT` (already the practical ceiling `INTEGER` cents columns should
  be widened to, if a future review finds `INTEGER`'s ~21.4 million
  ceiling — $21.4M in whole dollars — too low for a specific
  high-value use case); this ADR does not pre-emptively widen every
  column to `BIGINT` without evidence a specific commercial structure
  needs it.

## 8. Rounding boundaries, calculation rules, and snapshots

- All monetary arithmetic on stored values happens in integer minor
  units — sum, subtract, multiply-by-quantity — never by converting to a
  float dollar amount mid-calculation. A unit price × an integer quantity
  is exact integer arithmetic; a percentage-rate calculation (tax,
  discount) that would produce a fractional cent must round
  half-up to the nearest whole cent at the point of calculation, and that
  rounded, stored value — never a value re-derived from the rate at
  read time — becomes the row's `*_cents` value.
- **Snapshots**: a commercial document that has been sent/issued/finalized
  (a sent quote, an issued invoice) must store its own price/tax/customer-
  detail snapshot at the row level, independent of the live
  product/customer record it originated from — this is a Section 18 (C0
  audit numbering) concern, not new to this ADR, but directly touches
  money: a `*_cents` value on a sent quote line item must never
  silently change because the underlying product catalogue's price
  changed after the quote was sent. The line item's own stored
  `unit_price_cents` (not a live join to a catalogue price) is the
  document's fact of record.

## 9. API serialisation

A `*_cents` column is serialised over the API/JSON boundary as a plain
integer (e.g. `"total_cents": 12345`), never as a formatted string
(`"$123.45"`) and never divided down to a float dollar amount
server-side before sending (that would reintroduce exactly the float-
precision risk Section 2 exists to avoid, just moved one layer later).
Formatting to a display string is a frontend-only concern (Section 10).

## 10. Frontend formatting

Dollar-formatted display strings are computed only in the browser, from
the integer `*_cents` value and its paired `currency`, using
`Intl.NumberFormat` (already available in this codebase's runtime target;
no new dependency required) rather than hand-rolled string math — e.g.
`new Intl.NumberFormat('en-AU', { style: 'currency', currency: row.currency }).format(row.total_cents / 100)`.
The division by 100 (or the currency's actual minor-unit exponent — see
`Intl.NumberFormat`'s own currency-aware `minimumFractionDigits`/
`maximumFractionDigits` for currencies that are not 2-decimal, e.g. JPY)
happens only at this final display step, never earlier in a calculation
chain.

## 11. Stripe compatibility

This standard is deliberately identical in shape to what Stripe's own API
already requires (`amount` in minor units, a paired three-letter
`currency`) — a future Invoicing "record payment" phase that reuses the
Events module's Stripe Connect per-organisation onboarding
(`lib/events/stripeConnect.ts`, per the C0-R reconciliation's own
recommendation) can pass a `*_cents` value directly to Stripe's Checkout/
PaymentIntent APIs with no unit conversion at the integration boundary —
one of the concrete reasons this convention was chosen over the
alternatives, not merely "it happened to be what Events used."

## 12. Future Xero/MYOB/QuickBooks integration implications

Per the C0-R audit (Section U/M), no accounting-platform integration
exists or is planned in the near term — BrainBase remains an operational/
commercial platform, not the statutory ledger. Noted here only as a
forward-compatibility observation, not a commitment: Xero's and
QuickBooks' own public APIs also represent monetary line-item amounts as
decimal values with an explicit currency, and MYOB's AccountRight API
uses decimal amounts with a separate `TaxCode`/rate — none of the three
require or prefer integer minor units at their own API boundary the way
Stripe does. A future accounting-sync integration would convert this
standard's `*_cents` values to whichever decimal/string shape that
specific provider's API expects at the sync boundary (following the
`external_system`/`external_id`/`sync_status` field pattern the C0-R
report already recommends for that future integration identity), not by
changing how BrainBase itself stores money internally.

## 13. Prohibition on floating-point arithmetic for persisted financial totals

No persisted `*_cents` (or future `NUMERIC` tax-rate/rounding) value may
ever be the direct output of a JavaScript floating-point arithmetic
expression performed on a float-typed intermediate value (e.g.
`price * 1.1` where `price` was first divided down to a dollar float).
Every calculation that produces a value destined for a `*_cents` column
must be performed in integer minor-unit arithmetic end-to-end, with
explicit, documented rounding only at points where a percentage/rate
calculation genuinely requires it (Section 8). This is the single
non-negotiable rule this ADR exists to establish; everything else in this
document is elaboration on how to satisfy it consistently.

## 14. What this ADR does not do

- Does not migrate any existing `Float`/`Decimal(10,2)`/bare-`NUMERIC`/
  JSON money column — explicitly out of scope for Phase C1.
- Does not add any new database table — Phase C1 adds no commercial
  tables (see the C1 brief's out-of-scope list).
- Does not implement tax calculation logic — Section 5 defines storage
  shape only, not a calculation engine.
- Does not commit to multi-currency support as a product feature — it
  keeps the schema shape from precluding it, which is a materially
  smaller commitment.
