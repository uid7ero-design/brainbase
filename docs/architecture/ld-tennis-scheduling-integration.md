# LD Tennis → Scheduling integration

User-selected scope, 3 November 2026: **fully integrate Tennis sessions, bookings and attendance into Scheduling**, including the existing public Tennis booking flow. Combining menus is not completion. Organiser and Commercial payment authority remain unchanged.

## Current state and concurrent work

Baseline `e490f4ba` includes released #527 and capacity prerequisite #462. Existing working coaching operations still use Tennis tables. Scheduling has configuration, availability, range reads, repositories, occurrence/series planners and database integrity; it has no operational coaching write routes or UI yet.

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

## Remaining implementation in this one acceptance bundle

### Local import, recurrence and recovery checkpoint

`coachingBookings.ts` implements canonical staff enrolment, cancellation and attendance with injected SQL, tenant/permission checks and bounded inputs. Enrolment snapshots the current offering price and occurrence window in the insert statement, retains shared Scheduling integrity triggers, compares replay payloads, and recovers a committed-but-lost response by key without another insert. A cancelled booking is never revived by replay. Cancellation locks the booking before reading its current manual paid marker. Attendance uses an expected revision and an immutable command receipt: a lost response is read back, an old command does not overwrite a newer correction, and concurrent corrections cannot silently win over each other. These helpers are not connected to production routes yet.

`tennis-coaching-operations.sql` and `coachingCommands.ts` implement bounded weekly filling, pause/resume, Once-to-Weekly, Weekly-to-Once and manual paid markers. Commands are atomic and retain exact request/result receipts. They preserve paid/attended places, report full dates and pauses, and never revive cancelled bookings. Once-to-Weekly creates explicit lineage without changing the original booking snapshot; resuming creates new future bookings and retains the removed pause in command history. Marker writes have independent expected versions and do not change Commercial payment state. SQL errors during receipt persistence roll back the complete command. No command runs merely by installing the script.

`scripts/scheduling/tennis-history-cutover.sql` is staged only. It installs a tenant-pinned preparation barrier, drains existing source writers before preparation, freezes all five source tables, captures their complete JSON rows with a full-source checksum including timezone/currency, and prevents archive changes. A frozen source can be reopened only before capture. Activation of the Scheduling writer remains unavailable until route acceptance and rollback are implemented. Installing this file does not prepare or freeze an organisation. No hosted database has received it.

`tennis-canonical-import.sql` and `importHistory.ts` import captured offerings, dated occurrences, explicit groups, pauses and noncancelled bookings in one transaction. Source IDs are preserved; collisions refuse the entire import. Cancelled bookings remain complete in the immutable archive because their original cancellation-event time is unknown. Original prices are explicitly null, not zero or today's price. A deferred database guard permits null only with matching captured provenance. Ordinary new bookings still require a quote. Original paid markers are copied separately from payment status. Protected bookings within a pause are preserved with an explicit warning; unprotected conflicts still refuse import. Import receipts pin source and target manifests; replay must match both. Both ledgers remain frozen afterwards.

`coachingHistory.ts` provides bounded, stable, tenant-scoped staff paging of receipted history and a combined per-occurrence roster. Canonical bookings and cancelled source history are joined by explicit source identity, not names/emails. The roster exposes selected fields, unknown prices/cancellation times, current attendance/marker revisions and whether a row is history-only. Viewer/public actors cannot read customer history. Missing capture/import is distinct from an empty roster. The rendered history screen is still pending.

Current disposable proof: 38 projection checks, five actual projection SQL checks, 28 canonical booking/command SQL checks, eight full-history checks and 13 import/roster checks (92 total). These cover lost responses, competing attendance edits, a paid-marker commit while pause waits on its booking lock, concurrent fill/pause, terminal receipt rollback, source/target freeze, configuration drift, collisions, tenant denial, exact import replay and unknown-price provenance. The runner removes its owned databases; no supplied or hosted connection is accepted. These are database/service checks, not new canonical browser/HTTP acceptance. Latest main (`9f3d2fe9`) was reconciled without changing unrelated work.

