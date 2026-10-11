# D4D5Q review persistence foundation

`scripts/create-datahub-analysis-reviews.sql` follows D4D1B2. It creates
append-only explicit decision records for the upload's authoritative successful
v1 profile. No records are backfilled and no readiness state is stored.

Each profile has sequential revisions. Inserts lock the profile, upload and
reviewer until commit. The database requires an active same-organization
manager, administrator or super administrator at insertion. This checks actor
eligibility; it does not authenticate an HTTP caller. The future save service
must obtain the actor from the session and recompute the actual semantic and
quality resolutions before saving. Shape-valid incomplete decisions cannot be
treated as an approved review.

Reviewer IDs are immutable historical snapshots, deliberately without a live
user foreign key. Account deletion preserves attribution; the deleted account
cannot insert another review. Review timestamps are supplied by the database.
Updates, deletes and truncation are blocked. Corrections append a revision.

The migration is tested through the disposable local Postgres harness,
including reapplication with populated history. It is prepared in GitHub only;
it has not been applied to Production. Prisma mirrors the table, while SQL
owns its payload and lifecycle checks. The v1 record version binds the current
v1 profiler, semantic and quality algorithms; future algorithm changes need
an explicit record-version compatibility decision.

D4D5S adds `loadAnalysisReview` for an already-authorized organization/upload
scope. It loads structural profile evidence and the latest matching review in
one RepeatableRead transaction, validates the stored decision format and
recomputes semantic and quality resolution. Missing, invalid or incomplete
latest decisions cannot fall back to an older review. No readiness state is
read from storage. The returned revision identifies the snapshot used; it is
not a guarantee that upload pointers stay current after the transaction.
This remains an internal read service; session authorization and review saving
are separate work. The review migration must be installed before using it.

D4D5T adds the internal `saveAnalysisReview` service. A trusted caller must
derive organization and actor from the authenticated session and authorize the
upload. The decision body cannot supply either identity. The service checks
active same-organization reviewer eligibility, loads authoritative profile
evidence, compares the freshness pin and recomputes full review resolution
before appending a database-controlled revision. HOLD decisions are valid
reviews and remain holds when loaded. No derived readiness is persisted.
Serializable transactions and the existing SQL insertion guards prevent
concurrent revisions or pointer changes from producing an invalid commit.
Conflicts return REVIEW_SAVE_FAILED; no automatic retry is performed. A client
retry is a new append operation, not an idempotent replay. HTTP/session wiring
and conflict UX remain follow-up work. Production migration status is unchanged.

D4D5U exposes GET/POST `/api/data-hub/worksheets/[id]/analysis-review`
using the existing Data Hub manager role boundary. Organization and reviewer
come from the database-backed session; the path selects the upload inside that
organization. GET returns recomputed snapshots and their review revision;
POST accepts the closed decision body and returns the appended revision with
201. Responses are private/no-store. Missing records return 404, stale profile
conditions 409, invalid review resolutions 422 and persistence/read failures
503. Error responses project only the closed code, without detailed evidence
or exception text. No automatic POST retry is safe to assume. The review SQL
migration must be installed before using these endpoints; it is not applied
by deployment of this route. Browser review workflow remains follow-up work.

D4D5V adds `analyzeReviewedUploadCount`, an internal already-authorized read
service. It accepts only scope and the closed analysis request, loads the
latest saved review and profile counts in one RepeatableRead transaction,
and returns the review revision with the result. Caller-created semantic or
quality snapshots are not accepted. Results describe that transaction's
snapshot, not later review or pointer changes. The count HTTP endpoint remains
follow-up work.

D4D5W adds POST `/api/data-hub/worksheets/[id]/analysis-count`, a read-only
count evaluation endpoint under the existing manager boundary. The body is
the closed v1 analysis request; organization comes only from the session.
Success returns the count result, pinned lineage and review revision with
200. All responses are private/no-store. Invalid requests return 400, missing
upload/review 404, stale lineage 409, held or unsupported analysis 422, and
unavailable evaluation 503. No new profile/review writes occur. Browser
workflow and full deployed end-to-end verification remain required.

D4D5X adds manager GET/POST `analysis-review/plan`. GET discovers candidate
roles and clarification requirements from the authoritative profile. POST
previews semantic choices using the closed v1 review envelope, with an empty
quality-decision list and the current profile pin. Actual candidate membership
is resolved before quality questions are returned. Neither method saves a
review or asserts readiness. This supplies the two-phase browser workflow:
choose meanings, preview quality questions, then submit explicit review
decisions to the existing save endpoint. The browser screen remains to be built.
# D4D5Y — worksheet review and row-count screen

