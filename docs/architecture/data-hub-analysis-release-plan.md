# Governed analysis workflow release plan

## Candidate and scope

The candidate combines D4D5Z authenticated route proofs, governed field labels,
present-value count controls, worksheet navigation from import history,
saved-choice restoration, closed count-response and failure display contracts,
uncertain-save recovery and the disposable browser
journey. It builds on the merged D4D5Q–Y review/count services and
screen. It introduces no database migration, backfill, AI calls, generic
aggregate execution, grouping execution or access to uploaded cell values.

Labels are governed `source_schema_columns.source_header` metadata, selected
only for the authorized organisation, pinned worksheet and current profile's
field IDs. Planning reads labels and structural evidence in one RepeatableRead
transaction. Duplicate labels retain distinct column IDs; semantic controls
also show field position. Labels never authorize an operation.

Present counts are available only for MEASURE fields in the saved review
matching the loaded planning profile. The existing server recomputes review
readiness and validates capabilities again. Zero is present; missing values
are excluded. A quality hold blocks row and present counts. Returned results
display the actual server review revision and profile identity.

The pure response parser validates the result's closed shape, supported versions,
safe count/revision, ready plan and full lineage before display. Worksheet,
operation and selected measure must match the request. It preserves the actual
returned profile/revision and does not establish authorization or freshness.
Malformed or mismatched success responses clear the previous count and require
an explicit retry; the server remains responsible for capability evaluation.

Saving appends a revision, and has no idempotent replay contract. Any failed
save or reload after saving requires an explicit reload of the current review
before another save. This prevents a quick retry when the first response is
uncertain; it does not provide exactly-once delivery across tabs or clients.

Import history offers an explicit, bounded read through the existing
tenant-scoped persisted-worksheet listing API. It does not inspect the file
again or imply profile readiness. Worksheet names are distinguished by their
positions. Opening analysis still requires the current profile and review.
Reload restores only saved clarified meanings offered by that same profile;
an explicit quality preview restores matching valid decisions. Neither step
appends a revision. Changed meanings clear the saved decisions before preview.

## Release prerequisites — owner verification required

The existing D4D5Q migration is unchanged in this bundle. Its Git blob is
`cc7f948944b1f0bd772a140d33be901736c5ca26`, verified on main
`9af0a0d4356cd58082d6994280da102eccc1d5c9`. Verify that identity in the
approved candidate before installing it; do not substitute an unreviewed script.

1. Record the approved candidate commit, PR checks and target deployment.
   Main automatically deploys to Production; merging application changes is
   a release action. Obtain release authorization before merging this bundle.
2. Confirm the actual target database and deployed schema with the owner.
   Earlier handoffs asserted D4A through D4D1B2 Production installation; this
   bundle does not independently confirm those claims. Never infer schema
   installation from a successful application deployment.
3. Confirm the existing prerequisites: governed schema/worksheet/column and
   mapping tables, raw staging D4A/D4B, normalized staging D4C-B1, findings and
   completion gate D4C-B2B1, dataset profiles D4D1B1 and execution D4D1B2.
   Verify the exact functions, triggers, column types and lineage constraints
   against their pinned scripts. Resolve any drift before proceeding.
4. Record backup/restore readiness and the currently deployed application
   version. Rehearse the D4D5Q review migration in an isolated environment
   with the actual prerequisite schema before authorizing its target run.

## Ordered rollout

1. The owner installs the existing additive
   `scripts/create-datahub-analysis-reviews.sql` (D4D5Q) only after separate
   Production migration authorization. Use its explicit transaction and
   preconditions; do not use Prisma db push against Production.
2. Verify the review table, payload validators, revision/actor/lineage insertion
   guards, immutable history triggers and indexes. Do not create a review for
   a real customer merely to probe the schema. Existing data must be retained.
3. Merge/promote only the approved exact candidate after CI, security checks,
   build and isolated workflow validation pass. Confirm the deployed commit
   and deployment readiness. Do not assume a green preview proves Production.
4. With explicit test-data authority, run a scoped authenticated smoke journey:
   load a profiled worksheet; choose meanings; review quality; append and reload
   decisions; count rows and present values; verify returned lineage. Test
   missing/unauthorized access, holds and no-store responses. Use isolated
   synthetic data for denial, save-failure and stale-pin exercises.
5. Record the migration outcome, deployment commit, evidence, limitations and
   owner sign-off. Keep analysis unavailable if any prerequisite or guard fails.

