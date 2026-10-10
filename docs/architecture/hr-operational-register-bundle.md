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

This is client display pagination. APIs still return complete authorized datasets;
it does not bound database reads or response bytes. Server pagination and large-
tenant load certification remain separate work. Lifecycle readers retain their
four-read concurrency limit, and document assurance retains its single aggregate.

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

Release hold: main automatically deploys to production. The bundle remains in
PR #416 for one review and release authorization after validation. Prior approval
for #413 does not authorize merging this bundle.