Managers can open `/data-hub/analysis/[uploadId]` from the worksheet inventory.
Loading is explicit and reads the current planning endpoint and saved review.
Field choices are restricted to server candidates. Quality planning, saving and
counting are explicit actions; no save is automatically retried. Changing a
choice clears quality planning and prior results. The saved review is reloaded
after insertion, and holds disable row counts. Count results display the server
review revision and profile identity, even if they advanced since the screen load.

This slice provides row counts only. Present-value count controls, friendly
governed field labels, authenticated browser-to-database verification and the
Production migration/deployment sequence remain outstanding. The prepared
analysis-review migration has not been applied to Production by this work.

## D4D5Z — authenticated route-to-database proof

The disposable Postgres harness now runs signed-session planning, review save,
review reload, row count and present-value count through the actual route
handlers. JWT verification, session user revalidation, role checks, review
engines, Prisma and SQL triggers run unchanged. The harness supplies the Next
cookie adapter and adapts the Neon SQL transport to local Postgres. It verifies
missing/tampered sessions, demotion, inactivity, moved accounts, foreign
worksheets and stale profile pins, including no unauthorized review insertion.

This is authenticated route-to-database proof, not an HTTP server or browser
journey. A full browser journey and Production rollout remain unverified.

## Governed count workflow bundle

Planning now returns governed field labels from the same RepeatableRead
snapshot as profile evidence. The screen offers present-value counts only for
measure fields in the saved review matching that planning profile. Counts still
come from the existing reviewed server service and show their actual revision
and profile identity; zero is present and missing values are excluded. Holds
block both count controls. An uncertain save requires an explicit reload before
another save, including when the append succeeded but the following read failed.

The opt-in disposable browser harness starts the built application, signs in
through the real form and exercises review and count APIs against real
PostgreSQL with the migration chain installed. Only the Neon HTTP transport is
adapted to loopback PostgreSQL. It starts with already-profiled synthetic
worksheets; it does not prove file upload/inspection or hosted Neon transport.
Production schema and deployment acceptance remain separate. See
`data-hub-analysis-release-plan.md` for rollout prerequisites and recovery.

## Reviewed count response contract

`parseReviewedCountResponse` validates the closed v1 successful count envelope
before the screen displays it. Counts are nonnegative safe integers and review
revisions are positive safe integers. All plan/result algorithm versions and
eight lineage identities are required. Only ready row-count and present-count
plans are accepted; present counts retain `EXCLUDE_MISSING`. Unexpected fields,
grouped operations, holds, malformed values and incompatible versions fail
closed. The returned worksheet, operation and measure must match the request.

The parser is pure and returns copied validated records. It does not execute,
recompute counts, authenticate, establish organization access or prove current
database pointers. A valid server result can use a newer profile/review than
the screen load; that actual lineage is retained. The existing server remains
responsible for authorization and fresh review/capability evaluation. Rejected
responses clear the prior count; retry remains an explicit user action.

The browser proof additionally corrupts nine otherwise genuine count responses
to check rejection, clearing prior results, hiding unexpected response contents,
no extra request during the observed recovery interval and explicit valid retry.
Only these contract probes intercept response bodies; baseline workflow,
authorization and persistence recovery still use genuine responses. Invalid JSON
and non-object envelopes yield `RESPONSE_INVALID`, never decoding snippets.

## Failure display contract

`analysisFailureReference` is a pure closed projection of review/count failure
references. Recognized codes retain their recovery meaning; unknown codes,
non-string values and unexpected exception messages become `REQUEST_FAILED`.
Neither server diagnostics nor connection messages are displayed. This is a
display boundary, not authorization, error-envelope validation or permission to
retry. The existing save uncertainty guard still requires explicit reload;
count failures still clear results and await an explicit retry.

## Profile-statistics planning target

`buildAnalysisPlan` can describe a governed grouped-row-count intent without
making grouping executable. `buildProfileCountPlan` narrows that description to
the existing profile-statistics target: row count and present-value count only.
Grouped intent retains `PROFILE_OPERATION_NOT_SUPPORTED`; generic aggregate
intent retains `PLAN_KIND_NOT_SUPPORTED`. Holds and capability denials remain
checked before target acceptance. Supported schema, profiler and quality
resolution versions are required; incompatible versions return
`PROFILE_PLAN_VERSION_UNSUPPORTED` before profile statistics are read.

The existing pure evaluator uses this target planner. No database/API/UI/AI
execution is added. The target plan establishes neither dataset provenance nor
freshness, access authorization or sufficient profile evidence; the existing
scoped evaluator and server loaders retain those responsibilities.

## Catalog admission before planning