## Rollback and recovery

If the application fails, restore the last approved deployment and stop use of
the new review/count workflow. Preserve the additive review table and all
append-only history. Do not drop tables, delete reviews, disable constraints,
rewrite historical decisions or reverse prerequisite migrations to roll back
the UI. Fix a wrong decision by appending an authorized new revision.

If migration verification fails, stop before application release. Retain the
transaction error and inspect the actual schema with the owner. The migration
is replayable in the disposable harness with populated history; replay in a
real target still requires owner approval and drift assessment. If a save's
response is uncertain, reload the latest review before deciding whether to
append a correction.

## Verification and limits

Workflow validation on predecessor `d271fc52` passed: 49 failure-contract/review-screen tests, all 64
disposable-Postgres integration tests, the built-app browser journey, TypeScript,
changed-file lint and diff checks. The wider 2,265-test suite encountered
timeouts in unchanged schema/database and repository-scanning tests; the two
affected files passed an isolated rerun (90/90), while a second wider run still
encountered scanning timeouts. No time limits or unrelated tests were changed.
The complete hosted CI remains a separate gate. The application build
passed with local build-only placeholders; the existing missing dashboard-copy
and middleware deprecation warnings remain. The browser reported no page
exceptions, verified mobile containment, and the outer harness successfully
reapplied D4D5Q with an unchanged digest of populated review history. The
disposable server and Docker container were removed.

Run `npx next build --webpack` with build-only local placeholders, then
`DATAHUB_BROWSER_PROOF=1 bash scripts/tests/verify-datahub-profile-execution.sh`.
The harness creates and removes its own loopback Docker Postgres instance,
applies the actual migration chain, runs the integration suite, seeds synthetic
profile evidence and starts the built Next application. Real form login,
cookies, session revalidation, APIs, Prisma and SQL constraints run unchanged.
Only Neon HTTP transport is adapted to local PostgreSQL. Browser checks cover
history-to-worksheet navigation, saved review persistence and choice restoration
without an automatic append, both counts, zero/null behavior, holds, stale pins,
denied access and timed-out save recovery. Evidence stays in ignored
`test-results/datahub-runtime`; disposable login credentials are removed.

Nine browser contract probes intentionally corrupt otherwise genuine count
responses, including invalid JSON and an unknown failure reference. They verify
failure clears previous results,
response contents are hidden, no extra request occurs during the observed
recovery interval and explicit genuine retries succeed without appending reviews.
These intercepted responses are separate from the unmodified baseline workflow;
they prove client handling of faults, not server production of those faults.

This does not certify the hosted Neon transport, Production migration status,
Production deployment, large-tenant load or the file-upload/normalization
journey preceding the already-profiled worksheet. Those remain separate
acceptance checks. The first owner action is to approve the exact release
candidate and verify target prerequisite/migration state.

The follow-on pure profile-target planner on `8234e716` distinguishes descriptive grouping
intent from supported profile statistics and rejects incompatible algorithm
versions before evidence evaluation. It adds no execution path or migration.
Its focused planning/evaluator/response/route and failure-reference suites pass
167 tests; TypeScript and changed-file lint pass. All 64 disposable PostgreSQL
service integration tests were rerun successfully through the target planner.
The workflow browser/build
evidence above belongs to `d271fc52`; those checks are not claimed as rerun by
the focused planner tests.

The catalog-admission bundle on `66a127a1` rejects inconsistent structural metadata before
planning or profile-statistics access. Its 188 focused catalog/planning/count/
response/route/failure-reference tests and all 64 rerun disposable PostgreSQL
service tests pass. It adds no execution path, migration or raw-value access.
The predecessor workflow browser evidence remains explicitly separate.

The closed-state admission bundle on `fc2fb967` rejects unknown reviewed-quality states
instead of defaulting ready. Direct capability derivation exposes an explicit
unavailable state with no capabilities for invalid readiness state/version or
catalog metadata, retaining genuine quality-hold semantics. All 240 focused
readiness/capability/planning/count/response/route/failure-reference tests and
64 rerun disposable PostgreSQL service tests pass, along with TypeScript,
changed-file lint and diff checks. This is pure admission hardening; no new
execution path or migration is added. Earlier browser evidence remains separate.

