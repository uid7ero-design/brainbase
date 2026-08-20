# BrainBase Current Production State — 2026-08-20

This checkpoint documents the verified state of `origin/main` as of 2026-08-20 (HEAD `bbd376f`), after the recent LD Tennis, Founder OS, HLNA privacy, Resend, and Command Centre work. It is documentation only — no application code, database state, or deployment was changed to produce it. Protected/non-runtime directories (`Clients/`, `Cardijn/`, `Dashboards/`, `Files/`, `Schedules/`, `Waste Intelligence Dashboard/`, `data-import/`, `backend_migration/`, and other personal/client working files) were not inspected, modified, moved, deleted, or included as part of this checkpoint.

## 1. Production Architecture

- The root BrainBase Next.js application (this repository) is the Production runtime — there is no separate cloned app per client.
- Multi-tenant organisation model: every tenant-scoped table carries `organisation_id`, and every route enforces it server-side.
- Neon PostgreSQL is the database (raw SQL via `lib/db.ts`, `@neondatabase/serverless`, alongside Prisma for schema definition).
- Vercel is the deployment target (Preview + Production).
- Dashboards are organisation- and role-scoped: `lib/dashboard/clientDashboard.ts` resolves which dashboard variant an organisation (and, for the owner org, role) sees at `/dashboard`.
- LD Tennis runs on the root BrainBase application — it is a dashboard variant (`ld-tennis`) resolved by organisation slug, not a separately cloned client app.

## 2. Current Production Organisations / Routing

Verified in `lib/dashboard/clientDashboard.ts` (`dashboardVariantForSlug` / `resolveDashboardVariant`):

- Brainbase organisation + `super_admin` role → `/dashboard` resolves to the `brainbase-hq` variant, which redirects to the existing Founder OS route at `/admin/founder`.
- LD Tennis organisation → `/dashboard` resolves to the `ld-tennis` variant (the LD Tennis day-overview dashboard).
- Command Centre remains a separate, standalone route at `/command` — it is not part of the `/dashboard` resolver and was not changed by the Founder OS routing work.
- Any other organisation, and any Brainbase-org user below `super_admin`, falls through to the generic BrainBase shell — resolution is entirely slug- and role-based, with no hardcoded user IDs anywhere in the resolver.

## 3. LD Tennis Session Platform

Confirmed present in `lib/tennisSchedule.ts`, `app/api/dashboard/sessions/**`, and `app/dashboard/sessions/page.tsx`:

- Session types (`app/api/dashboard/session-types/route.ts`, `.../[id]/route.ts`) with an optional per-session label distinct from the primary Session Type.
- Per-session colour overrides (`session_colour_key`, resolved with session-override → type → fallback precedence).
- Week/Month calendar views, bounded by `date_from`/`date_to` range queries.
- Schedule rules: `day_of_week`, `start_date`, `end_mode` (`ongoing` / `after_weeks` / `on_date`), `end_after_weeks`, `end_date`.
- Ongoing reconciliation horizon: a rolling `HORIZON_WEEKS = 10` window from "today," maintained by `reconcileFutureInstances()`.
- Repair ("Repair future dates"), Edit, and Delete actions on sessions (`GET`/`PATCH`/`DELETE` on `app/api/dashboard/sessions/[id]/route.ts`).
- Archive/restore lifecycle (`app/api/dashboard/sessions/[id]/archive/route.ts`, `.../restore/route.ts`, `archiveSessionAtomically()`, `restoreSessionWithCompensation()`).
- Archived sessions hidden from Manage Sessions by default, with a "Show archived" toggle.
- Safe future-instance cancellation on archive: disposable (unpaid, no attendance) future instances are cancelled; historical instances/bookings are never touched.
- Protected paid/attendance-bearing future instances are left scheduled and reported as conflicts rather than force-cancelled.
- Restore reconciliation regenerates future dates from the session's existing schedule rules, with compensating rollback (`archived_at` restored to its exact prior value) if reconciliation fails after the archived state was cleared.
- Cancelled-instance reactivation fix: reconciliation (used by Restore, Repair, Create/Edit save, and the org-wide top-up alike) now reactivates a stale `cancelled` `session_instances` row in place — rather than leaving it permanently invisible on the calendar — when the unique `(session_id, date)` index blocks a plain insert and no protected booking exists on that row.
- Audit logging for successful `session.archive` and `session.restore` events, via the existing `audit_logs` table, with counts/timestamps only (no contact PII, no booking/payment detail).

Production schema (confirmed applied to the live Production database):

- `sessions.archived_at timestamptz NULL` (`NULL` = active, non-`NULL` = archived)
- `idx_sessions_archived_at` on `(organisation_id, archived_at)`

The additive, idempotent migration defining this schema is checked into the repository at `scripts/add-session-archive.sql` (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, no backfill, documented rollback).

## 4. LD Tennis Booking / Recurrence

Confirmed present in `lib/tennisRecurrence.ts` and `app/api/dashboard/enrolments/**`:

