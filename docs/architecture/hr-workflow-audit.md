# HR workflow audit and verification backlog

This is an initial evidence inventory, not a declaration that the whole HR product is complete. Operational registers and drawer recovery were released in PRs #423 and #424. The next audit covers document management, lifecycle execution and HR administration, with restricted-case and reminder operations tracked separately. Source inspection and fixture tests cannot certify every authenticated browser-to-database workflow.

## Administration recovery bundle

Teams previously retained `canManage` after a failed People/context read, and a network exception could leave either administration page loading indefinitely. Teams and Administrators now clear loaded rows, selections/confirmation state and management permission before reading. Read failures are generic, old response bodies are not echoed, strict Boolean permission/candidate flags are required, requests use client no-store caching and abort cleanup, and each page has Refresh. Teams commits its team list and People/context list together only after both reads succeed. An open Team draft is preserved, but its submit button and handler require current management permission. Every real write remains subject to the existing API authorization.

The existing create/edit/archive/restore/grant/revoke endpoints and write payloads are unchanged. This bundle does not certify uncertain mutation outcomes or automatically retry writes.

## Evidence and next work

| Area | Existing implementation/evidence inspected | Remaining verification work |
| --- | --- | --- |
| HR administration | Dedicated administrator GET/POST/DELETE routes use `canManageHrAccess`; archived Teams require HR authority; writes check current context. Static containment tests preserve explicit candidate selection and existing endpoint wiring. New components and Chromium exercise denial/failed refresh/recovery. | Exercise create/edit/archive/restore and grant/revoke through real route handlers against disposable Postgres, including revocation during a pending action. Audit rejected network promises and unknown mutation outcomes in these UI actions. |
| Document management | Drawer implements creation, versions, deletion, version history, acknowledgement and verification. Document access helpers distinguish linked employee/HR from direct-manager lifecycle access. Existing component/containment tests cover document capabilities/actions; real-drawer Chromium proves document-denial handling. | Browser-to-route-to-disposable-database proof of upload/version/delete/acknowledge/verify, including current-version races, permission revocation and uncertain writes. Storage/provider calls must remain isolated fixtures. |
| Lifecycle execution | Drawer implements start/cancel, task actions and approval/rejection. Mutation services use transaction/advisory-lock and writable-CTE audit boundaries. Existing containment/components cover templates and document/lifecycle interaction; disposable register proof verifies canonical read authority. | Actual mutation integration proof for competing task transitions, approval races, audit rollback and refreshed rendered capabilities. Do not infer execution/approval rights from queue visibility. |
| Restricted cases and reminders | Separate restricted-access/document and reminder scheduling/recovery/delivery modules exist. Their presence does not establish a complete product workflow. | Separate scoped audit. No automatic reminder delivery, real email, restricted-data read or production/provider action is authorized by this development bundle. |

Across these areas, further missing proof is a verification gap, not automatically a demonstrated backend defect. No schema, record, provider or production changes are performed by this audit bundle.

## Validation limits

The administration browser flows execute the real pages with synthetic HTTP responses and require GET-only traffic. They cover loaded management controls, denied refresh, old-row/control clearing, generic messages and successful refresh recovery. Component checks additionally cover malformed flags, People/context-only failure, abort/unmount/late responses, cleared explicit grant selection and preserved-but-disabled Team drafts. Existing static assertions were updated to recognize abort options and strict Boolean flags without weakening endpoint/authority requirements.

Prior broader HR tests and new focused checks do not replace the outstanding authenticated mutation proof above. This audit remains ongoing. New code requires exact-head PR checks and separate release approval; approvals for #423/#424 do not authorize this follow-up's automatic production deployment.
