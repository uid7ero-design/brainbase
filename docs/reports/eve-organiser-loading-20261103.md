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
