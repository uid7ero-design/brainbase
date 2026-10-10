# People register browsing bundle

The People table now reads `GET /api/hr/people/register` with server-side search, employment-status and worker-type filters, 25-row pages and full filtered totals. Search covers names, job titles and team names as literal case-insensitive substrings. Filter changes reset the requested page; a shrinking result clamps to its last available page. The existing `/api/hr/people` API and create/edit forms remain compatible.

## Authority and response boundary

Authentication and the active organisation's HR capability precede view-input validation. Identity, organisation and role come exclusively from the trusted session. The reader matches the existing self/current-direct-manager/explicit-HR policy; only the established super-admin bypass grants role-based HR authority. Ordinary admin roles do not grant HR access. Team and manager joins require the same organisation as the person.

One parameterized statement resolves authority, filtered totals and the ordered page in one database snapshot. Ordering is first name, last name, then ID. Each row exposes only ID, first and last names, job title, worker type, employment status, team name and manager first and last names. Strict projection drops unexpected fields. The response also includes a Boolean `canManage` display flag and validated pagination. Server-side write authorization remains authoritative.

Unknown or duplicate query keys, unsupported filter values, invalid page numbers, control characters and searches over 200 characters are rejected. Responses are private and not cached; serialized UTF-8 output is limited to 256 KiB. Database/capability failures return generic errors without record or database details.

## Screen behavior

Refresh and view changes clear previous rows, totals and management controls while loading. Abort cleanup prevents late responses restoring stale rows or permissions. Failed reads show a generic retry message. Closing the person drawer and existing create/edit save callbacks refresh the register. Browsing does not create or update HR data. Employment and worker values share the existing validation enums without changing their meanings.

People, lifecycle overview, task queue and document assurance share a keyboard-accessible **Reset view** action. It clears each screen's search and filters and returns the requested page to one in a single batched interaction. It remains available while a changed view is loading, empty or failed; resetting aborts the superseded read. It is disabled for the default view. Resetting changes view state only, leaves existing drawers/forms alone and does not cache, persist or mutate HR records.

## Verification and release boundary

- 1,148 HR containment/component tests across 89 files pass, including access failures, response projection, late reads, recovery and separate create/edit callback wiring.
- Four Chromium fixture flows pass for People, lifecycle, tasks and documents. Drawer/form seams are substituted; these checks do not certify real authenticated form submissions.
- Twelve additional cross-register component checks cover combined-filter/page reset, empty/failure recovery and pending-read cancellation. Chromium exercises keyboard activation of reset on every register.
- Disposable PostgreSQL 16 checks execute the actual readers and compare People visibility against the canonical access helpers. They cover active-organisation switching, ordinary admin denial, super-admin scope, malformed cross-organisation relations, manager/grant revocation, literal search, filtered totals, disjoint pages and clamping across 2,000 synthetic people. No production database or real HR records are used.
- TypeScript and changed-file lint pass. Production compilation is checked using an unreachable loopback database URL, without pulling credentials or changing environment configuration.

This bundle requires an exact-head PR/CI review and explicit release authorization before merge. Merging main triggers production deployment. It includes no migration, infrastructure change, environment change or live HR AI call.
