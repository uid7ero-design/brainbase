# Review-pinned planning pages

Paged discovery bounds the planning choice response and rendered measure list
to 50 entries per page. It retains row-count choice, selections across pages,
and the global 1–20 request submission limit. This is metadata discovery and
descriptive planning; no analytical execution or release authority is added.

## Request and server admission

The existing planning endpoint retains its full-catalog GET behavior. An
explicit `pageVersion` query switches to the closed paged contract:

```text
GET /api/data-hub/worksheets/[id]/analysis-planning?pageVersion=v1&datasetProfileRunId=profile-id&expectedReviewRevision=1&pageSize=50&offset=0
```

Exactly those five query fields are allowed, once each. Numeric values are
canonical decimal strings: positive safe revision, page size 1–50, and a
nonnegative safe offset aligned to page size. Duplicate/extra/missing fields,
unsupported versions, malformed numbers and invalid positions return
`PLANNING_PAGE_INVALID` (400). Unpaged legacy behavior is preserved; its ignored
query values still cannot supply scope.

Manager authorization runs before query admission. Tenant identity comes from
the current session and worksheet identity from the path. The existing loader
obtains current profile and saved review in one RepeatableRead snapshot for
every page. Profile pin and review revision must match independently; an offset
is a list position, never a lookup identity, cursor capability or permission.
Holds, unsupported algorithms, invalid catalogs and changed lineage fail closed.
Responses remain private/no-store, including denials.

Full and paged discovery share the same pure target/readiness admission. Paging
constructs templates only for its bounded slice. There is no shared cache or
persisted prepared state. Loading and readiness derivation still read the full
review/profile metadata; the existing review screen still renders its field
review controls. This is not database query pagination, broad performance
qualification, or a claim that arbitrarily large schemas fit the whole screen.

## Closed page response

Success is exactly `{ ok: true, page }`. The page contains:

| Field | Meaning |
| --- | --- |
| `pageVersion` | v1 |
| `context`, `reviewRevision`, `readinessState` | Full eight-part lineage, exact saved revision and ready state |
| `rowCountRequest` | Closed v1 ROW_COUNT template |
| `offset`, `pageSize`, `totalMeasures` | Position, bounded window and measure inventory size |
| `requests` | This window's ordered distinct v1 COUNT_PRESENT measure templates |
| `nextOffset` | Exact following position or null at the end |

An empty measure inventory has offset 0, no measure templates, and null next
position; row-count choice remains available. Other empty/out-of-range pages
are rejected. Measure membership/order matches the reviewed schema's measure
order, retaining opaque ID spelling. Inventory size is metadata, not an
analytical count result. Labels, values, statistics, generic aggregates and
grouped plans are outside the page response.

The client decoder admits closed own-data records, supported request formats,
safe page arithmetic and dense lists. It matches context, revision, readiness,
size, requested position, total inventory and exact field membership/order to
the loaded review. Unknown/extra fields, bad navigation positions, partial
windows, repeated fields and mismatched scopes reject the whole response.
Known catalog denials are unindexed; page admission failures cannot carry a
request index. Decoding remains descriptive and grants no provenance,
freshness, access, field capability or execution authority.

## Selection and recovery

Load planning choices begins at page zero and clears prior choices. Next and
Previous preserve the row choice and ordered selected IDs, while invalidating
the previous plan. Only one request is active. Current-page controls plus a
bounded Selected measures list let users remove off-page choices. The global
limit includes row count: 19 measures with rows, or 20 without rows. Navigation
does not submit, retry, save or execute.

Every POST still uses the original closed selection contract and revalidates
all selected fields against the current saved review, irrespective of which
pages advertised them. Click order is retained, with row count first when
chosen. Page denial/mismatch, timeout, cancel or transport failure clears the
entire selection and prior plans; recovery explicitly reloads review/choices.
Review/context replacement cancels pending work, and late replies cannot
replace recovered choices. Existing 15-second deadline and one-MiB response
limit continue to apply. Paging does not relax the byte limit for unusually
large individual IDs.

## Acceptance and release

Pure tests cover first/middle/last and row-only pages, canonical closed query
admission, malformed/accessor input, offsets, versions, holds, stale pins,
all-or-nothing decoding and exact membership/order. Route/service tests cover
auth-before-input, server-owned scope, no-store, malformed input before reads
and latest review revalidation. Component tests cover cross-page order,
global bounds, off-page removal and stale page recovery.

The owned database/browser package includes 51 reviewed measures generated
through real normalization and profiling. Its 50/1 discovery pages exercise
cross-page selection, removal and a maximum-size ordered plan without count or
save calls or an extra review. One deliberately corrupted next-position reply
clears choices/plans and recovers by explicit genuine reload. The paging mobile
artifact is included in the acceptance receipt hashes alongside earlier
evidence. This remains synthetic loopback proof; hosted authenticated transport,
file ingestion, larger workload performance and Production readiness remain
separate. PR #419 retains its release hold.

See [isolated acceptance](data-hub-isolated-acceptance.md) and
[release plan](data-hub-analysis-release-plan.md).
