# Coaching roster layout and reviewed invoice handoff

## Scope

The Coaching roster groups sessions by local date and sorts them by time. Cards show the class, time, places and status; selection is exposed with `aria-pressed` and native keyboard activation. Wide screens show the selected roster beside the agenda; narrow screens stack them without horizontal overflow. Existing previous/upcoming ranges, pagination, history, attendance, weekly enrolment and uncertain-write recovery remain authoritative.

An eligible roster row has **Review for invoicing**. It opens the existing Commercial new-invoice workflow with opaque occurrence/booking identifiers and the current roster cursor. No names, email addresses, prices or customer IDs are carried in the URL. The preparation panel re-reads the existing authenticated, tenant-bound Scheduling roster endpoint. Denied, missing, cancelled or history-only bookings do not produce a reference. The Commercial page and mutation APIs retain their own independent access controls.

The user can explicitly copy the booking reference into editable internal invoice notes. The billing customer is never inferred from player name or email. A recorded price is labelled as a booking snapshot requiring tax review; missing historical prices stay unknown. The existing invoice workflow creates a draft header first, then requires line items and review before issue. The preparation read does not create any invoice, issue an invoice, record a payment or change a booking.

## Deliberate limits

This is a reviewed handoff, not an automatic billing integration. Notes are not a durable booking-to-invoice ledger, do not prevent duplicate manual invoicing, and do not update when a booking changes. The panel directs the operator to check existing invoices. It does not transfer the Tennis paid marker into Commercial or claim bank settlement, revenue or tax correctness. Automatic line creation, multi-booking billing, authoritative invoice/payment status on each booking and database-enforced duplicate prevention require a separately designed persistent relationship and financial acceptance tests.

No database migration, hosted configuration change or production data mutation is part of this bundle.

## Verification

- Component checks cover chronological grouping, keyboard selection, lost-response recovery, revoked reads, previous/upcoming navigation, explicit notes transfer, current-page cursor handling and denied/cancelled/missing/history/unknown-price preparation.
- `node scripts/tests/verify-hr-full-local.mjs --tennis-scheduling` exercises real local login, actual HTTP routes and disposable Postgres. It checks the reviewed invoice handoff leaves the payer unselected and creates zero invoices, then runs roster, public booking, recovery, archive/restore and entitlement-denial flows.
- With `TENNIS_LAYOUT_SCREENSHOTS=1`, that runner captures synthetic layouts at 390, 768 and 1440 pixels and checks document overflow. It never uses live customer records or live providers.
- Optimized build, TypeScript, lint and exact-head hosted checks are release gates. Preview success is not production verification; this bundle awaits separate release authorization.
