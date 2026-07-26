# Phase 0.5 Deployment Checklist

This checklist covers everything that must be configured, verified, and watched when deploying the Phase 0.5 emergency security containment changes. It does not cover Phase 1+ work.

---

## 1. Required environment variables

| Variable | Format / example (no real values) | Required for |
|---|---|---|
| `ADMIN_SEED_SECRET` | A long random hex string, e.g. `ADMIN_SEED_SECRET=8f2c...` (generate with `openssl rand -hex 32`) | Bootstrapping a fresh environment via `POST /api/admin/seed` |
| `METRICS_ALLOWED_HOSTS` | Comma-separated **bare hostnames only** — no scheme, no path, no port, no credentials, no wildcard. Example shape: `METRICS_ALLOWED_HOSTS=status.example.com,metrics.example.org` | The `/api/metrics` custom-widget SSRF guard |
| `GMAIL_OWNER_ORG_ID` | The literal `organisations.id` (a cuid string) of the org that owns the single shared Gmail connection, e.g. `GMAIL_OWNER_ORG_ID=ckv2x...` | Gmail integration routes (6 routes) |
| `GCAL_OWNER_ORG_ID` | Same format, for the org that owns the shared Google Calendar connection | Google Calendar integration routes (4 routes) |
| `SPOTIFY_OWNER_ORG_ID` | Same format, for the org that owns the shared Spotify connection | Spotify integration routes (6 routes) |
| `CRON_SECRET` | A long random string, e.g. `CRON_SECRET=9a4e...` (already existed; behaviour changed this round — see §7) | `/api/cron/sync` — **now required**, the endpoint refuses every request if this is unset |

> **⚠️ Do not set `METRICS_ALLOWED_HOSTS` to a wildcard, a bare top-level domain intended to cover many subdomains you don't control, or anything broader than the exact hostnames actually in use.** The allowlist match is exact-or-subdomain (`example.com` also matches `status.example.com`), which is already permissive — a wildcard or an overly broad domain defeats the containment entirely. If you don't yet know the exact hostname(s) in use, see §2.

## 2. What we could not determine for you

The `/api/metrics` widget's URLs are stored entirely client-side, per-browser, in `localStorage` (`components/layout/LeftSidebar.jsx`, key `brainbase:metrics`) — there is no server-side record of which hostnames are actually in use, and the shipped default config has empty URLs. **We cannot supply you a real hostname list from static analysis.** Before setting `METRICS_ALLOWED_HOSTS`, either:
- ask whoever actively uses the widget which hostname(s) they've configured, or
- temporarily deploy with the allowlist unset (the widget will show `--` for every metric, fully blocked but safe) and check server logs for the first genuine `host_not_allowlisted` rejections, then add exactly those hostnames.

## 3. Required staging tests (before this ships to production)

Run all of these against a **staging** environment, not production:

1. `npm test` — all containment tests green (107 at time of writing).
2. `npx tsc --noEmit` and `npx next build` — both clean.
3. With `GMAIL_OWNER_ORG_ID` / `GCAL_OWNER_ORG_ID` / `SPOTIFY_OWNER_ORG_ID` **set** to a real staging org: confirm a manager in that org can still connect/read/control each integration, and a manager from a **different** org gets 403.
4. With `METRICS_ALLOWED_HOSTS` set to a known-safe test hostname: confirm the widget still resolves a value, and confirm a different, non-allowlisted hostname is rejected.
5. Confirm the admin pipeline booking flow (`/admin/pipeline`) still creates bookings end-to-end for a real staging pipeline request, with no `org_override` cookie ever touched (check dev tools → Application → Cookies during the flow).
6. Confirm `/api/cron/sync` returns 401 with no `Authorization` header, and 200 with the correct `Bearer $CRON_SECRET` header, against staging.
7. Confirm `POST /api/admin/seed` returns 403 without `ADMIN_SEED_SECRET` configured, and works exactly once with it configured and the correct `x-seed-secret` header.
8. If your team still uses the legacy Instagram connect flow: connect a **test** Instagram/Facebook account in staging and confirm the feed still loads (proves the new encrypted-write + decrypt-on-read path works end to end).
9. Full authenticated smoke-test matrix — see the separate matrix provided in this round's completion report.

## 4. Rollback steps

All Phase 0.5 changes are additive auth/validation checks on existing routes plus a small number of new files — nothing destructive. If a specific fix causes a production issue:

- **Any single route file**: `git revert` the specific commit, or `git checkout <previous-commit> -- <path>` for that one file. Each route change is independent except `app/admin/pipeline/page.tsx` and `app/api/admin/pipeline/[id]/booking/route.ts`, which must be reverted together (the page no longer calls `/api/bookings` for this flow at all).
- **Env-var-gated features** (metrics, Gmail/GCal/Spotify, admin/seed): if a fix is too aggressive, the fastest mitigation is *widening the specific env var* (e.g. adding a hostname to `METRICS_ALLOWED_HOSTS`, or double-checking the owner-org ID is correct) rather than reverting code — these are config-first controls by design.
- **Cron**: if `CRON_SECRET` was never set in production and integrations stop syncing after this deploy, set `CRON_SECRET` and update the Vercel Cron configuration to send the matching `Authorization: Bearer <secret>` header — do **not** revert the fail-closed fix itself.
- **Test/build infra** (`vitest.config.ts`, `tests/`, the `vitest` devDependency): fully removable independently with no effect on runtime behaviour.

## 5. Post-deployment checks

Within the first hour after deploying:

- [ ] Confirm `/api/cron/sync`'s next scheduled run (check Vercel Cron logs) completes with 200, not 401.
- [ ] Confirm no spike in 403/401 responses on `/api/integrations/gmail/*`, `/gcal/*`, `/api/spotify/*` beyond what's expected from the owner-org restriction (a spike here means a legitimate manager lost access and `*_OWNER_ORG_ID` needs adjusting).
- [ ] Confirm the `/dashboard` LeftSidebar metrics widget either shows real values (if `METRICS_ALLOWED_HOSTS` is configured) or shows `--` cleanly (if not) — should never show a raw error or crash the page.
- [ ] Spot-check one real admin-pipeline booking end-to-end.
- [ ] Confirm `POST /api/admin/seed` still correctly refuses (403) if hit unexpectedly (it should never succeed in an environment that already has users).
- [ ] Watch logs for `[cron/sync] CRON_SECRET is not configured` — if this appears, cron is silently disabled in production.

## 6. Known temporary risks (carried forward, not resolved by this round)

- Gmail/GCal/Spotify tokens remain in a **single global file per service**, not per-organisation — the owner-org restriction is containment, not the final architecture.
- The legacy Instagram flow's OAuth login (`connect`/`callback`) still has **no CSRF `state` parameter**, unlike the newer `social/connect` flow and unlike the Gmail/GCal/Spotify fixes made in earlier Phase 0.5 rounds. This was out of this round's explicit scope; flagged for a follow-up.
- Existing `social_connections.access_token` rows written **before** this round's fix remain plaintext at rest; only new writes are encrypted. A migration to re-encrypt historical rows is a tracked follow-up, not performed here.
- The `service_requests` schema collision identified in the Phase 0 baseline report remains unresolved (explicitly out of scope for Phase 0.5).
- In-memory rate limiting remains non-distributed across serverless instances.
- The pipeline-booking transaction (`/api/admin/pipeline/[id]/booking`) has been verified via mocked automated tests only in this session — see the disposable-database verification plan in the completion report for what real database verification would additionally require, and note that it has **not yet been executed** against a real Postgres instance.
