# Authenticated analysis planning integration

This package connects the completed pure discovery, selection and JSON exchange
contracts to the existing worksheet review screen. It reads current saved review
metadata and produces governed request descriptions. It does not execute a count,
save a review, inspect raw cells, add an analytical query, or call AI. Existing
review/save/count actions remain explicit and separate.

## Server boundary

`/api/data-hub/worksheets/[id]/analysis-planning` supports two read-only methods:

| Method | Input | Result |
| --- | --- | --- |
| GET | Worksheet path and authenticated manager session | Closed current request catalog |
| POST | Profile pin and bounded v1 selection | Closed ordered plans or one denial |

Both methods call `requireRole("manager")` before processing inputs. Tenant scope
comes exclusively from the validated session and worksheet identity from the
path. A moved, inactive, demoted or invalid session cannot reuse a previously
loaded catalog. Another organisation's worksheet remains concealed with 404.
All responses, including failures, carry `Cache-Control: private, no-store`.

The existing review loader obtains the authoritative current profile and latest
saved review in one RepeatableRead transaction. The adapter adds no database
statements. Internal loader diagnostics are projected to fixed allowed codes;
unsupported persisted-review failures become `REVIEW_RECORD_INVALID`.

POST accepts exactly:

```json
{
  "datasetProfileRunId": "current-profile-id",
  "selection": {
    "selectionVersion": "v1",
    "expectedReviewRevision": 1,
    "includeRowCount": true,
    "measureColumnIds": ["reviewed-measure-id"]
  }
}
```

The pin is compared to the profile loaded under trusted tenant scope; it is never
lookup authority. This rejects a replaced profile even if its review revision
numerically matches the old profile. Revision, supported versions, field
eligibility and quality hold are revalidated for every selection. Requests have
1–20 total entries, row first when selected, and exact measure order. No partial
bundle is returned. Caller-supplied tenant, review, schema, catalog, readiness,
evidence or extra fields are invalid.

JSON content type is required. The body reader counts actual UTF-8 bytes, stops
above 64 KiB, and rejects malformed UTF-8/JSON; Content-Length is not authority.
Bad selection is 400, stale profile/revision is 409, governed quality denial is
422, missing worksheet/review is 404, and unavailable reads are 503. Auth remains
401/403. No response contains exception messages, traces or raw values.

## Client behavior

The user explicitly loads planning choices, selects row/present-measure intents,
then plans them. Nothing loads or executes automatically. Labels retain field
positions to distinguish identical source labels. Selection controls enforce the
20-entry limit and prevent empty submissions.

Catalog and plan replies pass the existing closed JSON decoders, matching all
eight lineage identities, saved review revision, ready state, exact selected
operations and order. Invalid, mismatched, denied or failed replies clear previous
choices/plans and show only safe fixed references. Explicit reload is required;
there is no retry or count/save follow-up. A new review/context remount aborts
pending work. Request generation and controller identity discard late replies
and prevent an older request from unlocking newer work. Save/count/review
controls are locked during planning. A newer count lineage hides old planning
until the saved review is refreshed.

The browser transport requires JSON content type and fatal UTF-8 decoding,
counting actual streamed bytes up to 1 MiB. An oversized or non-JSON response
is rejected as a whole; catalog entries are never silently truncated. Content-
Length cannot override the limit. Very large catalogs may therefore require a
separately designed pagination contract; this package adds no pagination or
performance guarantee.

One 15-second deadline covers both response headers and body consumption. A
visible Cancel planning action aborts pending work. Deadline/cancellation races
release controls even if a transport ignores abort; late work has no UI callback
and cannot replace recovered choices. Timeout and cancellation clear prior
choices/plans and require explicit recovery, with no retry, count or save. Safe
local references are `REQUEST_TIMED_OUT` and `REQUEST_CANCELLED`; these are
transport outcomes, not new wire-planner denials or execution authority.

The child inherits the existing client boundary and imports server result types
only. Runtime imports are pure contracts and a browser transport module. Controls use labels, a fieldset,
status/alert regions, and wrapping layout for narrow screens.

## Acceptance and release boundary

Focused tests exercise auth-before-service, server-owned scope, injected inputs,
real byte bounds, profile/revision/field/hold revalidation, sanitized failures,
maximum selections, cancellation, stale reply discard and explicit recovery.
The existing owned disposable PostgreSQL harness adds current catalog/selection
route assertions and immutable review history to its signed-session tests.
The built-app harness uses real form login, role checks, routes and PostgreSQL;
only Neon HTTP transport is adapted to the local wire protocol. Its genuine
planning flow checks descriptions, sibling control locking, zero count/save
calls and identical history. Deliberately corrupted replies are separately
identified as contract probes, followed by genuine explicit recovery.

No new migration is included. D4D5Q remains the existing prerequisite. This
isolated proof does not establish hosted authenticated transport, real ingestion,
large-tenant performance, owner verification of D4D5Q, or Production readiness.
PR #419 stays unmerged because main auto-deploys. Production, migration execution
outside the owned test database, AI, new analytical execution and release require
separate authority. See [release plan](data-hub-analysis-release-plan.md).

The initial integration candidate passed: 1,021 focused tests in
47 files; all 64 disposable PostgreSQL tests, including extended signed-session
route assertions; TypeScript; changed-file lint; the optimized local Next.js
build; and the built-app browser journey described above. The browser reported
zero page exceptions, and the planning controls fit a 390-pixel viewport. Five
planning and nine existing count response-corruption probes were deliberate;
the baseline and recovery journeys used genuine HTTP replies. The owned test
container was removed, and D4D5Q remains blob
`cc7f948944b1f0bd772a140d33be901736c5ca26`.

The transport/recovery hardening bundle passes 1,140 focused tests in 51 files,
all 64 rerun disposable PostgreSQL tests, TypeScript, changed-file lint and an
optimized build. The fresh built-app journey verifies genuine responses delayed
through cancel, the 15-second deadline and navigation; late replies cannot
replace explicitly recovered choices, and no automatic retry/count/save occurs.
Seven deliberate planning corruption probes now include oversized and non-JSON
bodies. Keyboard Space selects a measure and Enter submits its plan. Automated
accessibility checks cover idle, selection, planned, pending and canceled states;
they do not establish screen-reader or color-contrast acceptance. Planning and
timeout recovery fit a 390-pixel viewport, with no browser page exceptions.

A real explicit review append after discovery rejects the open screen's old
selection. Refreshing review/catalog then plans revision 2 without another
append; the original record remains unchanged. The owned container and
disposable login fixture are removed, and D4D5Q content remains unchanged.
Existing review/count/authorization/save-timeout regressions also pass. These
receipts retain the isolated transport, ingestion, performance and release
limits above.

The subsequent [isolated acceptance package](data-hub-isolated-acceptance.md)
extends fixtures through the real normalization executor before profiling and
records a clean candidate's build, harness, artifacts and cleanup. This is
synthetic raw evidence to planning acceptance; file ingestion and hosted
transport remain unverified, and a local passing receipt does not authorize
release.