The broader core + Phase 1/2A/2B.0 containment and projection run passes 1,346 checks (overlapping the projection checks above). The staged host SQL is pinned outside the internal-test-only folder. The five injected SQL services are named individually in containment; application imports/database-driver imports remain forbidden for this rehearsal stage.

The worktree initially had Next 16.2.4 installed although package/lock pin 16.4.3. That build was stopped and not counted. A clean locked install restored 16.4.3 without changing package files. The isolated production build and existing full local Tennis business regression then passed: real local login, CRM/billing links, Commercial transitions, existing Tennis enrolment and rendered attendance recovery, current revocation, tenant denial and responsive layout. Owned services were removed. This regression uses the existing legacy Tennis transport; it does not prove the new canonical transport, which is not wired yet. The build reported the existing missing `Dashboards/command-centre.html` copy warning but completed successfully.

Next implementation remains class generation/edit/archive/restore, atomic initial weekly enrolment, staff/public HTTP and rendered flows, and cutover/rollback. In particular, shared occurrence snapshots and cancelled slots are immutable: class restoration needs explicit replacement lineage, not silent revival. Do not represent this checkpoint as the full requested integration or as release-ready.

1. **Canonical coaching operations.** Build occurrence generation, class management, enrolment, Once/Weekly changes, pause/resume, cancellation, attendance and marker updates over the existing shared repositories and guards. Every multi-row mutation must be one transaction/statement; tenant isolation, headcount and resource integrity remain database-enforced. Use stable idempotency keys and explicit lost-response recovery. Existing protected-history semantics must survive.
2. **History and import.** Add a host-specific source-id/provenance ledger, reviewed schema and deterministic import. Include all source fields, names, notes, original timestamps, types/colours, exceptions, lineage, pauses and cancellation/paid/attendance history. Preserve unknown source facts as unknown. Snapshot/fingerprint every imported field, reject target collisions, make repeat rehearsal idempotent and verify row-by-row equivalence. Do not use this assessment's limited projection as the backup/import payload.
3. **One writer during cutover.** Inventory and fence every old writer: public book/cancel/subscribe, dashboard enrolments, session reconciliation/generation/archive/restore, old admin/session routes, generic booking/portal transitions and lead-to-Squad conversion. A UI flag alone cannot stop an in-flight request. Prove a database-level freeze/drain barrier before final snapshot/import; thereafter old requests must route to the new authority or refuse, never silently write the old ledger.
4. **Staff experience.** Scheduling hosts the actual coaching timetable and roster. Old URLs become scoped compatibility entry points/redirects into the same authority. Preserve deep links and stable public identifiers with explicit mappings. Integrate the business overview and remove the compatibility warning only after actual cutover.
5. **Public compatibility.** Existing public session list, booking and cancellation flow continue with the same tenant authority and expected contracts, but write Scheduling only. Preserve rate limits, entitlement checks, denial and no duplicate booking on lost responses. No generic cross-tenant public Scheduling API is implied.
6. **Release acceptance.** Full synthetic browser → actual HTTP → disposable PostgreSQL checks for all staff/public paths, roles/revocation, cancellation/recurrence history, concurrent final-place bookings, DST, lost responses and migration retries; production build/TypeScript/lint; exact-head CI/security/preview. Rehearse target schema, cutover and rollback on isolated services before requesting the live migration/release approval.

## Rollback requirements

Before new writes, rollback can restore the old routing only after verifying source remains frozen/unchanged and no target-only records exist. After new Scheduling writes, simply flipping back would lose bookings: rollback must freeze both paths and reconcile/replay target changes with explicit identity maps and counts. Keep the source archive and provenance until that reversal is demonstrated. Never drop old tables as a shortcut.

## Evidence and limits

- Projection SQL runs inside `BEGIN READ ONLY`; operational and import suites use the actual shared Scheduling schema plus synthetic minimal source tables in disposable PostgreSQL.
- Command/import evidence proves local database behavior. The existing full-app regression proves the legacy workflow remains functional, not the new Scheduling UI or public compatibility.
- No real provider/login acceptance is claimed from local synthetic identities. The new canonical route/browser, cutover activation and rollback proof remain outstanding.
- No production records, module settings, tables, routes or deployments have been changed by this integration branch.
