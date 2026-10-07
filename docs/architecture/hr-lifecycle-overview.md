# HR-9 operational lifecycle overview

The People header links to `/people/lifecycle`, a read-only register of active
lifecycle workflows visible to the current caller. Each row shows the person,
onboarding/offboarding type, visible task count, outstanding task count,
awaiting-approval count and overdue task count. Filters select all active
workflows, outstanding work, approvals or overdue work. Selecting a person
opens the existing Person drawer; closing it refreshes the register.

`GET /api/hr/lifecycle/overview` uses the existing database-backed lifecycle
request context, People capability check, viewer-scoped workflow query and
canonical visible-task query. Linked employees, current direct managers and
HR administrators keep their existing authority; global assignment IDs never
become a new access source. The existing active-organisation-scoped super-admin
policy is preserved. Hidden tasks contribute neither counts nor metadata.

The response allowlist contains workflow ID, person ID, lifecycle type and four
counts. It contains no task descriptions, assignees, responsibility/approval
metadata, visibility flags, document data, restricted-case data, contacts or
audit records. Person names are joined in the browser from the existing
authorized People endpoint. All overview responses are private/no-store, and
failed reads produce a generic 503 rather than partial totals.

Outstanding means NOT_STARTED, IN_PROGRESS or AWAITING_APPROVAL. Overdue means
an outstanding task has a non-null due instant strictly before the server's
reference time. Completed, waived and cancelled tasks do not count as
outstanding or overdue. A visible workflow with no visible tasks shows zero
counts; it does not imply that no hidden tasks exist.

Reads are batched with at most four simultaneous task queries, and workflows
are not silently truncated. This reuses current per-workflow readers; very
large tenant datasets may warrant a separately reviewed paginated aggregate
query. Counts are a refresh-time operational view, not a transactional snapshot
or a claim that the caller can execute/approve every counted task. Existing
server-derived capabilities in the Person drawer remain authoritative.

Focused tests cover counting, terminal/undated/exact-boundary tasks, empty
authorized lists, bounded concurrency, generic failures, response allowlists,
non-cacheable authorization failures, filters, drawer navigation and refresh.
New overview tests replace database-backed readers and transport with fixtures;
existing lifecycle authorization/query containment tests provide the separate
permission proof. A live production-data smoke test is not included.

This slice adds no schema, record mutation, background job, reminder delivery or
model call. Main automatically deploys to production. The prior release
authorization covered HR-8 PRs #404/#405; release of this new HR-9 slice requires
its own authorization before merge.
