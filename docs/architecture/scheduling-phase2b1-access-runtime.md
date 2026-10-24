# Scheduling Phase 2B.1: access guard, runtime and audit (implemented)

Status: **implemented on `feat/scheduling-phase2b1-access-runtime`, draft PR, not merged, not deployed.** No SQL, no
migration, no entitlement, no navigation, no page. Scheduling stays disabled for every organisation. It implements the
plan in `scheduling-phase2b1-plan.md` (on its own docs branch) and the owner decisions of 2026-10-23.

## 1. What exists after this change

| Piece | File | Role |
| --- | --- | --- |
| Permission | `packages/scheduling/src/contracts.ts` | one new permission, `scheduling.audit.identity` (no new dependency in the core) |
| Role map | `lib/scheduling/adapters/brainbase/index.ts` | viewer = view; manager, admin, super_admin = view, manage, reserve, attendance, audit.identity; analyst and unknown = nothing |
| Access gate | `lib/scheduling/access.ts` (2B.0) | session, then capability for the **session's** organisation, then role permission, then `TenantContext` |
| Runtime | `lib/scheduling/runtime.ts` | organisation timezone, tenant, explicit settings; the Neon driver feeding `@scheduling/postgres` |
| Route guard | `lib/scheduling/route.ts` | `schedulingRoute(permission, handler)`: the only way to write a Scheduling route |
| Audit | `lib/scheduling/audit.ts` | writer and reader over the existing `audit_logs` table |
| Routes | `app/api/scheduling/status`, `app/api/scheduling/audit` | the minimum needed to prove the integration; configuration and audit only |

## 2. Request flow (each step fails closed before the next)

1. `authorizeSchedulingRequest(permission)`: no session 401; capability denied 403; entitlement not determinable 503;
   role lacks the permission 403. The organisation is the session's (while a super_admin impersonates, the impersonated
   one). No function accepts an organisation from the request.
2. `loadSchedulingRuntime(session)`: reads `organisations.timezone` (NULL or blank means `Australia/Adelaide`; an invalid
   stored zone is a configuration error, never a silent guess), builds the tenant, reads the settings row through the
   repository. Read-only. No settings row means a controlled `503 SCHEDULING_NOT_CONFIGURED`; nothing is created.
3. The handler. A throw is a generic 500 with no internal text. Every response, denials included, is `no-store`.

The shared core (`@scheduling/core`) and the Postgres package import nothing from BrainBase. The adapter direction is
unchanged: BrainBase code imports the packages; they never import it.

## 3. Roles and data scope

| Role | Status route | Audit route | Customer identity in audit |
| --- | --- | --- | --- |
| manager, admin, super_admin | full scope | yes | **yes** |
| viewer | `reduced` scope, view only | yes | **never** |
| analyst, unknown, empty | 403 | 403 | no |
| no session | 401 | 401 | no |
| organisation not entitled / disabled / module inactive | 403 | 403 | no |

## 4. Settings

`scheduling_settings` is created only by the explicit, owner-run enablement of an organisation, with a currency chosen
for it. This change adds no writer: no application code calls `saveSettings` or names the table (a containment test
fails if that changes). An entitled organisation without a row is refused with a configuration error. The enablement
file (`scripts/scheduling/manual/internal-test-org-2-enable-capability.sql`) now creates the settings row explicitly, in the same
transaction as the entitlement (both or neither), and the removal file refuses while Scheduling data exists. Still not run anywhere.

## 5. Audit and privacy

- Actions come from a closed list `scheduling.<resource>.<verb>`; an unknown action is refused.
- The summary holds ids, counts, codes, dates. Keys naming a person or contact detail, and values that look like an email
  address or phone number, are dropped and counted (`redacted`).
- Customer-identifying detail lives only under `identity` and is returned only to a caller with `scheduling.audit.identity`.
  It is removed on the server **at read time**, so a later role change cannot reveal older entries to a lower role. The
  raw `after_state` is never returned, and the summary is re-sanitised on read.
- Writes are best-effort and run after the operation commits: a failure is logged without the payload, returns `false`,
  and never throws, so it cannot undo or fail a committed booking.
- Reads are scoped by organisation and the `scheduling.` action prefix in SQL.
- No generic reader of `audit_logs` exposes entries wholesale (the only other readers are per-vertical and filter by
  their own actions).

## 6. Verification

- `tests/containment/schedulingRoutes.test.ts` (26): 401/403/503, roles, settings, audit privacy, tenant isolation,
  impersonation, no-store, no writes. `schedulingAudit.test.ts` and `schedulingRuntime.test.ts` (25).
- `tests/containment/schedulingPhase2b1Containment.test.ts` (18): every route under `app/api/scheduling` is created with
  `schedulingRoute`, exports `dynamic = 'force-dynamic'`, imports no session, database, repository or capability module,
  mentions no organisation id, and touches no payment or public booking; the checker is itself tested against a sample of
  each bypass. The access gate, the runtime and the Postgres package each have exactly one importer.
- `scripts/tests/verify-scheduling-phase2b1.sh [16|17]`: a disposable Postgres, the real routes, guard, capability lookup,
  repository and audit module. 19 tests: access matrix, explicit settings under 25-way load, timezone fallback and invalid
  zone, byte-identical tables after status and audit calls, tenant isolation, impersonation, identity privacy, a
  committed operation surviving a failing audit write, fail-closed behaviour when the organisation or capability tables
  are unreadable. Mutation checks (identity always visible; organisation filter removed) are caught by these suites.
- Existing guards were updated deliberately, not loosened: the 2A/2B.0/Phase 1 "nothing wired" checks now name the two
  routes and the single runtime importer; the `organisations.timezone` check now allows exactly `lib/scheduling/runtime.ts`
  (read only, and no writer anywhere); the permission lists include the new permission.

## 7. Known limits and risks

- The two routes return configuration and audit entries only. No customer, booking, schedule or resource data is exposed,
  and no write route exists. 2B.2 adds those, each through `schedulingRoute`.
- Dynamic route parameters are not yet supported by `schedulingRoute` (neither route needs one). 2B.2 extends it, and the
  containment checker already rejects any organisation id taken from a parameter.
- `audit_logs.created_at` is `timestamp without time zone` (Prisma); entries are read as UTC, the convention used by the
  other audit readers.
- Nothing calls `recordSchedulingAudit` yet; the first mutating routes (2B.2) must call it after commit. The writer and
  reader are proven now so that 2B.2 cannot ship an unaudited mutation by accident (a containment check for it is a 2B.2 item).
- The enablement SQL now creates `scheduling_settings` explicitly with the entitlement (corrected after this phase); it has not been run anywhere.
- The internal-test-organisation, enablement, any navigation entry and the Production activation remain separate approvals.
