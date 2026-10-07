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
