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

The child inherits the existing client boundary and imports server result types
only. Runtime imports are pure contracts. Controls use labels, a fieldset,
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

Local acceptance for this integration candidate passed: 1,021 focused tests in
47 files; all 64 disposable PostgreSQL tests, including extended signed-session
route assertions; TypeScript; changed-file lint; the optimized local Next.js
build; and the built-app browser journey described above. The browser reported
zero page exceptions, and the planning controls fit a 390-pixel viewport. Five
planning and nine existing count response-corruption probes were deliberate;
the baseline and recovery journeys used genuine HTTP replies. The owned test
container was removed, and D4D5Q remains blob
`cc7f948944b1f0bd772a140d33be901736c5ca26`.
