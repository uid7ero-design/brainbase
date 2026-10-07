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
