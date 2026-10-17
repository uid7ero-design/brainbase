# Workbook saved-review status

The manager-only `/data-hub/import/[batchId]/reviews` page links from workbook
preparation. Opening it reads the existing authorized worksheet inventory only.
An explicit **Check saved reviews** reads a scalar observation for each eligible
worksheet. Filters make no request. Names retain their physical worksheet
positions, including duplicate names. Hidden, empty, ineligible and skipped
worksheets remain visible outside checks.

The summary distinguishes unchecked, unconfirmed, preparation required, review
required, quality hold and saved review complete. A completed saved review with
acknowledged notices is identified separately in its card. These are worksheet
counts and observations, not calculated source-row counts. Review and preparation
links remain navigation; their destinations independently check current access,
profile lineage, decisions and capabilities.

Review links carry an optional workbook hint for the
[individual review session](data-hub-review-session-workflow.md). It becomes
navigation only after an explicit authorized membership check in that screen.

## Narrow read contract

`GET /api/data-hub/worksheets/[id]/analysis-status` authorizes a current manager
before admitting input. Organisation comes from the session, and worksheet
identity comes from the path. Query fields are rejected. There is no mutation
handler. Responses, including errors, are private/no-store.

The service uses the existing authoritative profile/review loader inside one
RepeatableRead transaction, with five-second acquisition and execution bounds.
It resolves the current profile and latest saved decisions for that profile,
recomputes semantic/quality readiness, and returns only:

- `statusVersion: v1`, `uploadId` and `state`;
- for a saved review, its positive safe `reviewRevision` and `datasetProfileRunId`.

Missing preparation and a missing saved review are distinct successful metadata
observations. Invalid lineage, unsupported profiling, invalid latest decisions,
timeouts and database failures remain unavailable; there is no fallback to an
older revision. Missing and foreign worksheets share a 404 without metadata.
Schema fields, quality decisions, statistics, historical actors, diagnostic text
and raw values are not returned. The existing loader still reads full profile
and review metadata to recompute readiness; this is not database pagination or
large-schema performance qualification.

The browser decoder accepts only the closed, versioned scalar shape and matches
worksheet identity before display. It validates revision/profile references and
rejects missing/extra fields, inconsistent shapes and accessors. This structural
check provides no authorization or freshness guarantee.

## Bounds and recovery

The existing complete inventory limit is 50 worksheets. At most two status GETs
are active. Each worksheet has a 15-second deadline, and the entire check has a
120-second deadline. The existing one-MiB streamed UTF-8/JSON response bound also
applies. There is no polling, retry, preparation, save, count, plan or AI call.

A new check or inventory refresh clears previous observations immediately.
Individual failures are unconfirmed while other successful observations can be
shown. Cancellation or the overall timeout clears all observations. Any 401, 403
or 404 clears the inventory and all observations. Abort and request identity
guards prevent late responses from restoring stale results after cancellation,
refresh, workbook replacement or navigation. Recovery is always explicit.
Each worksheet is observed in its own snapshot; the workbook is not atomic.

## Verification and release boundary

Contract/service/route/component tests cover projection, latest-review behavior,
scope/lineage mismatch, holds/notices, query rejection, no-store, malformed and
accessor input, bounded concurrency, deadlines, cancellation, filtering and scope
loss. Automated accessibility checks cover initial and observed states. The
React review checks hooks/request cleanup, keyed workbook state, server/client
imports, labelled controls and bounded rendering.

The disposable PostgreSQL package adds a signed-session route proof for missing
review, current revision, invalid latest decisions without fallback, incomplete
preparation, foreign scope and unauthenticated denial. The built-browser journey
adds genuine missing-review/preparation and latest-review/hold observations,
keyboard checking, 390px layout, live role demotion and foreign denial. Named
transport probes delay a genuine reply or corrupt its identity; explicit genuine
checks recover. Preparation and review history digests remain unchanged. The
new mobile screenshot is included in the acceptance receipt's artifact hashes.

This is synthetic local proof using the existing loopback Neon transport adapter
and setup-only InMemoryFileStore. Hosted/Production, large-workload and formal
assistive-technology acceptance remain separate. No schema or migration change,
merge, Production deployment or configuration change is part of this bundle.
