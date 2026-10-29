# HR-9 document assurance overview

The People header links to `/people/documents`. The read-only register shows
people with live employee documents within the caller's document authority:
linked employee self-access or HR administration, including the existing
active-organisation-scoped super-admin bypass. Direct manager and task assignment
relationships do not grant document access or counts.

`GET /api/hr/documents/overview` uses the employee-document session and People
capability context. One aggregate statement scopes every document, current
version, acknowledgement and verification to the owning organisation. Only the
currently linked employee's acknowledgement counts; latest verification follows
the existing verified-at, created-at and ID tie-break order. Deleted documents
and superseded versions contribute nothing. There is no per-person read loop.

The response contains person ID/name and counts, plus the UTC reference date and
30-day expiry horizon. It contains no document identifiers, titles, descriptions,
bytes, storage paths, comments, verifier identities, restricted cases, audit or
reminder state. Context denials and success/failure responses are private/no-store;
read failures produce a generic 503 with no partial totals.

Counts distinguish documents without a current version, current versions without
an acknowledgement, unlinked employees, versions without verification, rejected
latest verification, expired dates, and upcoming expiry. Missing acknowledgement
or verification is observed evidence state, not a claim that policy requires it.
Unlinked employees are separate from unacknowledged versions. Expired means the
stored DATE is before the UTC reference date; upcoming includes today through
30 days later. Categories may overlap and are not added into a single work total.

Filters select people with the chosen count above zero. Opening a person reuses
the existing drawer and its authoritative document actions. Closing it refreshes
the overview. Failed refreshes clear old totals; cancelled requests cannot replace
newer state. No mutations, reminder scheduling/delivery, model calls, environment
changes or schema changes are added.

The aggregate returns all matching people; server pagination and large-tenant load
certification remain future work. The operational register bundle adds client
display pages/search/navigation and disposable PostgreSQL aggregate proof. New tests inspect parameterized query scope,
evidence joins, allowlists, date boundaries, context failures and UI flows using
synthetic query/HTTP fixtures. Existing document containment tests cover the
dedicated access policy. The bundle executes the aggregate against synthetic
PostgreSQL fixtures; a live production-data smoke test remains unclaimed.

The original document overview was released in PR #413. Main automatically deploys
to production. Subsequent bundled browsing changes remain held in PR #416 until
release authorization.
