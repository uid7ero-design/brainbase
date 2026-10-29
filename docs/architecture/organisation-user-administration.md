# Organisation user administration

## Scope and authority

Client ADMIN accounts can invite, edit roles/module permissions and deactivate users in their session organisation. SUPER_ADMIN remains platform-only. Organisation id is never accepted in a request body. Existing subscriptions and domain authorization remain cumulative: per-user permissions can narrow access, never replace a domain's role, tenant, HR or case decision.

Untouched users have no `organisation_user_access` row and retain legacy access. New invitations and edited accounts receive explicit policies; missing module entries deny. Policy rows belong to a protected table, not self-editable profile preferences. A mismatched policy tenant fails closed rather than becoming legacy access.

Managed accounts use `/workspace`. Middleware enforces protected page/API namespaces and write methods against current user status, current policy and current subscriptions. Unknown staff namespaces deny managed accounts. Public authentication/service routes keep their existing authorities; this does not change cron actors or public customer booking policies. Domain handlers remain independently authoritative. Per-user “view” blocks all non-read HTTP methods in a module, including POST-based queries; per-user “use” does not raise the user's existing role ceiling.

The employee-document reminder transport also checks the recipient's current explicit People access before sending a document title. This prevents the background HR worker from disclosing that information after module access is removed. Public purchaser/ticket notification policies are not staff-module permissions and remain unchanged.

## Invitations and mutations

Invites create INVITED accounts with an unknowable random password and explicit policies. Only a SHA-256 digest of a 256-bit random invitation token is stored. The emailed fragment link expires after 48 hours. Acceptance atomically activates the matching invited account, consumes the token and records an audit event. Inactive users, inactive organisations, expired links and replay are refused. The public acceptance route uses the existing process-local request limiter; its counter is not distributed across workers. Administrator invite/resend quota is database-backed at 20 per organisation per hour.

Administrator changes serialize on one organisation advisory lock and recheck actor status/role, target tenancy, subscription choices and last-active-administrator protection. Invitation acceptance additionally locks its token and user row. Mandatory audit failures roll back mutations. Credentials/tokens are not returned by the management API or written into audit fields. No account is deleted and email/username reassignment is not exposed.

Provider sending occurs after commit. A missing/ambiguous provider result is reported as unconfirmed without pretending the user creation failed or automatically resending. A deliberate resend rotates the link. Unknown HTTP save outcomes lock the UI until a successful fresh list read. No exactly-once email or every-revocation-after-check claim is made.

## Release gate

Apply `scripts/create-organisation-user-administration.sql` manually to the intended environment **before** deploying this code. The two tables are additive. Do not run the general migrate endpoint, alter existing users in bulk, or grant subscriptions automatically. There is no automatic hosted migration or production release in this development bundle. Missing policy storage intentionally causes access verification to fail closed; releasing application code first would interrupt protected access.

Confirm that each client organisation has an appropriate active ADMIN account using platform administration. Do not grant SUPER_ADMIN to a client. Existing HR administration and case-reader grants remain separate.

An application rollback must retain this permission boundary or first suspend the explicitly managed accounts. Rolling back to code that predates per-user enforcement while leaving those accounts active would restore the old broad role access. Do not drop access/audit/invitation history as a rollback shortcut.

The shared Scheduling route wrapper has a type-only overload correction for Next 16.2.4's generated HTTP-context checker; its runtime authorization and handler behavior are unchanged.

## Verification

- `node scripts/tests/verify-organisation-users.mjs`: creates an owned disposable loopback Postgres database and runs policy/middleware/navigation plus actual SQL tests. Real SQL checks cover cross-tenant attempts, actor revocation, administrator-removal concurrency, hashed/single-use/expired/replaced invitations, disabled invitation acceptance, quota refusal and transactional audit rollback. Email is mocked.
- `npm run test:hr:production-local`: full optimized local Next app with real authentication, synthetic organisation accounts, disposable Postgres, local object/email services and egress guards. The added walkthrough exercises invitation creation UI, actual acceptance/login, view-only HTTP enforcement, organisation/platform denial, saved-but-lost permission response recovery, fresh permission revocation and inactive-session denial. Existing HR workflow groups remain included. Installed font bytes substitute for Google fonts in this offline proof; it is not typography/provider acceptance.
- Existing navigation and `/api/me` projection tests are updated for the new administrative link and managed-account projection; legacy visibility is preserved.

## Development receipts — 24 October 2026

The dedicated owned-container runner passed **90 checks** across policy, actual middleware, HTTP boundary, navigation and real SQL suites; nine of these use disposable Postgres. The HR reminder transport suite passed **11 checks**, including denied delivery after module access removal. Affected navigation/projection/component suites passed after updating the expected new administrative link. Changed-file lint and diff checks passed.

The optimized production-mode local build and the complete browser walkthrough passed, including invitation UI/acceptance/login, a committed-but-lost access edit reconciled without another write, and all existing HR setup, templates, lifecycle approvals, manager restrictions, restricted cases, documents and reminder recovery groups. Only synthetic accounts, disposable Postgres and local email/object transports were used. The additional final-source repeat is retained in the local proof log during execution. Earlier runs corrected the Scheduling HTTP type declaration, an offline-font fixture failure, Node middleware transport, TLS-proxy Origin comparison, the sender fixture's recipient allowlist and an invalid non-UUID foreign-person test input; those exploratory failures are not passing receipts.

Initial clean hosted CI run `40096735418` passed both BrainBase and Eve checks at `8fabed58ffc25819a7b4e261deca7853baad56db`; GitGuardian and both Vercel previews also passed at that head. The exact final-head gates are recorded in PR #489 after subsequent corrections.

A raw, unrestricted local Vitest attempt returned 19,040 passes and 49 failures, with 93 skipped tests: this included the repository's three documented baseline files, outdated pre-change navigation expectations subsequently corrected, generated-artifact scan contamination and Docker fixture failures. It is not represented as a clean full-suite pass. Hosted CI uses its existing three-file exclusions and a clean checkout; no extra exclusions were added by this bundle.

Hosted invitation-provider delivery, authenticated preview acceptance and production rollout are separate from this local proof and require their respective environment/release authority. The previously authorized hosted HR acceptance did not authorize production rollout of this new platform-user feature.
