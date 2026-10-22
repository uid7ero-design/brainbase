# CRM contact duplicate prevention

Status: implemented on `fix/crm-contact-duplicate-prevention`, not merged, **no schema change, no Production SQL**.

## 1. The defect

`crm_contacts` has no unique constraint on email. Four code paths decide "does this contact already exist?" and then write:

| Path | Before | Measured on the old code (forced overlap, PostgreSQL 17) |
| --- | --- | --- |
| Events sync (`lib/crm/eventSync.ts`) | advisory lock **and** read in one statement | six waiters plus one earlier writer: **7 contacts**; phone-only: 6; 40 simultaneous syncs: **5** |
| Events backfill (`lib/crm/eventBackfill.ts`) | the same single statement | forced: 3 contacts; two simultaneous runs: duplicates, then 10 orders skipped as ambiguous |
| CRM API create (`POST /api/crm/contacts`) | plain insert, no check | 20 simultaneous creates of one email: **20 contacts**; even sequential creates duplicate |
| CRM API edit (`PUT /api/crm/contacts/[id]`) | plain update, no check | changing an email to one that exists, or two simultaneous edits, creates a pair |

The Scheduling host function (`brainbase_scheduling_find_or_create_contact`, Phase 2B.0, separate PR) already uses the correct shape. It is not changed here.

### Why the lock alone did not protect Events

Under READ COMMITTED a statement takes its snapshot when it **starts**. Events took `pg_advisory_xact_lock` and read `crm_contacts` in the **same** statement (a CTE). A writer that started before the winner committed waits on the lock, and when it gets the lock it still reads with its pre-wait snapshot, so it cannot see the winner's row and inserts its own. The lock serialised the writers but did not make the later ones see the earlier ones.

An earlier review measured one contact for a "natural" 30-way Events race. That was luck of staggering: each call first awaits capability lookups. With no stagger (this change's harness) the old code produces duplicates even without forcing the overlap.

## 2. The change

One shared helper, `lib/crm/contactIdentityLock.ts`, builds the lock statement. Every path now runs

```
sql.transaction([
  contactIdentityLock(organisationId, 'email' | 'phone', normalisedIdentity),   -- statement 1: take the lock
  sql`...read the matches, insert/update only if still absent...`,              -- statement 2: starts AFTER the lock is held
])
```

Statement 2 begins after statement 1 returns, so its snapshot includes everything committed before the previous holder released the lock. The lock key is unchanged: `(hashtext(organisation_id), hashtext('<kind>:<normalised identity>'))`, so these paths, and the Scheduling function, still queue behind each other, per organisation.

- **Events sync, Events backfill:** same matching rules, same inserted columns, same classification handling (a matched contact is never updated). Only the lock moved out of the CTE.
- **CRM API create:** if an email is supplied and another contact in the same organisation has it (case-insensitive, surrounding spaces ignored), nothing is written and the response is `409 {"code":"DUPLICATE_EMAIL","existing_contact_id":...}`. Contacts with no email are created as before. A 201 response has the same shape as before.
- **CRM API edit:** an edit that gives a contact an email another contact already has is refused with `409`. Saving a contact whose email is **unchanged** is never blocked, so a duplicate pair that already exists can still be edited and tidied. Clearing the email, or editing a contact with none, is unchanged.

The CRM contact form already shows `data.error` from a failed save, so the 409 message reaches the user without a UI change.

### Product decision to confirm

Refusing a second contact with a shared email is a behaviour change for people who deliberately keep two contacts on one address (for example a family mailbox). The alternative is to allow it and rely on the later unique index to reject it, which would make the index's rollout harder. This PR takes the strict policy because it matches what Events and Scheduling already do (one contact per organisation and email) and what the eventual unique index will enforce. If that is too strict for the CRM screen, only the two route files change.

## 3. What this does not fix

- An **email-keyed** writer and a **phone-only** writer use different lock keys. They can still both create the same real person. (Already documented in the Events header; unchanged.)
- A purchaser with **no email and no phone** is always inserted (unchanged).
- Matching is by normalised email only for the API; Events' phone matching rules are unchanged.
- **Nothing here is enforced by the database.** Any other writer that skips the lock can still duplicate. The unique index in section 5 is the only complete backstop.
- `normalizeEmail` trims JavaScript whitespace; the SQL compares with `lower(trim(email))` (spaces only), exactly as Events always did. A stored email with a leading no-break space would not match. Not changed here.

## 4. Verification

`bash scripts/tests/verify-crm-contact-duplicate-prevention.sh [16|17]` starts a disposable container and runs `scripts/tests/crmContactDuplicatePrevention.integration.test.ts` (28 tests) against the **real** `syncEventOrderContact`, `executeEventContactBackfill` and the two route handlers. Only the database client (a pool that reproduces Neon's lazy queries and `sql.transaction`) and the session are replaced.

- **Forced overlap:** a holder transaction owns the identity lock while the writers start and block, then commits a contact and releases. Every writer must reuse it.
- **Negative control:** the previous single-statement shape, run under the same forced overlap, still produces 7 contacts, so the harness can detect the defect.
- **The suite fails on the old code:** with the four production files reverted, 14 of the 28 fail (7 contacts instead of 1, 20 creates instead of 1, edits not refused, mixed writers 18 contacts), and the 14 that must not change (distinct emails, tenant isolation of the API, no-email creates, unchanged-email edits, cross-tenant 404, capability disabled) pass on both.
- Also covered: tenant isolation (same email in two organisations never contends), different emails in parallel are not serialised, existing data unchanged (table hash before and after), refused creates leave the table byte-identical, mixed writers (Events + backfill + API) together and under forced overlap leave one contact.
- Passes on PostgreSQL 16.14 and 17.11.

Unit tests that pinned the old single-statement call shape were updated, not loosened: the mocks now provide `sql.transaction`, the lock statement is recorded separately, and the sync test additionally asserts that the lock is **not** inside the read/insert statement.

The two older Docker harnesses (`verify-events-crm-sync-concurrency.sh`, `verify-events-crm-backfill.sh`) prove the superseded single-statement SQL shape; they still pass and are kept for history, with a note in their headers. This PR's harness is the proof for the current code.

## 5. Unique index: not part of this change

Do not add a Production unique index until all of these hold:

1. This change is merged and deployed, so no writer creates new duplicates.
2. The read-only duplicate audit is re-run on Production at that time. On the protected pre-Phase-2A backup (13 contacts, newest created 2026-09-23) it returned **0** duplicate groups; the Production run is owner-executed.
3. The index is the partial form `(organisation_id, lower(btrim(email)))` where email is non-blank, created `CONCURRENTLY`, with every writer handling `23505` (the Events and backfill paths are best-effort and already swallow errors; the API would need to map it to the same 409).
4. Compatibility is reviewed: the LD Tennis `contacts` table is separate and untouched; importers that write `crm_contacts` directly (none found in the application code searched) would start failing on duplicates.

Rollback of this change is a revert of the PR; there is no schema or data to undo.