The general planner now requires a complete structural field catalog before
deriving capabilities. Its seven role lists must be arrays of nonblank string
identities, with no repeats within or across roles. Their total must equal a
nonnegative safe integer field count; missing or additional role lists fail.
An empty catalog remains valid for row counts. Original identities are retained,
never normalized or silently deduplicated.

Malformed catalog metadata returns `READINESS_CATALOG_INVALID` from general
planning, profile-target planning and evaluation before profile evidence is
read. This replaces the later `PROFILE_LINEAGE_MISMATCH` diagnostic for duplicate
readiness identities; mismatched profile evidence retains its lineage error.
Quality holds retain precedence even when catalog metadata is unavailable.
The guard validates structural consistency only, not provenance, freshness,
algorithm support or access. Those existing version/scoped/server checks remain.

## Closed readiness state admission

Readiness derivation accepts only the three known reviewed-quality states.
An unknown state returns `QUALITY_STATE_INVALID` instead of defaulting to ready.
Direct capability derivation accepts only supported readiness-version metadata,
a valid structural catalog and either ready state. Unknown readiness states,
incompatible readiness versions and malformed catalogs produce
`UNAVAILABLE_INVALID_READINESS` with no dataset or field capabilities. Request
validation rejects that capability state using its existing unsupported-state
failure. A genuine quality hold retains `BLOCKED_QUALITY_HOLD`; invalid metadata
is never relabeled as a reviewed hold or permission to proceed.

These pure admission checks add no execution or access authority. The existing
profile-target version checks, scoped evidence checks and server authorization
remain required. Valid empty datasets and acknowledged notices remain supported.

## Dataset-scoped intent planning

`buildScopedProfileCountPlan` compares the readiness snapshot's eight lineage
identities against the context supplied by the trusted caller before accessing
readiness or planning the request. Invalid and mismatched contexts retain their
existing distinct errors. Matching metadata then passes through the existing
profile-target planner, preserving holds, catalog/version denials and supported
operations. The accepted result is a scoped snapshot of the plan with a copied,
closed context. Unknown context metadata is omitted; later input mutation cannot
relabel the accepted description.

No profile statistics are required or read. Matching context does not prove
authorization, fresh database pointers, saved-review status or sufficient
evidence for a count. A later execution caller must load and revalidate those
facts; this contract is neither a replay token nor a durable execution grant.

## Review-derived planning composition

`buildReviewedProfileCountPlan` accepts trusted loaded semantic and quality
snapshots plus their review revision. It first compares both full contexts
against the expected dataset, validates a positive safe integer revision,
derives readiness and then invokes the dataset-scoped profile-target planner.
Callers do not supply readiness or profile statistics. An accepted result
retains the actual supplied review revision and a detached scoped plan.

Scope mismatches, invalid revisions, unknown quality states, holds, incompatible
algorithm versions and unsupported field operations fail closed. The snapshots
and revision must come from an authorized loader; this pure composition cannot
prove persistence, fresh pointers or permissions. No API accepts caller-created
review snapshots, and this bundle adds no database or analysis execution path.

## Bounded review-pinned planning bundles

`buildReviewedProfileCountBundle` accepts the same trusted review metadata plus
a closed envelope: `bundleVersion: "v1"`, a positive safe integer
`expectedReviewRevision`, and `requests`. The ordered request list contains
between 1 and `MAX_PROFILE_COUNT_BUNDLE_REQUESTS` (20) intents. This explicit
planning bound limits composition work; it is not an execution quota.

Both dataset contexts and the supplied review revision are checked before
request planning. Revision mismatch returns `REVIEW_REVISION_MISMATCH` before
reading semantic/quality snapshots. Malformed envelopes, unknown keys,
unsupported envelope versions and out-of-bound lists return
`PROFILE_BUNDLE_INVALID`. Sparse entries are invalid requests, not skipped.

The admitted review revision is captured once. Semantic and quality snapshots
are read once to derive an owned readiness snapshot for the entire bundle;
schema catalog construction is not repeated for each intent. Every request
then uses the existing dataset-scoped profile-target planner with that common
readiness. Accepted plans still have independent copied contexts and snapshots.
Readiness derivation failures retain `requestIndex: 0`; request-specific
failures retain the first failing position. This preparation is per invocation,
with no shared cache or durable prepared state.

Success
retains request order, duplicate intents, detached scoped plans and one review
revision. The first failed request returns its existing closed diagnostic and
zero-based `requestIndex`, without any partial plans. This is all-or-nothing
intent composition, not a database transaction or permission to run a batch.
Revision equality compares supplied metadata only; an authorized execution
caller would still need fresh persisted review, lineage and permission checks.
No statistics, raw values, API, UI or execution path are added.

