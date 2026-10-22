# Scheduling Phase 2B.1: capability, access and configuration layer (plan only)

Status: **plan for review. Nothing here is built.** It refines section "2B.1" of `scheduling-phase2b-plan.md` after the
Phase 2B.0 review (`scheduling-phase2b0-foundation.md`, PR #470). It records two owner decisions made on 2026-10-23:

1. **`scheduling_settings` is created explicitly during organisation enablement**, never implicitly by a request, a
   migration or the capability file.
2. **Customer-identifying details in Scheduling audit entries are visible only to managers and administrators.**

No SQL is run on Production by an agent. LD Tennis is not touched. The module stays disabled for every organisation.

## 1. Starting point (already merged or staged by 2B.0)

- `lib/scheduling/access.ts`: `authorizeSchedulingRequest(permission)` = authenticated DB-backed session, then
  `requireCapability(org, 'scheduling')` (403 on denial, 503 if undeterminable), then `permissionsForRole`, then a
  `TenantContext`. Organisation comes from the session only. No route calls it yet.
- `permissionsForRole`: viewer = `scheduling.view`; manager, admin, super_admin = view-manage-reserve-attendance;
  analyst and unknown roles = nothing (fail closed).
- Capability registration (`120`) creates the `scheduling` module and **no entitlement**; the CRM link (`130`) is a host
  function. Both are owner-run on Production, separately approved.

## 2. Scope of 2B.1

| # | Item | Notes |
| --- | --- | --- |
| a | `lib/scheduling/runtime.ts` | `createPostgresScheduling` over `lib/db`; a test proves the Neon HTTP driver works through it (the 2A driver matrix is the model). `@scheduling/core` stays host-free. |
| b | Route guard | Every `app/api/scheduling/**` handler obtains its context from `authorizeSchedulingRequest`. A containment test fails the build for a scheduling route that does not, or that reads an organisation id from the body, query or path. |
| c | Reduced read shape for `viewer` | Applied in the server read layer, not the UI. Viewers get no customer-identifying fields. |
| d | Organisation configuration | Read `organisations.timezone` (fallback `Australia/Adelaide`); deliberately update `organisationTimezoneSchema.test.ts` when the first reader lands. |
| e | Explicit `scheduling_settings` creation (section 3) | Part of enablement, not of requests. |
| f | Audit logging (section 4) | Reuses `audit_logs`; no new schema. |
| g | Fail-closed test matrix | See section 5. |

Out of scope: any scheduling data route that returns schedules, resources or reservations (2B.2 onward), UI, navigation,
cron, public booking, payments, LD Tennis.

## 3. `scheduling_settings`: explicit creation at enablement

`scheduling_settings` (one row per organisation: `organisation_id` primary key, `currency` `^[A-Z]{3}$`) holds the
organisation-wide currency. Decision: **it is created by the enablement procedure, with a chosen currency, and by nothing
else.**

- Enablement is a reviewed, owner-run, per-organisation statement set (the `scripts/scheduling/manual/internal-test-org-*`
  files are the template): create the `organisation_modules` row **and** the `scheduling_settings` row in one
  transaction, so an enabled organisation cannot lack settings. `INSERT ... ON CONFLICT (organisation_id) DO NOTHING`,
  rollback documented.
- Currency is an explicit input per organisation (the first organisation uses `AUD`); there is no default in code or SQL.
- Not created by `120`, not by a request handler, not lazily on first read. A handler never writes it.
- **Fail closed on absence:** if an entitled organisation has no `scheduling_settings` row, the runtime refuses with a
  clear configuration error (503, "Scheduling is not configured for this organisation") and writes nothing. It never
  invents a currency.
- Because 2B.1 writes none, the 2B.1 PR needs no SQL on Production. The enablement files gain the settings insert and
  are rehearsed on Preview before any organisation is enabled.
- Test: entitled and settings present, entitled and settings absent (503, nothing written), settings present but not
  entitled (403), cross-organisation settings are never read.

## 4. Audit logging with privacy-preserving permissions

Reuse the generic `audit_logs` table, following ADR-0003 and `lib/admin/auditLog.ts`: best-effort, written **after** the
mutation commits, action namespace `scheduling.<resource>.<verb>`. No schema change.

**What is recorded (all roles can be affected by it, so it must be safe by default):**

- who (user id), which organisation (from the session), action, resource type and id, timestamp;
- a **non-identifying summary**: changed field names and ids (schedule, resource, occurrence, reservation, contact id),
  counts, outcome codes.

**Customer-identifying details** (customer names, emails, phone numbers, free-text notes) are **not** put in the
general before/after summary. Where an action genuinely needs them for accountability (for example "reservation created
for contact X"), they are stored in a clearly separated field of the audit entry, and are returned only to callers
holding a new permission:

- New permission `scheduling.audit.identity` (added to `SchedulingPermission`, defaulted into `permissionsForRole` for
  `manager`, `admin` and `super_admin` only).
- Reading scheduling audit entries needs `scheduling.view`; the identifying field is **stripped server-side** unless
  the caller also holds `scheduling.audit.identity`. `viewer` therefore sees "a reservation was created" with ids, never
  who the customer was. `analyst` and unknown roles see nothing.
- Never logged at all: card or payment data (none exists in 2B), full request bodies, session tokens, raw error text
  with customer content.
- Audit writes never include data the actor could not already see; the redaction is applied at read time as well, so a
  later role change cannot expose older entries to a lower role.

Tests: viewer receives entries without the identifying field; manager and admin receive it; analyst and unknown roles
get 403; cross-organisation entries are never returned; an audit-write failure never fails or rolls back the business
operation; no email address or phone number appears in a general summary (a scan over fixtures).

## 5. Fail-closed matrix (every row is a test)

| Condition | Result |
| --- | --- |
| No session / invalid session | 401 |
| Module absent, inactive, no entitlement row, entitlement disabled | 403 (all the same denial) |
| Entitlement lookup throws or database unavailable | 503, nothing read or written |
| Role `analyst` or unknown | 403 |
| Role `viewer` requesting manage, reserve or attendance | 403 |
| Unknown permission string | 403 |
| Entitled but no `scheduling_settings` | 503 configuration error |
| super_admin impersonating | the **impersonated** organisation is checked |
| Request body, query or path naming another organisation | ignored; the session organisation is used |
| Any scheduling route that does not call the guard | containment test fails |

## 6. Architecture constraints kept

- `@scheduling/core` has no BrainBase import; host code lives in `lib/scheduling/**` and `app/**`.
- Shared SQL is not edited for host reasons; host needs go in numbered `scripts/scheduling/1xx` files.
- The CRM link goes through the host function only (`130`); after the CRM duplicate-prevention PR the CRM API, Events and
  Scheduling all use the same per-(organisation, email) lock.
- No `scheduling_*` identifier appears in application code outside the reviewed adapter paths (the Phase 2A guard).

## 7. Exit criteria for 2B.1

PR green on CI including a Linux PostgreSQL run of the fail-closed matrix; no migration; no entitlement for anyone; a
reviewer can show that removing the guard from any scheduling route fails a test; separate approval to merge.
