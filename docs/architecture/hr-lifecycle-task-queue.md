# HR-9 lifecycle task queue

The lifecycle overview links to `/people/lifecycle/tasks`. The queue shows only
viewer-visible NOT_STARTED, IN_PROGRESS and AWAITING_APPROVAL tasks in active
workflows. Terminal tasks and hidden tasks contribute no rows or metadata.

`GET /api/hr/lifecycle/queue` uses the existing lifecycle session/capability
context, active workflow list and canonical visible-task readers. Reads run in
batches of four without truncation. The established employee, current manager,
HR-administrator and active-org super-admin visibility rules remain authoritative;
task assignment never becomes an access source.

The response allowlist includes task/workflow/person IDs, lifecycle type, task
title, outstanding status, normalized UTC due instant and overdue flag. It also
states the server reference instant. Descriptions, assignee/approval identities,
visibility flags, documents, restricted cases and audit/provider data are absent.
All responses are private/no-store; any read or invalid due date fails the whole
queue with a generic 503 rather than a partial view.

Overdue means due strictly before the reference instant; exact-boundary and
undated tasks are not overdue. Ordering is overdue first, due instant ascending,
undated last, then workflow and task IDs for ties. Client filters select overdue
or a status. Names come from the existing authorized People list. Titles render
as inert React text. Opening a person reuses the existing drawer and server-derived
action capabilities; queue visibility does not grant execution or approval.
Closing the drawer refreshes the queue. Failed refreshes clear old rows; cancelled
requests cannot update the view.

See [the operational register bundle](hr-operational-register-bundle.md) for
search, lifecycle filters, display pagination, navigation and additional proof.
Tests use canonical-reader and HTTP fixtures for status/expiry boundaries,
allowlists, denial/failure behavior, bounded concurrency, filters and navigation.
Existing lifecycle containment tests provide separate permission evidence. The
bundle adds disposable PostgreSQL and real-component Chromium fixture checks.
Live production/browser smoke and large-tenant load certification are not claimed.
There are no schema changes, mutations, reminders or model calls.

Release hold: main automatically deploys to production. Prior approval covered
PR #413; this task-queue slice requires its own release authorization before merge.
