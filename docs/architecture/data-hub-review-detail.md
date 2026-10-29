# Inspect recorded review decisions

Managers can explicitly open **View decisions in revision …** from the saved
review history. Both earlier and current revisions show their complete explicit
field choices and quality decisions for the current profile. An absent choice
is not inferred, approved or converted to zero. Historical choices never replace
the current review, change readiness or unlock a count. There is no restore,
save, export, query execution or AI operation in this bundle.

## Governed read

`GET /api/data-hub/worksheets/[id]/analysis-review/history/detail` requires the
existing `historyVersion=v1`, `datasetProfileRunId` and `expectedReviewRevision`
pins plus a positive, canonical `revision` no greater than the current pin.
Unknown, duplicate, missing and noncanonical query fields are rejected.
Authentication and the live manager role are checked before query admission;
organisation comes only from that session. All responses are private/no-store.

The shared history loader resolves current authorized profile lineage, validates
the latest review and checks both current pins before selecting a historical
revision. All reads share one RepeatableRead snapshot with five-second
acquisition and execution limits. A current-revision detail request reuses the
validated latest record; an earlier detail needs one additional fully scoped
record. There is no history scan or fallback from missing/invalid decisions.
Full stored choices are parsed and recomputed against current profile evidence.
The selected review must match the organization, worksheet, profile and revision.

The closed `detailVersion=v1` response contains all eight lineage references,
the current and selected revision numbers, and copied explicit field/quality
decisions. It selects no actor, timestamp, source-cell values, source-row counts,
profile statistics or diagnostics. The client validates the exact envelope,
version, lineage, revisions, decision vocabulary, duplicate identities, allowed
profile field IDs and array/ID bounds before rendering. The existing 1,000-field
and quality-identity ceilings apply. The server still reads full structural
profile evidence and stored decision JSON; this is not large-schema performance
qualification or SQL projection of individual JSON decisions.

## Screen behavior

Details and comparisons offer local filters for all decisions, field choices,
quality decisions and holds. In a comparison the hold filter includes changes
either from or to a hold. Filtering makes no request and never changes the
underlying snapshot. Each list renders at most fifty entries, with explicit
previous/next controls. Filter changes reset paging; new reads reset filters,
paging and both previous detail/comparison views. Empty filters are identified
explicitly. Duplicate field names keep their positions in governed labels.

Detail reads inherit the fifteen-second, one-MiB streamed transport, explicit
cancellation, sibling control locks and late-reply suppression. Read failures
clear details and history; live scope loss, changed profile/revision or invalid
saved evidence invalidates the current session and requires explicit reload.
The parent keys the history screen by current revision and complete lineage.
No requests run automatically and there is no retry, polling or local persistence.

## Verification and release boundary

Contract, service, route and component checks cover strict detail admission,
copied choices, absent decisions, opaque IDs, invalid records, current-record
reuse, scoped selection, cancellation, local filters/paging and accessibility.
The disposable database suite exercises selected/current detail responses,
unchanged history, malformed latest/historical decisions, changed pins and live
role/organization loss through real signed sessions.

The built browser inspects genuine earlier/current decisions, checks filters
without requests, rejects a deliberately corrupted detail response and verifies
live role/revision invalidation. Earlier HOLD does not disable a ready current
review; earlier CONTINUE cannot unlock a held current review. The mobile detail
screenshot is included in the local acceptance receipt's artifact hashes.
The existing full workflow proofs also run against the candidate.

Local database/browser proof uses the owned loopback PostgreSQL adapter and
setup-only InMemoryFileStore. Hosted authenticated transport, larger workloads,
formal assistive-technology qualification and authenticated Production behavior
remain separate. This bundle changes no schema or migration. Push and PR checks
are included; merge and Production release require a new owner instruction.
