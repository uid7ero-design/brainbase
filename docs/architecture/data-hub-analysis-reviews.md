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
