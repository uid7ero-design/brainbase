# Eve organiser loading investigation — 3 November 2026

## Live finding

Login is confirmed working by the owner after the existing Brainbase organisation was enabled on Eve. Its two test events were returned to draft first, as explicitly authorised. This performance change does not touch that setting or any saved event.

Vercel production function-duration averages, last hour ending approximately 08:23 UTC, queried with the authenticated CLI using explicit team/project and production scope:

| Eve route | Average server duration |
| --- | ---: |
| /organiser | 3464 ms |
| /organiser/orders | 3314 ms |
| /organiser/attendees | 2891 ms |
| /organiser/events | 1551 ms |
| /organiser/settings | 1079 ms |
| /organiser/payments | 727 ms |

Brainbase backend averages queried in the following minute: `/api/ticketing/auth/session` 1489 ms; `/api/ticketing/organiser/events` 1679 ms. These are sparse recent server averages, not browser navigation timings or a controlled benchmark. No user credentials, session tokens, attendee records or order data were read for this investigation.

Every organiser page first awaits `requireOrganiser()`, then its authenticated data reads. The dashboard additionally awaited orders before starting attendees for each event. Payments and Settings already parallelise their independent data reads. All organiser pages lacked a segment loading boundary.

The production aliases resolve to Eve `dpl_CroK3zTGmq8CLsTLfo1vQsaaJ5Rw` and Brainbase `dpl_CXmGiuqcKVUE7pEZrzm3TWeVU7Lh`, both source `1228f83db1b1612ec35e98afbd81513d25425e44`. Both deployment records report `iad1`; one Eve runtime entry reported `syd1`. The established production database is in `aws-ap-southeast-2`. The metadata/log discrepancy prevents a definitive claim about the full execution topology. Cross-region database traffic is a plausible contributor, not an isolated measured cause. No hosting regions were changed.

## Bounded local change

- Dashboard starts orders and attendees together for each event, retaining its existing 25-event cap, totals, role/tenant checks and failure handling. This removes one unnecessary sequential wait per event; it does not remove the initial session/events dependency or reduce total request count.
- A static organiser loading boundary announces `Loading Eve…` and displays neutral placeholders while protected pages resolve. No identity or event information is shown in the fallback. It does not promise an instant transition before Next has prefetched the boundary.

The shared backend and every existing authorisation check remain unchanged. This patch is an incremental improvement, not a claim that the remaining approximately three-second tab delay has been eliminated.

## Validation and release limit

- All 367 Eve tests passed in 13 files. Added deferred-promise regression verifies that attendees start while orders are unresolved, unchanged totals excluding cancellations, and refusal when parallel reads report revoked access. Loading status rendering is also covered.
- Eve typecheck, lint and production build passed.
- Existing local dependencies were reused through isolated worktree junctions. Build output identifies Next 16.2.4; the current package manifest requests 16.4.3. A clean dependency install/CI with the manifest version is still required for release acceptance. No dependencies or lockfiles were modified.
- No authenticated browser timing or visual acceptance was completed for this local patch. Live metrics provide pre-change server evidence only.
- No push, merge, production deployment, region change, public event publication, social approval or scheduling in this performance batch.

Next performance work should measure individual upstream/database spans and consolidate the session/initial-data path while preserving per-request revocation and tenant validation. A Sydney-region deployment rehearsal for the ticketing backend is a separate option after verifying the execution-region discrepancy and deployment scope.

## Follow-up optimisation candidate

The owner requested a deeper optimisation pass after the initial loading patch. This section supersedes the earlier dependency-validation limitation and describes the final local candidate.

### Changes

- `/api/ticketing/auth/session?include=events` returns current identity and an explicit allow-listed event list in one freshly authorised, rate-limited request. `include=overview` adds bounded dashboard counts. Plain session requests keep their old response shape. Unknown include values do not widen the response.
- Dashboard, Events, Orders, Attendees and Check-in use that initial workspace response. A missing workspace field from an older backend follows the existing authenticated path, allowing staggered deployment; an explicit empty list is preserved. Denied authorisation never triggers a legacy fallback.
- Dashboard no longer downloads and regroups up to 50 lists containing purchaser, attendee or registration-response data to calculate four totals. One tenant-scoped aggregate query counts the same non-cancelled, order-item-backed orders and attendees, including refunded/other non-cancelled states just as before. Its event IDs come from the authorised event list, capped at the established 25. Missing/malformed/unsafe counts fail rather than becoming guessed zeroes.
- The event list selects only its public-to-organiser projection. Independent session and ticket-type counts avoid multiplying their rows together. Both are organisation-scoped.
- User/session-liveness and organisation reads start together after token verification. The existing user, session, organisation, tenant, role, Events entitlement and Eve enablement decisions remain request-local and unchanged. Capability checks remain canonical; no cross-request authorisation cache was introduced. A database error still denies access.
- The super-admin organisation switcher loads its choices only when requested, removing its mount-time request on every tab. The backend still decides eligible choices and revalidates every switch. Load/switch failures now leave recoverable controls and a clear message.
- The first-pass loading boundary and parallel legacy dashboard fallback remain included.

### Request-count evidence

