# LD Tennis → Scheduling integration

User-selected scope, 3 November 2026: **fully integrate Tennis sessions, bookings and attendance into Scheduling**, including the existing public Tennis booking flow. Combining menus is not completion. Organiser and Commercial payment authority remain unchanged.

## Current state and concurrent work

Baseline `e490f4ba` includes released #527 and capacity prerequisite #462. Production coaching continues to use Tennis tables until a separately approved cutover. This branch supplies the canonical screens, guarded operations, public handover and staged migration commands below.

Reconciled against the remote branches on 3 November:

- `docs/scheduling-037-completion-record` / #528: production availability-version receipt.
- `docs/scheduling-2c3-facility-hire-design` at `512d8223`: proposed guarded staff hire writes, explicitly excludes classes and LD Tennis. Reuse its lock/version/idempotency design where applicable; do not duplicate or implement its independent hire scope here.
- `feat/scheduling-041-range-indexes`: independent read-performance migration. Do not allocate its migration number or change it here.

New integration work stays on `feat/ld-tennis-scheduling-integration`. No production migration, cutover or new release is authorized by the scope selection alone. The earlier release authorization applied to #527.

## Implemented: source compatibility assessment

`lib/scheduling/compatibility/tennis/migrationSnapshot.ts` reads an explicit projection in one PostgreSQL statement, with independent tenant filters on sessions, instances, bookings and pauses. Broken relationships stay visible; inner joins must not silently discard historical rows. It accepts an injected executor, imports no database client, and is not reachable from a route. Only an ACTIVE `ld-tennis` organisation with Scheduling settings is accepted. Missing configuration and malformed stored fields fail instead of returning an empty ledger.

`migrationAssessment.ts` checks projected recurrence, prices, dates, timezones, tenant/parent relationships, capacity, duplicate live places, lineage and pauses. Diagnostics contain record ids and fixed codes, never customer snapshots. The sorted projection fingerprint detects changes to these selected fields independent of query row order. **It is not a full-source backup checksum, an import plan or a cutover token.** Fields outside the projection are not fingerprinted. `cutoverReady` is always false.

Important semantics found in source:

- Tennis's UI stores `attending` for “Here”; Scheduling uses `attended`. The mapping is explicit. Unknown values are refused.
- A paid marker is a historical coaching marker, not a Commercial payment. Preserve it without issuing an invoice, sending an email or recording a money transfer.
- Legacy bookings have no cancellation-event timestamp and no immutable historical price snapshot. Do not fabricate either from the migration time/current template price. The eventual provenance schema/UI must retain “unknown” explicitly.
- A pause can legitimately leave protected paid/attended bookings live. Surface the conflict; do not cancel those bookings during import.
- A location string is not a court reservation. Import resource-free classes unless an explicit, verified resource mapping exists. Never infer a court or acquire holds from a venue label.
- A recurring group is explicit lineage. Different names/emails or sessions inside it require review, not automatic identity merging. Squad and CRM identities stay distinct.
- Legacy bookings with no dated occurrence require classification; do not create a guessed occurrence or silently omit them.

## Completed local implementation - 4 November 2026

Loading code or a screen never installs schema, imports history, enables modules or activates cutover. Organiser and Commercial payment authority stay unchanged.

### Roster screens

`/scheduling/coaching` provides paginated class dates and rosters, once/weekly enrolment, attendance, manual paid markers, cancellation, once-to-weekly, pause/resume and stopping future weekly places. Failed refreshes hide customer rows and disable changes. Uncertain writes retain a request key across remounts and recover using a read-only GET; they never resend automatically. Missing receipts do not prove failure. Cancellation recovery proves terminal state rather than which browser performed the cancellation.

The central gate enforces role and managed user access: view-only Scheduling access cannot read a roster GET. Tenant/actor come only from the session. Strict request contracts, same-origin mutation checks and individually allowlisted database adapters preserve containment. Operator migration services remain unreachable from routes.