The dataset-scoped planning bundle on `787ce478` checks all eight lineage identities before
reading readiness, then returns a copied closed context with the supported
profile-target plan. It reads no statistics and grants no access or execution
authority. Its 265 focused planning/readiness/capability/count/response/route/
failure-reference tests and 64 rerun disposable PostgreSQL service tests pass,
as do TypeScript, changed-file lint and diff checks. Earlier browser/build
evidence is not claimed as rerun by these pure contract tests.

The review-derived planning bundle on `c687d175` composes trusted semantic/quality snapshots
and their revision into a scoped plan without caller-supplied readiness or
profile statistics. It does not certify persistence or freshness. All 290
focused contract/count/response/route tests and 64 rerun disposable PostgreSQL
service tests pass, along with TypeScript, changed-file lint and diff checks.
It adds no database/API/UI/AI execution or migration. Earlier workflow browser
evidence remains separate from these pure planning tests.

The bounded review-pinned planning bundle on `09600408` adds all-or-nothing composition for
1–20 profile-count intents against one supplied review revision. It preserves
request order and duplicates, checks revision equality before snapshot access,
and returns no partial plans when a request fails. Revision matching does not
prove persisted freshness or authorize execution. All 316 focused contract/
count/response/route tests pass. Disposable database and browser evidence above
belongs to the predecessor candidates; those flows are not rerun for this pure
contract addition. No database/API/UI/AI execution, migration or raw-value
access is added. The existing Production release hold remains in force.

The single-preparation bundle on `eaf03b21` captures the admitted revision and reads review
snapshots once per invocation, deriving common readiness before planning the
ordered requests. It avoids repeated semantic catalog construction without
adding a shared cache, persistent prepared state or execution. Regression
checks compare supported ready/notice/hold behavior with the single-request
planner and preserve early admission failures and indexed request denials.
All 324 focused contract/count/response/route tests pass, along with TypeScript,
changed-file lint and diff checks.
Earlier database/browser evidence remains separate; Production is untouched.

The fixed-admission bundle on `f7aa475a` captures a closed own-data envelope and bounded
request-list membership before review preparation. Caller list mutation cannot
expand or reorder admitted work. Envelope/entry accessors are rejected without
invocation; list holes retain indexed request denial. Individual payloads still
require governed planning. This adds no API/UI/database/AI execution or migration.
Earlier disposable database/browser evidence remains separate, and the existing
Production release hold remains in force.
All 351 focused contract/count/response/route tests pass, along with TypeScript,
changed-file lint and diff checks.

The detached-intent bundle on `09e04c9c` shares closed structural request parsing between
single-request capability validation and bundle admission. Valid scalar intents
are copied before review preparation, so source payload mutation cannot change
admitted work. Malformed payloads retain indexed rejection; reviewed holds and
unavailable capabilities retain their earlier precedence. Parsing grants no
capability or execution authority. No API/UI/database/AI execution or migration
is added, and earlier database/browser evidence remains separate.
All 376 focused contract/count/response/route tests pass, along with TypeScript,
changed-file lint and diff checks. The Production release hold remains in force.

The pure pipeline acceptance bundle on `802d2f3d` exercises actual metadata-derived semantic
and quality review through the review-pinned request planner rather than using
handwritten ready snapshots. Fourteen new cases cover notices, empty-profile
decisions, scope, invalid decisions, automatic flags, unsupported intents and
revision mismatch. It adds acceptance tests and architecture documentation;
the existing product contracts compose without a production-code change.
No evaluator, database/API/UI/AI execution or migration is added. Existing
browser/database evidence remains separate, and the release hold still applies.
All 404 focused review/pipeline/contract/count/response/route tests pass, along
with TypeScript, changed-file lint and diff checks.

The profile-target discovery bundle on `89f3ed1a` exposes versioned row-count and explicit
present-measure request templates from trusted review metadata. Scope, review
revision, quality and target-version/catalog admission precede discovery.
Templates round-trip through governed planning; the inventory retains every
measure while submitted bundles remain bounded at 20. General grouping and
generic aggregates are not advertised. Discovery grants no execution authority
and adds no DB/API/UI/AI execution, migration or raw-value access. Earlier
database/browser evidence remains separate and the release hold is unchanged.
All 430 focused discovery/review/pipeline/contract/count/response/route tests
pass, along with TypeScript, changed-file lint and diff checks.

