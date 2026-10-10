# HR-9 operational register bundle

PR #416 bundles the viewer-visible outstanding task queue with browsing controls
and navigation across People, lifecycle overview, task queue and document assurance.
The shared navigation identifies the current page. Register search is trimmed and
case-insensitive: person names on both overviews, person names or task titles on
the queue. Lifecycle type combines with existing workflow/task state filters.
Document evidence filters remain separate from lifecycle authority.

All three registers show 25 matching rows per display page. Filtering happens
before slicing and changing search or filters resets to page one. A refreshed
dataset that shrinks clamps the displayed page into range. The matching-row count
covers the complete filtered result, not only the displayed page. Document counts
are never added together because categories overlap.

The register routes now paginate on the server: authenticated requests accept a
validated page, literal text search (up to 200 characters), category/status and,
for lifecycle registers, lifecycle type. Each response contains 25 rows at most,
full filtered totals and the actual page. Out-of-range pages clamp to the last
available page in the same database statement. Unknown or repeated query fields,
including organisation or user identifiers, are rejected with a generic 400.

Each register uses one parameterized SQL statement. Lifecycle visibility matches
the canonical workflow/task readers, including organisation/person/template
consistency and current-manager visibility flags. The overview materializes the
visible-task relation once before aggregation. Document assurance preserves the
existing current-version/evidence aggregate. Lifecycle page names travel in a
bounded people index; the screens no longer fetch the whole people register.

Responses are private, no-store and capped at 256 KiB of serialized UTF-8 JSON.
Excessive fields fail generically rather than being silently truncated. SQL must
still scan authorized matches to produce exact totals; pagination is not a
constant-work guarantee or a production-scale performance certification.

Existing authorization is unchanged. Task readers exclude hidden tasks and
assignment-only access. Document metadata/counts remain linked-employee or HR-only;
direct manager access to a lifecycle does not grant employee-document access.
There are no new actions, mutations, schema/environment changes, reminders or
model calls. Person drawers continue to derive action capabilities server-side.

Validation includes existing containment tests and new 61-row component/browser
fixtures. Chromium executes the real register components and shared controls;
Next Link, drawer navigation and HTTP are test seams. The browser proof covers
page movement, search reset, lifecycle filters, navigation links, drawer close
refresh, shrinking datasets, generic errors and GET-only traffic. It is not a
full authenticated deployment/browser proof or visual-layout certification.

`node scripts/tests/verify-hr-registers-runtime.mjs` creates a disposable,
loopback-only PostgreSQL 16 container and applies the actual HR migrations. It
executes the actual lifecycle/document readers and aggregate using a parameterized
pg transport seam instead of Neon. Fixtures cover employee/manager/HR/cross-tenant
visibility, assignment-only denial, current-manager and HR-grant revocation,
deleted/superseded documents, wrong-user/old-version acknowledgements, verification
tie-breaks, missing versions, unlinked employees and UTC calendar expiry. The
container is removed in finally; synthetic results go to ignored test-results.
No production connection string, data, schema or provider is used. Session and
capability context remain separately covered by route containment tests.

Commands:

- `npm run test:hr:registers` for the PostgreSQL fixture proof (Docker required).
- `npm run test:browser:hr` for Chromium register flows (installed browser required).

The preceding browsing bundle was merged as PR #416. This server-pagination
follow-up remains separately held for review and explicit release authorization:
main automatically deploys to production. No production schema, environment,
data or model-provider operation is part of this follow-up.

The disposable PostgreSQL proof adds 2,000 synthetic workflow/task/document
owners. It compares paged rows with canonical readers, checks exact filtered
totals, page clamping, literal wildcard search, hidden-title search denial,
cross-tenant/role/grant revocation and one statement per page. Ignored results
record observed timing and response bytes, not a latency SLA. Chromium still uses
HTTP and drawer seams; it now returns server-filtered pages and verifies requests
and stale-response cancellation alongside component coverage.