The Tennis schedule detail generates dates with shared timezone/DST rules and exact configuration tokens. It retains the inclusive day-70 horizon, reports nonexistent DST times and never revives cancelled slots. Archive cancels eligible future places while preserving paid/attended/protected places. Restore creates a new offering and explicit replacement-series lineage; original bookings, cancellations, attendance and paid markers remain intact. Active groups and pauses carry forward; ended groups do not. Protected future dates stay on the original class and are excluded from subsequent generation. Resource/availability settings added after import require review: automatic restoration refuses them rather than inventing resource holds.

The old business coaching page redirects after handover and its transport refuses old writes. The source-table database fence also protects old administrative endpoints and in-flight requests. The business overview reads canonical session counts. Other old source administrative views may still display retained history; they are not another writer authority.

### Public booking handover

Existing public booking URLs follow the fixed LD Tennis organisation's phase: legacy uses its existing path, frozen reports unavailable, active uses Scheduling. Requests cannot choose a tenant or read customer rosters. Organisation/module entitlement is checked for new canonical bookings. A booking, client pipeline item, pipeline message and immutable receipt commit together. Shared capacity/uniqueness guards prevent overbooking; a pipeline error rolls back the place. Ambiguous responses recover by random key without another POST; changed payloads cannot reuse a key. Availability failures are explicit, never a successful empty calendar.

`/api/tennis/cancel` remains lead-token cancellation and `/subscribe` remains newsletter signup; neither is a booking cancellation API. Historical paid markers do not create Commercial payments.

### History and staged cutover

The assessment is only preflight. The actual immutable archive captures complete JSON rows from all five source tables plus timezone/currency, with a full-source manifest. Import preserves explicit IDs and lineage and rejects target collisions. Cancelled source bookings remain archived because their cancellation-event times are unknown. Historical prices remain null with guarded provenance, never current prices or zero.

Install staged host files in this order, after shared Scheduling schema/integrity prerequisites:

1. `tennis-coaching-operations.sql`
2. `tennis-history-cutover.sql`
3. `tennis-canonical-import.sql`
4. `tennis-class-restoration.sql`
5. `tennis-public-booking.sql`
6. `tennis-activate-cutover.sql`

Installation alone changes no writer authority. The operator prepares the barrier, freezes/drains source writers, reviews the full source manifest, captures/imports with matching timezone/currency, verifies target evidence and explicitly activates Scheduling. The executable synthetic sequence is in `scripts/tests/helpers/tennisSchedulingLocal.mjs`; it must never be pointed at production or used as a source of production hashes.

Both writers hold the cutover lock through commit. Freeze drains complete transactions before recording the target manifest. Initial activation must match the import. Returning to legacy before target writes requires unchanged source and the original target manifest. After target changes, legacy rollback is refused: freeze/resume is supported, but reverse data migration is not implemented. Reconciliation would need a separately reviewed plan. Immutable transition receipts retain the note and hashes; source tables are never dropped.

## Verification and release limits

- Disposable PostgreSQL 16 and 17: 108 checks each (38 projection, five projection SQL, 36 booking/command, eight history, 21 import/public/cutover/restore). Owned databases were removed.
- 309 focused component, route, access and containment checks pass.
- Full development app: actual local login, old-page handover, roster/history, weekly enrolment lost response/remount recovery, attendance, once-to-weekly/pause/resume, public booking lost response/remount recovery, final-place refusal, atomic pipeline handover, rendered archive/restore, freeze/resume, unsafe rollback refusal and permission/module revocation pass.
- Final production-mode replay and broader regression results are recorded below when complete. An initial production build caught a TypeScript narrowing issue in a weekly-control callback; the component now captures the roster value before rendering callbacks.
- Accounts/data/services are synthetic and disposable; external providers are blocked. This is actual Next/login/HTTP/Postgres proof, not live customer/provider acceptance.
- Resource-configured restoration is deliberately refused for review. Reverse migration after target writes, every interleaving and all possible historical production anomalies are not certified.
- Hosted installation, fresh live assessment/import/cutover, merge/deployment and production verification remain a separate approval checkpoint. #527 approval does not authorise this new cutover.