| Page data | Existing path | Candidate path |
| --- | ---: | ---: |
| Dashboard with 25 events | 52 upstream reads | 1 |
| Events | 2 | 1 |
| Check-in initial view | 2 | 1 |
| Orders | 3 | 2 |
| Attendees | 3 | 2 |

The switcher's former additional browser request is separate from those page-data counts and now occurs only on demand. Payments, Settings and payment detail retain their existing loaders, but receive the common authorisation-read concurrency improvement.

### Verification

- Clean `npm ci --ignore-scripts` from the unchanged Eve lockfile was installed in a separate temporary validation tree. Exact Next **16.4.3** production build, type checking during build and lint pass. Original shared dependency junctions were retained. The initial attempted junction replacement was blocked before any change; the separate validation copy avoided that operation.
- Eve's full 374-test suite passed after the workspace/switcher changes; the final switcher network-recovery addition passed its three-test focused suite (375 unique Eve tests covered overall). No test skip. Backend ticketing/Eve regression suite: **431 passed in 19 files**, including real disposable PostgreSQL session, rate-limit, allow-list, payment/settings and count tests where selected by the suite.
- Whole-repository `tsc --noEmit --incremental false` and focused backend/harness ESLint passed using the existing root dependencies. This is not a clean production build of the entire Brainbase app; remote CI remains a release gate.
- Deferred-promise test proves both authorisation reads start before either completes and the next request refuses a revoked session. New workspace route tests cover denied access, unknown includes, projection restrictions, rate-limit failures and database failure without fabricated totals.
- Real disposable PostgreSQL verifies dashboard totals with multiple order items, cancellations, refunds, orders with no items, foreign-tenant IDs and invalid cross-tenant references; empty selections and the 25-event cap; independent event/session/ticket-type counts. No production data copied into those fixtures.
- Read-only EXPLAIN ANALYZE of the new event-list query on the established production organisation: **0.095 ms database execution** for the current five-event dataset, using the organisation event index. This is one small warm-data sample, not a scalability benchmark or total endpoint timing. No schema/index changes were needed or made.
- `node scripts/tests/verify-eve-workspace-local.mjs <clean-app-root>` passed against the production-built Next 16.4.3 app and a localhost-only API fixture. It exercised same-origin login, HttpOnly/SameSite cookie response, five protected routes, missing-session redirect, revoked-session redirect and disabled-Eve redirect. Dashboard/Events/Check-in each made one upstream request; Orders/Attendees each made two. Fixture timings were 96–104 ms and 168–178 ms with an injected 60 ms per API response; these are **not live-site speed measurements**. No real credentials, sessions, customer data, provider or database were used by this harness.
- Next's loading boundary can stream HTTP 200 before emitting its sign-in refresh instruction. The harness recognises that real streaming behaviour as well as an HTTP redirect; it does not mistake streamed sign-in redirects for authenticated success.

### Release boundary

Local candidate only. No push, merge, public deployment, region change, database migration or data write in this optimisation pass. Releasing the full improvement changes **both Eve and the shared Brainbase ticketing backend**. Backend-first deployment is preferred, though the frontend supports the older backend during rollout. Production speed and authenticated browser acceptance must be measured after an approved release; the local fixture timings do not establish them.

## Authorised release gates — 3 November 2026

The owner authorised release tonight or tomorrow after gates 1–4 pass, with post-live smoke under two organisations. Independent read-only agent audit found no security defect and confirmed all four gates after the following evidence additions:

1. Real PostgreSQL fixture now asserts **both** A and B totals and event lists against the same mixed data, including invalid cross-tenant references.
2. Either parallel database read failing independently returns 503 and prevents further permission/data processing. Revoked sessions and all earlier denial cases remain covered.
3. Production-built local HTTP harness switches A→B through the real Eve relay, verifies a replacement cookie, checks B's identity on all five requested pages and B's different dashboard total, then verifies the previous session is refused. It is controlled fixture evidence, not the post-live browser test.
4. No schema or migration files are changed. No production database operation is required: no migrate/reset/drop, no table deletion and no migration backup requirement triggered. Test DDL/truncation occurs only in disposable localhost PostgreSQL.

Rebased candidate onto current main **e490f4ba439fcf021185d0eb32ee5c51d87c2635**, retaining the newer LD Tennis client changes. Pre-release production aliases were both READY at that commit:

- Eve project `prj_wrOFEl9HxxbVLlXN9VBHA5ExIoa8`: rollback deployment `dpl_GKwhR47DM38L23fJGnP7Mk5YCW4C`.
- Brainbase project `prj_6WnZrDXumaQzpfR63awLy2CWTxJE`: rollback deployment `dpl_2uap9DxovugxKrqwDKJAoyJE4yiU`.

Rollback: use the authenticated Vercel project rollback operation to those existing artifacts, verify both custom-domain aliases and signed-out/authenticated smoke. No database reversal is needed. Target approximately 2–5 minutes to switch traffic plus verification within 10 minutes; these are planning estimates, not a guaranteed RTO. Re-read active aliases immediately before merge and update these targets if an unrelated release advanced them.

Merge only the final verified PR head after required CI and both preview builds pass. Post-live verification must distinguish browser navigation/RSC requests (Network panel) from hidden Eve→Brainbase requests (server telemetry). Browser Network alone cannot establish 52→1 server-call reduction. Do not widen another organisation's Eve enablement solely to manufacture the smoke test.