The discovery-to-selection workflow bundle on `9f87d877` completes the pure v1 planning
phase: shared context/revision admission, closed bounded selections, governed
selected-field revalidation, safe failure references and cross-contract
acceptance. Maximum-size selections, copied metadata, revision changes, holds,
notices and no partial output are covered together. No new execution path,
migration or raw-value access is added. The full contract and phase exit are
documented in `data-hub-profile-planning-contract.md`; new integration/release
work remains separately scoped and the Production hold remains in force.
Local validation passes: 501 focused tests across 22 files, all 64 rerun
disposable PostgreSQL service integration tests, TypeScript, changed-file lint
and diff checks. The owned disposable container was removed. D4D5Q migration
content remains unchanged; Production was untouched. Earlier built-app browser
evidence is not claimed as rerun for this pure planning workflow bundle.

The planning exchange bundle adds closed catalog/selected-plan response and JSON
admission, exact full-context/revision/request matching, safe closed denials,
detached output, and complete pure pipeline round-trip coverage. Unexpected
statistics, diagnostics, versions and partial results are rejected without a
decoded subset. Existing count-response semantics are unchanged. The exchange
contract also records the complete authenticated integration acceptance package;
that package is not implemented here. No new DB/API/UI/AI/query execution,
migration or Production change is added. The release hold remains in force.
Local validation passes: 578 focused tests across 23 files, all 64 rerun
disposable PostgreSQL service tests, TypeScript, changed-file lint and diff
checks. The owned disposable container was removed and the D4D5Q migration
blob remains `cc7f948944b1f0bd772a140d33be901736c5ca26`. Earlier browser evidence
remains separate; this bundle did not rerun a built-app browser journey.

The subsequently authorized authenticated planning integration connects the
pure contracts to manager-scoped catalog GET and selected-plan POST endpoints
and explicit review-screen selection controls. Tenant identity is session-owned;
the existing RepeatableRead loader owns current profile/review metadata. Profile
and revision pins are independently compared, fields/holds are revalidated, and
request JSON is bounded by actual bytes. No new analytical query, count
execution, raw-value access, review append, AI or migration is introduced.
Failures clear prior choices/plans, pending work is canceled on replacement,
late replies are discarded, and planning never starts count/save actions.

Local integration acceptance passes 1,021 focused tests in 47 files, all 64
disposable PostgreSQL tests with new route assertions, TypeScript, changed-file
lint, an optimized build and a fresh built-app browser journey using real form
login and local PostgreSQL. Genuine planning produces selected descriptions,
locks sibling controls and preserves review history. Five intentional planning
reply-corruption probes clear prior plans with explicit genuine recovery;
existing review/count journeys and nine count probes also pass. Holds, stale
profile/revision pins, demotion, moved sessions and foreign tenant requests are
denied. The mobile planning screen fits, with no browser page exceptions.
The owned database was removed and the unchanged D4D5Q blob remains
`cc7f948944b1f0bd772a140d33be901736c5ca26`. The proof adapts only Neon HTTP
transport to local PostgreSQL and uses synthetic already-profiled worksheets;
hosted authenticated transport, ingestion and large-tenant load remain separate.
See [integration contract](data-hub-planning-integration.md). PR #419 remains
unmerged under the existing Production/D4D5Q owner-verification release hold.

The transport/recovery hardening bundle adds a browser-only one-MiB streamed
JSON/UTF-8 limit, a 15-second deadline covering headers/body, explicit cancel,
safe local feedback and cleanup of late response bodies. Deadline/cancel races
release controls even when a transport ignores abort. Responses are rejected
whole, with no truncated catalog or automatic retry/execution; very large
catalogs need a separately scoped pagination design. Wire-denial admission is
unchanged by the local timeout/cancel references.

Acceptance passes 1,140 focused tests in 51 files, all 64 disposable PostgreSQL
tests, TypeScript, changed-file lint, an optimized build and the fresh built-app
journey. Genuine delayed responses prove cancellation, timeout and navigation
recovery; keyboard selection/submission, mobile timeout feedback and seven
intentional planning corruption probes also pass. A real review append between
discovery/submission rejects the old selection, then explicit refresh plans the
new revision without another append. Original history survives unchanged.
Automated accessibility checks cover five states; screen-reader/color-contrast,
hosted authenticated transport, real ingestion and larger workloads remain
separate. Owned test resources are removed, D4D5Q is unchanged, and the existing
Production release hold still applies. Planning remains descriptions only.
