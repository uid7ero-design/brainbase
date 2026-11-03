# LD Tennis business workspace

## Scope

The workspace at `/business/tennis` connects existing coaching operations, CRM and Commercial. Organiser is unchanged. It does not create a second booking ledger, copy customer records, infer identities from shared email addresses, or turn Tennis paid markers into financial receipts.

The workspace is restricted to the `ld-tennis` organisation resolved from the authenticated session. Each summary section independently requires its current visible module grant. Organisation entitlements and managed user permissions remain authoritative. Unknown roles, failed permission reads and other organisations fail closed. The summary API is read-only, private/no-store, and accepts only a financial month, never an organisation identifier.

## Sources and limits

- **Coaching:** the dedicated `/business/tennis/coaching` compatibility view uses existing Tennis `sessions`, `session_instances`, `bookings`, recurrence and Squad records. Its server adapter is a closed dispatch table, scoped to the current organisation, requiring Scheduling access and a staff role. Writes additionally require managed Scheduling `use` permission, matching request origin/host and the capacity prerequisite below. Generic Scheduling routes and their mandatory central guard are unchanged.
- **Scheduling:** `/scheduling` remains the existing availability/resource/configuration and calendar module. This bundle does **not** migrate coaching bookings into generic Scheduling booking tables or reserve its resources. A Tennis location label is not a resource reservation. A full booking-engine replacement is a separate acceptance milestone, not something this compatibility view claims to complete.
- **CRM:** current contacts and open opportunities; billing contacts are chosen explicitly in Commercial. Player and parent remain distinct concepts. Existing Squad email uniqueness and legacy enrolment email matching still constrain shared-family-mailbox workflows. PR #472's duplicate-email rejection is not imported or silently approved.
- **Commercial income:** issued invoice totals by issue date in the selected month, recorded incoming payments by Adelaide received date, and all-time remaining issued-invoice balances after current recorded allocations. Draft/void invoices and reversed payments are excluded.
- **Commercial spending:** posted supplier bills by bill date and recorded supplier payments by Adelaide payment date. Undated bills do not belong to a monthly dated total. Supplier bills use the existing purchase order → receipt → bill workflow, not a new standalone expense ledger.
- Currencies are displayed independently. Aggregate cents travel as SQL text and exact integer strings, never rounded through a JavaScript number. These are saved-record summaries, not profit, tax, bank settlement or a full accounting certification.

## Recovery

The workspace hides previous figures while changing month or refreshing; failed reads appear unavailable rather than zero. Billing-customer reads hide stale rows and disable changes until a fresh read succeeds. Customer creation supports explicit CRM linkage and a non-personal browser recovery marker for unconfirmed writes.

The coaching view unmounts its editing controls after a failed read or unconfirmed write. Review performs fresh reads; it does not repeat the prior write. Automatic repair/reconcile effects are disabled only in this compatibility view, so remounting cannot silently repeat an uncertain repair. Explicit repair controls remain available. Existing Sessions retains its old address and automatic schedule maintenance.

Legacy session/type/date/roster endpoints now report unreadable sources instead of silently returning empty lists or invented zero enrolments. The roster's hooks also run consistently when its data is temporarily absent.

## Reconciliation with open work

PR #462 remains separate. Its pinned head `777f9148eace08bd3ad541c5963586d37c134ef1` supplies the **disposable-test-only** capacity SQL fixture. No SQL from that branch is applied to a hosted database, and its production error mappings are not copied into this bundle. The only shared modified route is the instance route: #462 changes POST error mapping, while this bundle changes GET read-failure handling; those hunks are independent.

Coaching writes fail closed unless the `bookings_capacity_guard` BEFORE INSERT trigger is enabled and its expected function/locking/error-code markers exist. This is a prerequisite check, not a cryptographic verification of deployed SQL and not proof of every update/reactivation race. The pinned SQL has a real concurrent-insert proof. Rehearse and authorize #462's rollout separately before enabling this workspace for live booking changes.

PR #472 remains draft pending shared-family-email policy. No duplicate-email policy or identity merge is introduced here. Other open PRs are not part of this bundle.

## Verification commands

Run only from the isolated worktree. Both database runners own a fresh loopback-only Docker Postgres database and remove only their own services. The full-app runner blanks inherited provider credentials and dotenv values, rejects external fetch/SDK egress, uses the repository Prisma and raw SQL schemas, real synthetic password login and real session/middleware/route execution. The Neon transport is redirected to the owned database; no live provider certification is implied.

```powershell
node scripts/tests/verify-tennis-business.mjs
node scripts/tests/verify-hr-full-local.mjs --tennis-business
node scripts/tests/verify-hr-full-local.mjs --tennis-business --production
```

The pinned PR #462 Git object must be present locally for the fixture loader. Its source is explicit in `scripts/tests/helpers/tennisCapacityFixture.mjs`; the runner never silently substitutes a moving branch head.

Coverage includes exact money/date/currency/status rules, current grants and cross-tenant denials, real CRM UI creation, explicit billing linkage, committed-but-lost customer recovery, actual invoice/payment and purchasing/receipt/bill/payment HTTP transitions, rendered coaching attendance recovery, source-read failures, and workspace layouts at 390/768/1440px. The financial transition portion uses HTTP calls through a real authenticated context; it is not an assertion that every existing financial form, PDF, email, payment provider, booking race or real customer workflow was retested.

## Release handoff

Local receipt, 2026-11-03: 3,937 related containment/component checks passed (28 optional checks skipped by their existing environment guards); all six dedicated disposable-Postgres checks passed separately. Changed/new TypeScript lint passed. The optimized production build, its TypeScript check and the full local HTTPS real-login journey passed, including service cleanup. The old cancelled-instance regression now pins its historical August fixture clock and all eight cases pass. Hosted CI/security/preview are separate final-head gates; no production action was performed.

1. Complete final local build, focused/component/database/full-app checks and exact-head PR CI/security/preview checks.
2. Review the new workspace alongside #462's separate code/SQL dependency. Confirm live schema, LD organisation slug, timezone/currency/tax setup and existing records without bulk migration.
3. Obtain explicit authorization for release and any hosted SQL or module/user permission changes. This bundle does not make those changes automatically.
4. Enable only the agreed LD modules and least-privilege staff permissions. Do not give the coach platform super-admin privileges. A read-only Scheduling grant does not authorize coaching mutations.
5. Verify the approved deployment and agreed synthetic live journey before treating the workspace as operationally handed over. Leave the old Sessions history available. No automatic family-email merge or paid-marker conversion.

The in-app guide is `/business/tennis/help`. This is a business workspace bundle, not a claim that generic Scheduling booking migration or all Brainbase modules are complete.