- Once and Weekly enrolment paths, both writing to `bookings`.
- Recurring group support via `recurring_group_id`, shared across a lineage's bookings.
- Weekly propagation into newly generated future instances (`propagateRecurringEnrolment`, `enrolActiveLineagesIntoNewInstance`, `getActiveRecurringLineages`).
- Player-level pause/resume via `booking_recurrence_pauses` (`loadPauseWindows`, `isDateWithinAnyPause`), enforced in `app/api/dashboard/enrolments/[id]/pause/route.ts`.
- Duplicate-enrolment protection (`findDuplicateEnrolment`, `normalizeEmail`) preventing the same identified person from double-booking the same class.
- Weekly → Once future-cancellation behaviour via `app/api/dashboard/enrolments/remove-future/route.ts`, matching by `recurring_group_id` where available, with a name/email fallback for legacy pre-feature rows.

**CLASS-WIDE / SCHOOL-HOLIDAY PAUSE IS NOT YET IMPLEMENTED.** Pausing today is per-player only.

## 5. LD Tennis Dashboard

Confirmed present in `components/dashboard/TennisDashboard.tsx` and `app/dashboard/page.tsx`:

- Adelaide-local greeting and date (`greetingLine`/`currentAdelaideHour` from `lib/dashboard/greeting.ts`).
- KPI row: Today's Sessions, New Leads, Follow-ups, Open Leads.
- Today's Schedule panel.
- Needs Attention panel.
- Lead Trend chart (with a compact empty state when there is no data, rather than an empty chart canvas).
- HLNA Insight card.
- Weather panel.
- Tennis News panel (capped to 4 visible items by default).
- Recent Activity panel.

"Open Leads" replaced the previous "Active Clients" label — the underlying calculation and data source are unchanged; only the label was corrected to describe what the number actually represents.

## 6. Founder OS

Confirmed present in `app/admin/founder/page.tsx`, `app/api/admin/founder-intelligence/route.ts`, and `app/dashboard/page.tsx`:

- Founder OS is now the Brainbase HQ default dashboard for Brainbase-organisation `super_admin` users, reached via `/dashboard` → redirect → `/admin/founder`.
- The direct `/admin/founder` route is unaffected and continues to work exactly as before, independently re-checking `super_admin` in `app/admin/layout.tsx`.
- Command Centre (`/command`) remains a fully separate route, untouched by this routing change.
- The `founder-intelligence` API response now carries an explicit `source: 'live' | 'demo'` field; the Founder OS page surfaces a demo-data banner (reusing the existing banner treatment) whenever `source === 'demo'`, and no longer shows an unconditional "All systems operational" claim that had no real health check behind it.
- Per the `fix(dashboard): make Founder OS the Brainbase HQ default` commit's own trace notes: the external founder intelligence backend (a DigitalOcean app referenced via `NEXT_PUBLIC_API_URL`) was found unreachable from the environment that commit was authored in (DNS did not resolve), while `founder-state`/`founder-clients` were confirmed to fail closed to an honestly-empty response rather than fabricating data when that backend is unreachable. Whether that backend is currently reachable from Production has not been independently re-verified for this checkpoint.

## 7. Command Centre

Confirmed present in `app/command/page.tsx`:

- Retained for demonstrations/testing — it is not being removed or hidden.
- A single global "Demo Environment" indicator in the page's own breadcrumb bar.
- The Operational Alerts grid (a static, non-fetched constant) carries its own "DEMO" tag, since it renders in the same panel as the real, API-backed Client Requests section.
- The elapsed-time ticker in the toolbar now reads `Demo · Xs ago` (previously "Updated Xs ago") — it has always been a local `setInterval` counting seconds since mount, never a real refresh timestamp.
- Live/API-backed sections (the Waste/Kerbside/Illegal Dumping KPI tabs, the Client Requests panel backed by `/api/admin/pipeline`, and `/api/ops/alerts` action handling) are unchanged and are not the subject of the DEMO labelling.
- Not every panel on this page is live — the "recent changes" and suggestion-prompt widgets remain static sample content, covered by the single global indicator rather than individually labelled.

## 8. HLNA / AI Privacy

Confirmed present in `app/api/hlna/briefing/route.ts`:

- The HLNA briefing's overdue-contact context (`tennisSnapshot()`) is aggregate-only: the query backing it selects only `last_contacted_at` (`LIMIT 1`, oldest first) — no name, email, phone, or address column is read at all.
- The prompt sent to OpenAI is built from that aggregate age/urgency signal (e.g. "N contacts need attention..., oldest N day(s) since last contact"), not a name list.
- The other module snapshots feeding this same briefing (waste, fleet, service requests) were already aggregate-only (suburb names, vehicle IDs, totals) and were not changed by this fix.
- Every query in this route remains scoped by `organisation_id`.
- The safe-fallback path (`fallback()`) and the response shape consumed by `HlnaInsightCard.tsx` are unchanged.

