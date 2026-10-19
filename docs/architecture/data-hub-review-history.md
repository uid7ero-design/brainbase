# Saved review history and decision comparison

The manager review screen adds explicit **Load review history** and **Compare
revision … with current review** actions. History is available for a current
saved review, including one on quality hold. It never restores old decisions,
changes readiness, calculates counts or executes a plan. The current profile
and latest saved review still govern every count/planning operation.

## Read contracts

Two manager-only GET routes use the existing append-only review table:

- `/api/data-hub/worksheets/[id]/analysis-review/history`
- `/api/data-hub/worksheets/[id]/analysis-review/history/compare`

Both require `historyVersion=v1`, `datasetProfileRunId` and a positive safe
`expectedReviewRevision`. History accepts optional exclusive `beforeRevision`;
comparison requires `baselineRevision` strictly below the expected current
revision. Unknown, duplicate, noncanonical and out-of-range query fields are
rejected. Organisation comes only from the live session; the path supplies the
worksheet. Authorization precedes query admission. Neither route has a mutation
handler. All GET responses, including errors, are private/no-store.

Each request resolves authoritative successful profile lineage and reads the
latest matching review in one RepeatableRead snapshot, with five-second
transaction acquisition/execution limits. A profile or latest-revision mismatch
returns 409. The latest record must be valid even when reading an older page;
invalid latest decisions cannot fall back to a historical review.
These are snapshot observations; later saves or profile changes can occur after
the response and are rechecked by subsequent governed operations.

History reads at most eleven scoped records, ordered by descending revision,
and returns at most ten with an exclusive next cursor. Revision numbers are per
profile. Only the current profile is included. The response projects the eight
lineage references, current revision, page boundaries and per-revision counts of
explicit field choices, quality decisions, acknowledgements, continue decisions
and hold decisions. These are decision counts, not source-row counts or stored
readiness. There is no total-count query or unbounded history scan.

Comparison reads the selected earlier revision and compares it with the current
latest record. Both records are validated using the existing closed decision
parser and recomputed semantic/quality resolution against the same profile.
Every history row admitted to a page is validated in the same way. Invalid
historical records make that read unavailable; they are never skipped silently.
The current implementation still loads complete structural profile evidence
and full decision JSON for the bounded records; this is not SQL projection of
JSON counters or large-schema performance qualification.

The comparison returns changed explicit semantic roles and quality decisions by
opaque field/quality identity. Map keys preserve IDs such as `__proto__` and
`constructor`. A missing explicit decision is represented by null and displayed
as absent, never as zero or approval. Unchanged choices are omitted. Governed
labels come from the already-loaded matching plan; duplicate names retain field
positions. No historical actor IDs, timestamps, source cell values, profile
statistics, query results or diagnostic text are selected for the response.

## Bounds and recovery

The existing 1,000-field interactive ceiling applies, with bounded quality
identities. IDs are limited to 512 characters. Closed versioned decoders validate
full lineage, expected profile/revision, page order, cursor progress, counts,
change identity, role/decision vocabulary and absent values before rendering.
Comparisons render fifty changes at a time; those local page controls make no
request and do not alter the comparison.

History and comparison requests reuse the fifteen-second, one-MiB streamed
UTF-8/JSON transport. There is explicit cancellation and no polling or retry.
Loading history/comparison locks sibling review/count/planning/navigation
controls. New requests clear old comparisons; failed/cancelled reads clear
history. Cleanup and request identity guards prevent late replies after
cancellation, replacement, unmount or a changed current review. Scope loss,
missing/invalid saved records, changed profile or a newer revision clears the
entire review session and requires an explicit reload. Historical navigation
cannot clear an uncertain-save lock or enable a quality-held count.

## Verification boundary

Contract, service, route and component checks cover bounded pagination, strict
query input, metadata projection, opaque IDs, absent/changed decisions, invalid
records, no fallback, full scope/revision matching, cancellation/deadlines,
sibling locks, local comparison paging and accessibility.

The disposable PostgreSQL suite exercises twelve genuine revisions, real
semantic-choice comparison, exact page boundaries, immutable history, concurrent
revision invalidation, malformed latest/historical decisions, live role loss,
moved sessions and foreign scope. The built browser makes explicit corrections
to a held synthetic review, observes HOLD→CONTINUE and CONTINUE→HOLD comparisons,
and proves history reads do not append reviews or change preparation evidence.
Named transport probes delay genuine replies or alter a comparison's context.
Cancellation, deadline and live authority/revision changes require explicit
recovery. `review-history-mobile.png` records the 390px comparison and is bound
into the acceptance receipt. Multi-page history is established by the native
database and component checks; the built browser uses three revisions.

This bundle adds no schema/migration, analytical executor or AI. Local proof
uses the existing owned loopback PostgreSQL adapter and setup-only in-memory
file store. Hosted authenticated behavior and larger workloads remain separate.
Push/PR validation is included; merge and Production release require the next
explicit owner release instruction.
