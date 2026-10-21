# LD Tennis recurrence reconciliation: what triggers it (evidence)

Investigated 2026-10-21 against `main` at `1f28c76e`, which is also the current
production deployment (`dpl_EqSNWfrUMZ97sUDGrcgNfbYbazSE`). Read-only: no
database, deployment or configuration was changed.

## Correction to the Phase 1 report

The Phase 1 report said nothing called `POST /api/dashboard/sessions/reconcile`.
That was wrong. It came from a literal-text search for `sessions/reconcile`,
which cannot match the call in `app/dashboard/sessions/page.tsx`, written as the
template literal `` fetch(`${API}/reconcile`, { method: 'POST' }) `` with
`const API = '/api/dashboard/sessions'`. The absence of a literal match was
treated as the absence of a caller, which is the inference this investigation
was asked not to make.

## Every mechanism that can invoke reconciliation

| Mechanism | Evidence | Verdict |
| --- | --- | --- |
| Dashboard page load | `app/dashboard/sessions/page.tsx` ~line 1619: a mount-only effect POSTs `${API}/reconcile`. Covered by `tennisReconcileTriggerStaticCheck`. Production request logs show `GET /dashboard/sessions` then `POST /api/dashboard/sessions/reconcile` 200 about one second later (2026-10-21 09:55:42 and 09:55:43 UTC). | **Active** |
| Session create / edit | `app/api/dashboard/sessions/route.ts` (POST) and `[id]/route.ts` (PATCH) await `reconcileFutureInstances` | Active |
| Restore | `restoreSessionWithCompensation` | Active (manual) |
| Repair button | `generate-instances` route, `repairSession()` in the page | Active (manual) |
| Wrong-weekday auto-fix | page load and session selection POST `generate-instances` when future instances sit on the wrong weekday | Active, narrow |
| Vercel Cron | The Vercel project API reports exactly three production crons: `/api/cron/sync` (02:00), `/api/cron/ticket-email-recovery` (hourly), `/api/cron/hr-employee-document-reminders` (00:15). Vercel crons come only from `vercel.json`; none touches sessions (no tennis/session code in `app/api/cron/**`). | None |
| GitHub Actions | `.github/workflows` has no `schedule`/`cron` trigger | None in repo. Workflows that exist only on other branches or in the GitHub UI were not inspected. |
| External scheduler (cron-job.org, Zapier, uptime pinger) | The route calls `requireRole('manager')`, which needs a signed-in user's session cookie (12-hour lifetime). There is no API-key or cron-secret path. An unattended caller would get 403. | Cannot work against this route as written |
| Database-side job (pg_cron, Neon scheduled task) | Not inspected (Neon was not touched). No such script exists in the repo. | **Unverified** |

What this does not prove: that no one has configured something outside the
repository and the Vercel project that inserts rows directly. It does show that
the application's own reconciliation has no unattended trigger, and that the
only route to it requires an interactive login.

## What it means in practice

- Top-up happens when a manager or admin opens `/dashboard/sessions`. A viewer
  who opens the page gets a 403 on the reconcile call and a warning banner.
- Instances are generated up to 10 weeks (`HORIZON_WEEKS`) ahead of the last
  visit. The public booking list (`/api/tennis/sessions`) shows only 28 days. If
  nobody with manager rights opens the page for about six weeks, the public
  list starts to thin out and eventually empties.
- That risk existed before this work and is unchanged by it. It is a dependency
  to carry forward, not a bug to fix in the legacy stack: the replacement should
  have an unattended trigger (a cron route authenticated by a secret), keeping
  the page-load call as a backstop.

## Evidence limits

Production request logs were read with the Vercel CLI for the last 24 hours only
and contain a single cluster of activity, so they confirm the trigger fires but
say nothing about frequency over time. The MCP Vercel connector was not granted
access to the team; the CLI (authenticated as the account owner) was used
instead, read-only.