This checkpoint does not claim every AI-integration route in the repository has been audited for PII — only that `app/api/hlna/briefing/route.ts` (the route this round specifically traced and fixed) is confirmed clean.

## 9. Resend / Email Runtime

Confirmed present in `lib/resendClient.ts` and the four routes that previously constructed a Resend client at module scope:

- Module-scope `new Resend(process.env.RESEND_API_KEY)` was removed from `app/api/admin/pipeline/[id]/messages/route.ts`, `app/api/lead/route.ts`, `app/api/leads/[id]/route.ts`, and `app/api/request-demo/route.ts`.
- `lib/resendClient.ts` provides a single lazy, memoized `getResendClient()` — the Resend SDK client is now constructed on first actual use inside a request, never at module import time.
- Because Vercel Preview environments do not have `RESEND_API_KEY` configured (Production does), Preview builds no longer fail during Next.js's build-time route-collection step merely for lacking that key — confirmed by a Preview-like local build (`RESEND_API_KEY` unset, `.env.local` untouched) completing successfully with no "Missing API key" error.
- `lib/email.ts` (the separate, pre-existing fetch-based helper used for auth/lead-notification emails) was not touched — this fix did not introduce a second email subsystem.
- Production email configuration remains entirely environment-driven (`RESEND_API_KEY` set in Vercel Production env, not in this repository).

## 10. LD Tennis Domain / DNS

Recorded as known operational state on 2026-08-20 (not independently re-verified against a live DNS/registrar query as part of this checkpoint):

- `ldtennis.com.au` DNS is hosted in AWS Route 53.
- The root A record points to the current Vercel IP target.
- The `www` record uses the current Vercel CNAME target.
- Resend DNS records have been added:
  - DKIM TXT at `resend._domainkey`
  - MX at `send`
  - SPF TXT at `send`
  - DMARC TXT at `_dmarc`

**Resend domain verification status for `ldtennis.com.au` is not confirmed complete as of this checkpoint** — the records above have been added, but verification was pending/being checked, not confirmed passed. No DKIM key material or other secret values are recorded here.

## 11. Database / Migration Safety

- Production changes go through governed, manually reviewed SQL migrations — not ad hoc schema edits.
- `prisma db push` must never be used against Production.
- The archive schema migration (Section 3) is additive and idempotent (`IF NOT EXISTS` throughout, no backfill, documented rollback) and is confirmed applied to Production.
- This checkpoint makes no database changes of any kind.

## 12. Known Issues / Remaining Work

- Class-wide/school-holiday pause is not yet implemented (per-player pause only).
- Per-business email sender/reply-to configuration for LD Tennis is not yet finalised.
- Resend domain verification for `ldtennis.com.au` needs to be confirmed complete.
- A broader, reusable onboarding/template flow for new tennis businesses (beyond LD Tennis specifically) does not yet exist.
- Real, currently-present lint debt on `origin/main` (confirmed via `eslint`, not inherited from any of this round's own changes):
  - `app/admin/founder/page.tsx` — one `react-hooks/set-state-in-effect` error plus several unused-eslint-disable-directive warnings.
  - `app/command/page.tsx` — three `react-hooks/set-state-in-effect` errors (URL-param tab restore, layout localStorage restore, CRM localStorage restore, all inside effects with empty dependency arrays).
- Founder OS's external intelligence backend (a DigitalOcean app referenced via `NEXT_PUBLIC_API_URL`) was found unreachable from the environment used to build that feature; whether it is currently reachable from Production is unresolved as of this checkpoint.

## 13. Production Validation Completed

- **LD Tennis session archive/restore/reconciliation**: validated against an actual reported Production incident (a Sunday session that archived cleanly but, after restore, was missing its next two calendar occurrences because a stale cancelled `session_instances` row silently blocked reconciliation). Root-caused, fixed at the shared reconciliation layer, and covered by new regression tests reproducing the exact scenario (multiple future cancelled dates, protected-booking conflicts, cross-org scoping, Repair and Restore sharing the fix) — all passing.
- **Founder OS default routing, LD Tennis dashboard isolation, HLNA zero-state/no-PII behaviour, and Command Centre demo labelling**: each validated via dedicated automated regression test suites written against the actual route/component code (including one HLNA test that captures the real outgoing OpenAI request body to prove no name is present), plus a full `npx vitest run`, `npx tsc --noEmit`, and `npm run build` pass on the merged `origin/main` state. This is automated test and build validation, not a manually driven live-Production click-through, except for the archive/restore item above.
- **Resend Preview fix**: validated by a successful Preview-like local build with `RESEND_API_KEY` unset, reproducing and confirming the fix for the exact previously-reported Preview failure.

## 14. Immediate Recommended Next Steps

1. Confirm Resend `ldtennis.com.au` domain verification.
2. Finish LD Tennis sender/reply-to email configuration.
3. Implement class-wide school-holiday pause.
4. Design a clean new-organisation onboarding/template flow.
5. Continue the architectural/data-governance roadmap incrementally.