## Fixed bundle admission

`validateProfileCountBundleInput` admits a closed data envelope before review
snapshots are read. Its three required fields must be own enumerable data
properties; inherited fields, accessors and any extra own string/symbol keys
are invalid. It captures the revision and bounded request-list membership into
a fresh envelope and list. The planner consumes that admitted list rather than
rereading the caller's array after review preparation, so later source-list
growth, replacement or reordering cannot expand or reorder the accepted work.

List copying uses own index data descriptors without invoking a custom
iterator or entry getter. Accessor entries return `PROFILE_BUNDLE_INVALID`;
holes and inherited entries become undefined intents and retain the planner's
indexed `INVALID_REQUEST`. Individual intents now use structural admission
before review preparation, as described below. Neither envelope nor structural
admission establishes available capabilities, fresh review state or execution
authority. No new execution path or persistence is introduced.

## Detached structural intents

`parseAnalysisRequestInput` accepts the closed v1 row, grouping and aggregate
intent shapes using own enumerable data properties. Accessors, inherited
required fields, hidden/symbol extras and unsupported operators return
`INVALID_REQUEST` without invoking request property getters. Success projects
a fresh intent containing only scalar version, kind, field identity and the
supported operator; identities are preserved exactly. Structurally valid generic
aggregates and grouping remain subject to the existing planner's restrictions.

The capability validator uses this shared parser after its hold/state/version
checks, retaining denial precedence. Bundle admission uses it to copy intents
before review preparation; malformed payloads become undefined entries so the
governed planner retains indexed `INVALID_REQUEST` and quality-hold precedence.
Later payload mutation cannot relabel admitted valid intents. Structural
admission proves neither field availability nor dataset/review provenance,
permission or support for executing the operation. No capability is granted by
parsing and no API accepts prepared bundles.

## Pure pipeline acceptance

`dataHubPlanningPipeline.test.ts` composes the real profiler, semantic review,
quality review and review-pinned bundle planner using synthetic fixtures. The
test revision is supplied explicitly and makes no persistence claim. The path
ends at detached intent plans: no count evaluator, database, API, UI or AI is
invoked. Synthetic cells are used only to construct fixture profile metadata;
plans omit cells, numeric statistics and count values.

Acceptance covers explicit ambiguous meanings, generated constant-column
notices and acknowledgement, empty-profile CONTINUE/HOLD decisions, all eight
lineage identities across profile/choices/decisions, invented decisions,
automatic flag semantics, unsupported grouping/generic aggregates, revision
mismatches and inconsistent profile counts. A valid first intent never survives
a later bundle denial. This proves compatibility of the pure contracts; it
does not establish authenticated loading, saved review provenance, current
database pointers, hosted transport or Production readiness.

## Profile-target request discovery

`buildReviewedProfileCountRequestCatalog` derives a versioned request inventory
from trusted scoped semantic/quality review metadata. Both contexts and a
positive safe review revision are admitted before readiness derivation. The
existing profile-target row planner checks quality holds, catalog structure and
supported algorithm versions before any templates are exposed. Denials return
their existing closed diagnostic with no partial inventory.

Success carries copied closed dataset context, actual supplied review revision,
ready/acknowledged state, one ROW_COUNT template and explicit COUNT_PRESENT
templates for reviewed measures in catalog order. Other field classes do not
produce measure templates; grouping and generic aggregates are not advertised.
Templates contain copied scalar identities, with no labels, statistics, counts
or raw values. Accepted templates round-trip through the existing planners.

This inventory is metadata discovery, not a submitted batch: it retains all
measure templates even when there are more than 20. A caller selecting a bundle
still must satisfy the existing 1–20 admission bound. Catalogs grant no access,
saved-review provenance, freshness or execution permission. A later authorized
caller must load current review metadata and plan its selected requests again.
No catalog API/UI, query execution or persistence is added.

## Completed v1 discovery-to-selection planning

`parseProfileCountSelectionInput` and `buildReviewedProfileCountSelection`
complete the workflow from catalog discovery to selected measure plans. A
closed v1 selection pins an expected review revision, chooses row count and
supplies ordered distinct measure identities. It admits 1–20 total intents,
copies scalar selections before review preparation and revalidates every
selected field through the existing governed bundle planner. Catalogs never
substitute for current trusted review metadata. All-or-nothing output and
zero-based request indices retain the existing bundle contract.

Shared internal scope admission now copies all eight expected identities and
captures the supplied positive safe revision once for single plans, bundles,
discovery and selections. No prepared state is persisted. See the complete
[v1 planning contract](data-hub-profile-planning-contract.md) for format,
denial ordering, limits, acceptance and the separate integration/release boundary.
